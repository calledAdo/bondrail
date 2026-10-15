// Sets up the three demo businesses on a deployment (run scripts/deploy.ts first). Resumable: every
// created piece is saved to docs/deployments/<chain>.json before the next step.
//
//   pumplab  Native  : account -> issuer deploys PumpLab (a BondrailEarner) -> binds it -> reviewer approves -> bond
//   curvelab Native  : a second issuer on the same reviewed template; its raise stays open (judges can fund)
//   agent    Watched : account (the x402 payTo) -> bond with stake; activation waits for a CRE report
//
//   AGENT_PUBLIC_URL=https://<agent> pnpm tsx demo/scripts/setup-demo.ts [pumplab|agent ...]
// AGENT_URL optionally pins a manifest-listed resource (normally /api/oracle). Issuance requires a
// Compliant unpaid observer preflight. --skip-preflight is only for explicit chain-31337 local tests.
//
// A bond needs `factory.minHistory()` seconds since the account's first booked payment. Run the first time to
// create the account and project, send real traffic (traffic-launchpad.ts / traffic-agent.ts), then run
// again once the history is old enough. On local anvil the wait is skipped by advancing the chain clock.
//
// Amounts are small on purpose (testnet USDC comes from a rate-limited faucet). Override with
// RAISE_USDC / CAP_USDC / STAKE_USDC / MATURITY_DAYS. Every wallet here is team-controlled demo activity.
import os from 'node:os';
import { parseTriggerTerms } from '../../packages/sdk/src/trigger.ts';
import path from 'node:path';
import {
  decodeEventLog,
  encodeAbiParameters,
  getContractAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseEther,
  parseUnits,
  stringToHex,
  type Address,
} from 'viem';
import { PARSER_VERSION, policyHash, type WatchPolicy } from '@bondrail/observer/protocol';
import { assertPreflightMode, fetchUnpaid, preflightWatchedPolicy, selectAgentEndpoint } from './watched-preflight.ts';
import {
  account,
  assertDeploymentWritable,
  assertChain,
  artifact,
  chainId,
  publicClient,
  readDeployment,
  saveDeployment,
  wallet,
  write,
  type IssuerRecord,
} from '../../scripts/lib.ts';

const usdc = (x: string) => parseUnits(x, 6);
const RAISE = usdc(process.env.RAISE_USDC ?? '2');
const CAP = usdc(process.env.CAP_USDC ?? '2.4');
const STAKE = usdc(process.env.STAKE_USDC ?? '0.5');
const triggerTerms = parseTriggerTerms({
  triggerRevenue: process.env.TRIGGER_REVENUE_USDC ?? '0',
  triggerWindowDays: process.env.TRIGGER_DAYS ?? '0',
  stepUpBps: process.env.STEP_UP_BPS ?? '0',
}, 6, 2500);
const HOUR = 3600n;
const ZERO: Address = '0x0000000000000000000000000000000000000000';
const skipPreflight = process.argv.includes('--skip-preflight');
assertPreflightMode(skipPreflight, chainId, process.env.BONDRAIL_ENV);

const erc20 = parseAbi([
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address,uint256)',
]);
const factoryAbi = artifact('BondrailFactory').abi;
const bondAbi = artifact('BondrailBond').abi;
const accountAbi = artifact('BondrailAccount').abi;

assertDeploymentWritable();
const deployer = account('deployer', { fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key') });
const investor = account('investor', { create: true });

async function fund(to: Address, mon: string, usdcAmount: bigint, asset: Address) {
  const bal = await publicClient.getBalance({ address: to });
  if (bal < parseEther(mon)) {
    const hash = await wallet(deployer).sendTransaction({ to, value: parseEther(mon) - bal, gas: 21_000n });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  const have = (await publicClient.readContract({
    address: asset,
    abi: erc20,
    functionName: 'balanceOf',
    args: [to],
  })) as bigint;
  if (have < usdcAmount) {
    if (chainId === 31337) await write(deployer, asset, erc20, 'mint', [to, usdcAmount - have]);
    else await write(deployer, asset, erc20, 'transfer', [to, usdcAmount - have]);
  }
}

function terms(id: string, now: bigint, milestoneMode: 0 | 1, minFeeBps: number) {
  // Funding FUNDING_DAYS (default 1); second release opens 1 h after funding closes and ends 2 days
  // before maturity; matures after MATURITY_DAYS (default 7; use 30+ to stay live through judging).
  const fundingDays = BigInt(process.env.FUNDING_DAYS ?? '1');
  const days = BigInt(process.env.MATURITY_DAYS ?? '7');
  if (days < fundingDays + 3n) throw new Error('MATURITY_DAYS must be at least FUNDING_DAYS + 3');
  return {
    raiseAmount: RAISE,
    repayCap: CAP,
    stake: STAKE,
    minRevenue: usdc('0.01'),
    fundingDeadline: now + fundingDays * 24n * HOUR,
    maturity: now + days * 24n * HOUR,
    secondReleaseNotBefore: now + fundingDays * 24n * HOUR + HOUR,
    secondReleaseDeadline: now + (days - 2n) * 24n * HOUR,
    minOperatingPeriod: 3600,
    revenueBps: 2500,
    firstReleaseBps: 5000,
    milestoneMode,
    minFeeBps,
    ...(id === (process.env.TRIGGER_BOND ?? 'pumplab') ? triggerTerms : { triggerRevenue: 0n, triggerWindowDays: 0, stepUpBps: 0 }),
  };
}

async function eventArgs(receipt: Awaited<ReturnType<typeof write>>, eventName: string) {
  for (const log of receipt.logs) {
    try {
      const e = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (e.eventName === eventName) return e.args as unknown as Record<string, Address>;
    } catch {}
  }
  throw new Error(`${eventName} not found`);
}

const phase = (bond: Address) =>
  publicClient.readContract({ address: bond, abi: bondAbi, functionName: 'phase' }) as Promise<number>;

/** Creates the account first: from here on every payment builds this business's history. */
async function ensureAccount(id: string, name: string, tier: IssuerRecord['tier']) {
  const d = readDeployment();
  if (d.issuers[id]?.account) return d;
  const issuer = account(`${id}-issuer`, { create: true });
  await fund(issuer.address, '1', STAKE, d.asset);
  const r = await write(issuer, d.factory, factoryAbi, 'createAccount', [d.asset]); // the demo earns in USDC
  const { account: acct } = await eventArgs(r, 'AccountCreated');
  d.roles = { ...d.roles, [`${id}-issuer`]: issuer.address, investor: investor.address };
  d.issuers[id] = { name, tier, issuer: issuer.address, account: acct };
  saveDeployment(d);
  console.log(`  ${name}: account ${acct}`);
  return d;
}

async function fundAndActivate(id: string) {
  const d = readDeployment();
  const rec = d.issuers[id]!;
  if ((await phase(rec.bond!)) !== 0) return;
  await allocateVault(id);
  const raised = (await publicClient.readContract({
    address: rec.bond!,
    abi: bondAbi,
    functionName: 'fundingEscrow',
  })) as bigint;
  if (raised < RAISE) {
    await fund(investor.address, '0.5', RAISE - raised, d.asset);
    await write(investor, d.asset, erc20, 'approve', [rec.bond!, RAISE - raised]);
    await write(investor, rec.bond!, bondAbi, 'deposit', [RAISE - raised]);
  }
  if (rec.tier === 'watched') {
    console.log(`  ${rec.name}: funded; activate after a compliant CRE report (scripts/activate-watched.ts)`);
    return;
  }
  await write(account(`${id}-issuer`), d.factory, factoryAbi, 'activate', [rec.bond!]);
  console.log(`  ${rec.name}: funded and activated (50% released, 50% escrowed)`);
}

/** True once the account's history is old enough to issue. Never fakes payments: traffic must be real. */
async function historyReady(id: string) {
  const d = readDeployment();
  const rec = d.issuers[id]!;
  const read = (address: Address, abi: typeof factoryAbi, functionName: string) =>
    publicClient.readContract({ address, abi, functionName }) as Promise<bigint>;
  const [first, min] = await Promise.all([
    read(rec.account, accountAbi, 'firstRevenueAt'),
    read(d.factory, factoryAbi, 'minHistory'),
  ]);
  if (first === 0n) {
    const traffic = rec.tier === 'native' ? `traffic-launchpad.ts ${id} organic 1` : 'traffic-agent.ts';
    console.log(`  ${rec.name}: no payments yet. Send real traffic (demo/scripts/${traffic}), then run this again`);
    return false;
  }
  const wait = first + min - (await publicClient.getBlock()).timestamp;
  if (wait <= 0n) return true;
  if (chainId === 31337) {
    await publicClient.request({ method: 'evm_increaseTime' as never, params: [Number(wait)] as never });
    await publicClient.request({ method: 'evm_mine' as never });
    return true;
  }
  console.log(`  ${rec.name}: history is ${min - wait}s old; the factory needs ${min}s. Run again in ${wait}s`);
  return false;
}

async function createBond(
  id: string,
  config: object,
  name: string,
  symbol: string,
  milestoneMode: 0 | 1,
  minFeeBps = 0,
) {
  const d = readDeployment();
  const rec = d.issuers[id]!;
  if (rec.bond) { await recordBond(rec.bond); return true; }
  if (!(await historyReady(id))) return false;
  const issuer = account(`${id}-issuer`);
  const now = (await publicClient.getBlock()).timestamp;
  await write(issuer, d.asset, erc20, 'approve', [d.factory, STAKE]);
  const r = await write(issuer, d.factory, factoryAbi, 'createBond', [
    rec.account,
    terms(id, now, milestoneMode, minFeeBps),
    config,
    name,
    symbol,
  ]);
  rec.bond = (await eventArgs(r, 'BondCreated')).bond;
  saveDeployment(d);
  await recordBond(rec.bond!);
  console.log(`  ${rec.name}: bond ${rec.bond} (${symbol})`);
  return true;
}

async function recordBond(bond: Address) {
  const d = readDeployment();
  if (!d.creditRegistry) throw new Error('Deploy the full protocol including creditRegistry first');
  const abi = artifact('BondrailCreditRegistry').abi;
  if (!await publicClient.readContract({ address: d.creditRegistry, abi, functionName: 'recorded', args: [bond] }))
    await write(deployer, d.creditRegistry, abi, 'recordBond', [bond]);
}

/** Allocate before investor top-up/activation, while the bond is Funding. Reruns target a total cost. */
async function allocateVault(id: string) {
  const amount = usdc(process.env.VAULT_ALLOCATE_USDC ?? '0');
  if (!amount || id !== (process.env.VAULT_BOND ?? 'pumplab')) return;
  const d = readDeployment();
  if (!d.vault) throw new Error('Missing vault');
  const bond = d.issuers[id]!.bond!;
  const abi = artifact('BondrailVault').abi;
  const deposited = usdc(process.env.VAULT_DEPOSIT_USDC ?? '2');
  if (deposited < amount * 4n) throw new Error('Vault deposit must cover the 25% concentration limit');
  const holder = account('vault-depositor', { create: true });
  const supply = await publicClient.readContract({ address: d.vault, abi, functionName: 'totalSupply' }) as bigint;
  if (!supply) {
    await fund(holder.address, '0.2', deposited, d.asset);
    await write(holder, d.asset, erc20, 'approve', [d.vault, deposited]);
    await write(holder, d.vault, abi, 'deposit', [deposited, holder.address]);
  }
  const cost = await publicClient.readContract({ address: d.vault, abi, functionName: 'costBasis', args: [bond] }) as bigint;
  if (cost < amount) await write(account('curator'), d.vault, abi, 'allocate', [bond, amount - cost]);
  d.roles = { ...d.roles, 'vault-depositor': holder.address };
  d.vaultAllocation = { bond, amount: String(amount), deposit: String(deposited) };
  saveDeployment(d);
  console.log(`  Vault: allocated ${amount} atomic USDC to ${id} while Funding`);
}

/** A Native launchpad from the reviewed PumpLab template. `open`: create the bond and leave the raise
 * open for anyone (judges included) to fund; the issuer activates once it is full. */
async function setupLaunchpad(id: string, name: string, tokenName: string, tokenSymbol: string, symbol: string, open: boolean) {
  const d = await ensureAccount(id, name, 'native');
  const rec = d.issuers[id]!;
  const issuer = account(`${id}-issuer`);
  if (!rec.source) {
    // The disclosed reviewer approves the PumpLab template once (its creation code: every fee goes
    // through BondrailEarner). Any issuer then deploys it through the factory, pointed at and bound to its
    // own account in one transaction, with no per-project review.
    const { bytecode } = artifact('PumpLab');
    const templateHash = keccak256(bytecode);
    if (d.templateHash !== templateHash) throw new Error('PumpLab artifact differs from the deployed reviewed template');
    const reviewed = await publicClient.readContract({
      address: d.factory,
      abi: factoryAbi,
      functionName: 'nativeTemplate',
      args: [templateHash],
    });
    if (!reviewed) {
      await fund(account('reviewer').address, '0.2', 0n, d.asset);
      await write(account('reviewer'), d.factory, factoryAbi, 'setNativeTemplate', [templateHash, true]);
      console.log(`  PumpLab: template ${templateHash} approved by the reviewer`);
    }
    const args = encodeAbiParameters(parseAbiParameters('address, string, string'), [
      rec.account,
      tokenName,
      tokenSymbol,
    ]);
    const r = await write(issuer, d.factory, factoryAbi, 'deployNative', [
      rec.account,
      bytecode,
      args,
      keccak256(stringToHex(id)),
    ]);
    rec.source = (await eventArgs(r, 'NativeDeployed')).project;
    rec.token = (await publicClient.readContract({
      address: rec.source,
      abi: artifact('PumpLab').abi,
      functionName: 'token',
    })) as Address;
    saveDeployment(d);
    console.log(`  ${name}: native launchpad ${rec.source}, deployed from the template and bound`);
  }
  const created = await createBond(
    id,
    { adapter: 0, source: rec.source, policyHash: keccak256(stringToHex(`bondrail-native-${id}-v1`)) },
    `${name} Revenue Claim`,
    symbol,
    0,
    100, // fee floor = PumpLab's fixed 1% fee: investors are protected even if a later version adds a setter
  );
  if (!created) return;
  if (open) {
    console.log(`  ${name}: raise open to anyone until the funding deadline; activate with ACTIVATE=1 once full`);
    if (process.env.ACTIVATE === '1') await fundAndActivate(id);
  } else await fundAndActivate(id);
}


async function setupAgent() {
  const d = await ensureAccount('agent', 'Oracle Agent', 'watched');
  const rec = d.issuers.agent!;
  console.log(`  Oracle Agent: x402 payTo = ${rec.account}`);
  if (!rec.bond) {
    const agentOrigin = process.env.AGENT_PUBLIC_URL ?? process.env.AGENT_URL;
    if (!agentOrigin) return console.log('  Oracle Agent bond skipped: deploy the agent, then set AGENT_PUBLIC_URL (or AGENT_URL)');
    if (!(await historyReady('agent'))) return;
    // The policy commits to the bond address, which the factory creates next with CREATE.
    const nonce = await publicClient.getTransactionCount({ address: d.factory });
    const bond = getContractAddress({ from: d.factory, nonce: BigInt(nonce) });
    // Pin a listed resource with a price floor; observer checks also cover other listed endpoints.
    const origin = new URL(agentOrigin).origin;
    const policy: WatchPolicy = {
      id: 'bondrail-agent',
      chainId,
      chainSelector: '2183018362218727504',
      covenant: d.covenant,
      bond,
      manifestUrl: `${origin}/.well-known/bondrail.json`,
      endpoints: [],
      method: 'GET',
      headers: { accept: 'application/json' },
      network: `eip155:${chainId}`,
      asset: d.asset,
      expectedPayTo: rec.account,
      maxTimeoutSeconds: 300,
      parserVersion: PARSER_VERSION,
      epochSeconds: 30,
      freshnessSeconds: 90,
    };
    const manifest = await fetchUnpaid(policy.manifestUrl, policy.headers);
    const agentUrl = selectAgentEndpoint(manifest, policy, process.env.AGENT_URL);
    policy.endpoints = [{ url: agentUrl, minAmount: '10000' }];
    if (skipPreflight) console.log('  Oracle Agent: SKIPPED unpaid classification for local test (--skip-preflight)');
    else {
      const result = await preflightWatchedPolicy(policy, fetch, manifest);
      console.log(`  Oracle Agent: Watched preflight Compliant (${result.reason}); endpoint ${agentUrl}`);
    }
    await createBond(
      'agent',
      { adapter: 1, source: ZERO, policyHash: policyHash(policy) },
      'Oracle Agent Revenue Claim',
      'ORCL-RC',
      0,
    );
    const after = readDeployment();
    if (after.issuers.agent!.bond!.toLowerCase() !== bond.toLowerCase()) throw new Error('Predicted bond mismatch');
    after.issuers.agent!.endpoint = agentUrl;
    after.watchPolicy = policy;
    saveDeployment(after);
  }
  await fundAndActivate('agent');
}

async function main() {
  await assertChain();
  const which = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const all = which.length === 0;
  console.log(`Setting up demo businesses on ${readDeployment().network}`);
  if (all || which.includes('pumplab')) await setupLaunchpad('pumplab', 'PumpLab', 'PumpLab Meme', 'PLMEME', 'PLAB-RC', false);
  // A second issuer on the same reviewed template, raising in the open (e.g. FUNDING_DAYS=17 MATURITY_DAYS=45).
  if (all || which.includes('curvelab')) await setupLaunchpad('curvelab', 'CurveLab', 'CurveLab Meme', 'CLMEME', 'CLAB-RC', true);
  if (all || which.includes('agent')) await setupAgent();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
