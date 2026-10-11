// Sets up the three demo businesses on a deployment (run scripts/deploy.ts first). Resumable: every
// created piece is saved to docs/deployments/<chain>.json before the next step.
//
//   pumplab  Native  : account -> issuer deploys PumpLab (a SliceEarner) -> binds it -> reviewer approves -> bond
//   curvelab Native  : a second issuer on the same reviewed template; its raise stays open (judges can fund)
//   agent    Watched : account (the x402 payTo) -> bond with stake; activation waits for a CRE report
//
//   AGENT_URL=https://<agent>/api/oracle?question=health pnpm tsx scripts/setup-demo.ts [pumplab|agent ...]
//
// A bond needs `factory.minHistory()` seconds since the account's first booked payment. Run the first time to
// create the account and project, send real traffic (traffic-launchpad.ts / traffic-agent.ts), then run
// again once the history is old enough. On local anvil the wait is skipped by advancing the chain clock.
//
// Amounts are small on purpose (testnet USDC comes from a rate-limited faucet). Override with
// RAISE_USDC / CAP_USDC / STAKE_USDC / MATURITY_DAYS. Every wallet here is team-controlled demo activity.
import os from 'node:os';
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
import { PARSER_VERSION, policyHash, type WatchPolicy } from '../../services/observer/src/protocol.ts';
import {
  account,
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
const HOUR = 3600n;
const ZERO: Address = '0x0000000000000000000000000000000000000000';

const erc20 = parseAbi([
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address,uint256)',
]);
const factoryAbi = artifact('SliceFactory').abi;
const bondAbi = artifact('SliceBond').abi;
const accountAbi = artifact('SliceAccount').abi;

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

function terms(now: bigint, milestoneMode: 0 | 1, minFeeBps: number) {
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
  d.issuers[id] = { name, tier, issuer: issuer.address, account: acct };
  saveDeployment(d);
  console.log(`  ${name}: account ${acct}`);
  return d;
}

async function fundAndActivate(id: string) {
  const d = readDeployment();
  const rec = d.issuers[id]!;
  if ((await phase(rec.bond!)) !== 0) return;
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
  if (rec.bond) return true;
  if (!(await historyReady(id))) return false;
  const issuer = account(`${id}-issuer`);
  const now = (await publicClient.getBlock()).timestamp;
  await write(issuer, d.asset, erc20, 'approve', [d.factory, STAKE]);
  const r = await write(issuer, d.factory, factoryAbi, 'createBond', [
    rec.account,
    terms(now, milestoneMode, minFeeBps),
    config,
    name,
    symbol,
  ]);
  rec.bond = (await eventArgs(r, 'BondCreated')).bond;
  saveDeployment(d);
  console.log(`  ${rec.name}: bond ${rec.bond} (${symbol})`);
  return true;
}

/** A Native launchpad from the reviewed PumpLab template. `open`: create the bond and leave the raise
 * open for anyone (judges included) to fund; the issuer activates once it is full. */
async function setupLaunchpad(id: string, name: string, tokenName: string, tokenSymbol: string, symbol: string, open: boolean) {
  const d = await ensureAccount(id, name, 'native');
  const rec = d.issuers[id]!;
  const issuer = account(`${id}-issuer`);
  if (!rec.source) {
    // The disclosed reviewer approves the PumpLab template once (its creation code: every fee goes
    // through SliceEarner). Any issuer then deploys it through the factory, pointed at and bound to its
    // own account in one transaction, with no per-project review.
    const { bytecode } = artifact('PumpLab');
    const templateHash = keccak256(bytecode);
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
    { adapter: 0, source: rec.source, policyHash: keccak256(stringToHex(`slice-native-${id}-v1`)) },
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
  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) return console.log('  Oracle Agent bond skipped: deploy the agent, then set AGENT_URL');
  if (!rec.bond) {
    if (!(await historyReady('agent'))) return;
    // The policy commits to the bond address, which the factory creates next with CREATE.
    const nonce = await publicClient.getTransactionCount({ address: d.factory });
    const bond = getContractAddress({ from: d.factory, nonce: BigInt(nonce) });
    // Every paid endpoint the agent lists in its manifest is covered; the price is a floor.
    const origin = new URL(agentUrl).origin;
    const policy: WatchPolicy = {
      id: 'slice-agent',
      chainId: chainId as 10143,
      chainSelector: '2183018362218727504',
      covenant: d.covenant,
      bond,
      manifestUrl: `${origin}/.well-known/slice.json`,
      endpoints: [{ url: agentUrl, minAmount: '10000' }],
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
  const which = process.argv.slice(2);
  const all = which.length === 0;
  console.log(`Setting up demo businesses on ${readDeployment().network}`);
  if (all || which.includes('pumplab')) await setupLaunchpad('pumplab', 'PumpLab', 'PumpLab Meme', 'PLMEME', 'PLAB-RC', false);
  // A second issuer on the same reviewed template, raising in the open (e.g. FUNDING_DAYS=17 MATURITY_DAYS=45).
  if (which.includes('curvelab')) await setupLaunchpad('curvelab', 'CurveLab', 'CurveLab Meme', 'CLMEME', 'CLAB-RC', true);
  if (all || which.includes('agent')) await setupAgent();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
