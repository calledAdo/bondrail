// Sets up the three demo businesses on a deployment (run scripts/deploy.ts first). Resumable: every
// created piece is saved to docs/deployments/<chain>.json before the next step.
//
//   pumplab  Native  : account -> PumpLab bound to it (every fee via account.collect) -> bond (on-chain milestone)
//   classic  Locked  : account -> PumpLabClassic owned by a FeeGuard -> bond (signed milestone)
//   agent    Watched : account (the x402 payTo) -> bond with stake; activation waits for a CRE report
//
//   AGENT_URL=https://<agent>/api/oracle?question=health pnpm tsx scripts/setup-demo.ts [pumplab|classic|agent ...]
//
// Amounts are small on purpose (testnet USDC comes from a rate-limited faucet). Override with
// RAISE_USDC / CAP_USDC / STAKE_USDC. Every wallet here is team-controlled demo activity.
import os from 'node:os';
import path from 'node:path';
import {
  decodeEventLog,
  getContractAddress,
  keccak256,
  parseAbi,
  parseEther,
  parseUnits,
  stringToHex,
  type Address,
} from 'viem';
import { PARSER_VERSION, policyHash, type WatchPolicy } from '../services/observer/src/protocol.ts';
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
} from './lib.ts';

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

function terms(now: bigint, milestoneMode: 0 | 1) {
  // Funding 1 day; second release opens after 1 h of operation, closes at 5 days; matures at 7 days.
  return {
    raiseAmount: RAISE,
    repayCap: CAP,
    stake: STAKE,
    minRevenue: usdc('0.01'),
    fundingDeadline: now + 24n * HOUR,
    maturity: now + 7n * 24n * HOUR,
    secondReleaseNotBefore: now + 25n * HOUR,
    secondReleaseDeadline: now + 5n * 24n * HOUR,
    minOperatingPeriod: 3600,
    revenueBps: 2500,
    firstReleaseBps: 5000,
    milestoneMode,
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
  const r = await write(issuer, d.factory, factoryAbi, 'createAccount');
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

async function createBond(id: string, config: object, name: string, symbol: string, milestoneMode: 0 | 1) {
  const d = readDeployment();
  const rec = d.issuers[id]!;
  if (rec.bond) return;
  const issuer = account(`${id}-issuer`);
  const now = (await publicClient.getBlock()).timestamp;
  await write(issuer, d.asset, erc20, 'approve', [d.factory, STAKE]);
  const r = await write(issuer, d.factory, factoryAbi, 'createBond', [
    rec.account,
    terms(now, milestoneMode),
    config,
    name,
    symbol,
  ]);
  rec.bond = (await eventArgs(r, 'BondCreated')).bond;
  saveDeployment(d);
  console.log(`  ${rec.name}: bond ${rec.bond} (${symbol})`);
}

async function setupPumpLab() {
  const d = await ensureAccount('pumplab', 'PumpLab', 'native');
  const rec = d.issuers.pumplab!;
  if (!rec.source) {
    const r = await write(account('pumplab-issuer'), d.factory, factoryAbi, 'createNativeLaunchpad', [
      rec.account,
      'PumpLab Meme',
      'PLMEME',
    ]);
    const e = await eventArgs(r, 'NativeSourceCreated');
    rec.source = e.source;
    rec.token = e.token;
    saveDeployment(d);
    console.log(`  PumpLab: native launchpad ${rec.source}`);
  }
  await createBond(
    'pumplab',
    { adapter: 0, source: rec.source, guard: ZERO, policyHash: keccak256(stringToHex('slice-native-pumplab-v1')) },
    'PumpLab Revenue Claim',
    'PLAB-RC',
    0,
  );
  await fundAndActivate('pumplab');
}

async function setupClassic() {
  const d = await ensureAccount('classic', 'PumpLab Classic', 'locked');
  const rec = d.issuers.classic!;
  if (!rec.source) {
    const r = await write(account('classic-issuer'), d.factory, factoryAbi, 'createLockedLaunchpad', [
      rec.account,
      'Classic Meme',
      'CLMEME',
      64,
    ]);
    const e = await eventArgs(r, 'LockedSourceCreated');
    rec.source = e.source;
    rec.guard = e.guard;
    rec.token = e.token;
    saveDeployment(d);
    console.log(`  PumpLab Classic: launchpad ${rec.source}, FeeGuard ${rec.guard}`);
  }
  await createBond(
    'classic',
    {
      adapter: 1,
      source: rec.source,
      guard: rec.guard,
      policyHash: keccak256(stringToHex('slice-locked-classic-v1')),
    },
    'Classic Revenue Claim',
    'CLAB-RC',
    1,
  );
  await fundAndActivate('classic');
}

async function setupAgent() {
  const d = await ensureAccount('agent', 'Oracle Agent', 'watched');
  const rec = d.issuers.agent!;
  console.log(`  Oracle Agent: x402 payTo = ${rec.account}`);
  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) return console.log('  Oracle Agent bond skipped: deploy the agent, then set AGENT_URL');
  if (!rec.bond) {
    // The policy commits to the bond address, which the factory creates next with CREATE.
    const nonce = await publicClient.getTransactionCount({ address: d.factory });
    const bond = getContractAddress({ from: d.factory, nonce: BigInt(nonce) });
    const policy: WatchPolicy = {
      id: 'slice-agent',
      chainId: chainId as 10143,
      chainSelector: '2183018362218727504',
      covenant: d.covenant,
      bond,
      url: agentUrl,
      method: 'GET',
      headers: { accept: 'application/json' },
      network: `eip155:${chainId}`,
      asset: d.asset,
      expectedPayTo: rec.account,
      amount: '10000',
      maxTimeoutSeconds: 300,
      parserVersion: PARSER_VERSION,
      epochSeconds: 30,
      freshnessSeconds: 90,
    };
    await createBond(
      'agent',
      { adapter: 2, source: ZERO, guard: ZERO, policyHash: policyHash(policy) },
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
  if (all || which.includes('pumplab')) await setupPumpLab();
  if (all || which.includes('classic')) await setupClassic();
  if (all || which.includes('agent')) await setupAgent();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
