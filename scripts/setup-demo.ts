// Sets up the two demo issuers on an existing deployment (scripts/deploy.ts first).
//
//   PumpLab      Locked adapter: router -> PumpLab launchpad owned by a FeeGuard -> bond, funded and activated.
//   Oracle Agent Watched adapter: router (the x402 payTo) -> bond, funded; activation waits for the first
//                compliant CRE report (scripts/activate-watched.ts).
//
//   AGENT_URL=https://<agent>/api/oracle?question=health pnpm tsx scripts/setup-demo.ts
//
// Amounts are small on purpose (testnet USDC comes from a rate-limited faucet). Override with
// RAISE_USDC / CAP_USDC / STAKE_USDC. Every wallet here is team-controlled demo activity.
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
import { policyHash, PARSER_VERSION, type WatchPolicy } from '../services/observer/src/protocol.ts';
import {
  account,
  artifact,
  chainId,
  publicClient,
  readDeployment,
  saveDeployment,
  wallet,
  write,
} from './lib.ts';
import os from 'node:os';
import path from 'node:path';

const usdc = (x: string) => parseUnits(x, 6);
const RAISE = usdc(process.env.RAISE_USDC ?? '10');
const CAP = usdc(process.env.CAP_USDC ?? '12');
const STAKE = usdc(process.env.STAKE_USDC ?? '2');
const HOUR = 3600n;

const erc20 = parseAbi([
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function mint(address,uint256)',
]);
const factoryAbi = artifact('SliceFactory').abi;
const bondAbi = artifact('SliceBond').abi;

const deployer = account('deployer', {
  fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key'),
});
const pumplabIssuer = account('pumplab-issuer', { create: true });
const agentIssuer = account('agent-issuer', { create: true });
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

function terms(now: bigint) {
  // Funding window 1 day; second release opens after 1 h of operation and closes at 5 days; matures at 7 days.
  return {
    raiseAmount: RAISE,
    repayCap: CAP,
    stake: STAKE,
    minRevenue: usdc('0.05'),
    fundingDeadline: now + 24n * HOUR,
    maturity: now + 7n * 24n * HOUR,
    secondReleaseNotBefore: now + 25n * HOUR,
    secondReleaseDeadline: now + 5n * 24n * HOUR,
    minOperatingPeriod: 3600,
    revenueBps: 2500,
    firstReleaseBps: 5000,
  };
}

async function routerFrom(receipt: Awaited<ReturnType<typeof write>>, eventName: string) {
  for (const log of receipt.logs) {
    try {
      const e = decodeEventLog({ abi: factoryAbi, data: log.data, topics: log.topics });
      if (e.eventName === eventName) return e.args as unknown as Record<string, Address>;
    } catch {}
  }
  throw new Error(`${eventName} not found`);
}

async function main() {
  const d = readDeployment();
  const now = (await publicClient.getBlock()).timestamp;
  console.log(`Setting up demo issuers on ${d.network}`);

  // Gas and test USDC for the team wallets.
  await fund(pumplabIssuer.address, '1', STAKE, d.asset);
  await fund(agentIssuer.address, '1', STAKE, d.asset);
  await fund(investor.address, '0.2', RAISE, d.asset); // enough for the next raise; tops up only the shortfall

  // ---------- PumpLab (Locked) ----------
  if (!d.issuers.pumplab?.bond) {
    // Resumable: each created piece is saved before the next step.
    let partial = d.issuers.pumplab ?? ({ name: 'PumpLab', issuer: pumplabIssuer.address } as any);
    if (!partial.router) {
      const r1 = await write(pumplabIssuer, d.factory, factoryAbi, 'createRouter');
      partial.router = (await routerFrom(r1, 'RouterCreated')).router;
      d.issuers.pumplab = partial;
      saveDeployment(d);
    }
    if (!partial.source) {
      const r2 = await write(pumplabIssuer, d.factory, factoryAbi, 'createLockedSource', [
        partial.router,
        'PumpLab Meme',
        'PLMEME',
        64,
      ]);
      Object.assign(partial, await routerFrom(r2, 'LockedSourceCreated'));
      delete partial.issuer_;
      saveDeployment(d);
    }
    const { router, source, guard, token } = partial;
    await write(pumplabIssuer, d.asset, erc20, 'approve', [d.factory, STAKE]);
    const r3 = await write(pumplabIssuer, d.factory, factoryAbi, 'createBond', [
      router,
      terms(now),
      { adapter: 0, source, guard, policyHash: keccak('slice-locked-pumplab-v1') },
      'PumpLab Revenue Claim',
      'PLAB-RC',
    ]);
    const { bond } = await routerFrom(r3, 'BondCreated');
    d.issuers.pumplab = {
      name: 'PumpLab',
      issuer: pumplabIssuer.address,
      router,
      source,
      guard,
      token,
      bond,
    };
    saveDeployment(d);
    console.log(`  PumpLab   router ${router}  bond ${bond}`);
  }
  const p = d.issuers.pumplab!;
  const phase = (b: Address) =>
    publicClient.readContract({ address: b, abi: bondAbi, functionName: 'phase' }) as Promise<number>;
  if ((await phase(p.bond!)) === 0) {
    await write(investor, d.asset, erc20, 'approve', [p.bond!, RAISE]);
    await write(investor, p.bond!, bondAbi, 'deposit', [RAISE]);
    await write(pumplabIssuer, d.factory, factoryAbi, 'activate', [p.bond!]);
    console.log('  PumpLab bond funded and activated (50% released, 50% escrowed)');
  }

  // ---------- Oracle Agent (Watched) ----------
  // The router exists before the agent is deployed: it is the agent's x402 payTo.
  if (!d.issuers.agent?.router) {
    const r1 = await write(agentIssuer, d.factory, factoryAbi, 'createRouter');
    const { router } = await routerFrom(r1, 'RouterCreated');
    d.issuers.agent = { name: 'Oracle Agent', issuer: agentIssuer.address, router };
    saveDeployment(d);
    console.log(`  Agent     router ${router} (use as AGENT_INITIAL_PAY_TO)`);
  }
  const agentUrl = process.env.AGENT_URL;
  if (!agentUrl) {
    console.log('  Oracle Agent bond skipped: set AGENT_URL to the deployed agent endpoint.');
    return;
  }
  if (!d.issuers.agent.bond) {
    const router = d.issuers.agent.router;
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
      expectedPayTo: router,
      amount: '10000',
      maxTimeoutSeconds: 300,
      parserVersion: PARSER_VERSION,
      epochSeconds: 30,
      freshnessSeconds: 90,
    };
    await write(agentIssuer, d.asset, erc20, 'approve', [d.factory, STAKE]);
    const r2 = await write(agentIssuer, d.factory, factoryAbi, 'createBond', [
      router,
      terms(now),
      {
        adapter: 1,
        source: '0x0000000000000000000000000000000000000000',
        guard: '0x0000000000000000000000000000000000000000',
        policyHash: policyHash(policy),
      },
      'Oracle Agent Revenue Claim',
      'ORCL-RC',
    ]);
    const created = await routerFrom(r2, 'BondCreated');
    if (created.bond.toLowerCase() !== bond.toLowerCase()) throw new Error('Predicted bond address mismatch');
    d.issuers.agent = { name: 'Oracle Agent', issuer: agentIssuer.address, router, bond, endpoint: agentUrl };
    (d as any).watchPolicy = policy;
    saveDeployment(d);
    console.log(`  Agent     router ${router}  bond ${bond}`);
  }
  const a = d.issuers.agent!;
  if ((await phase(a.bond!)) === 0) {
    const raised = (await publicClient.readContract({
      address: a.bond!,
      abi: bondAbi,
      functionName: 'fundingEscrow',
    })) as bigint;
    if (raised < RAISE) {
      await write(investor, d.asset, erc20, 'approve', [a.bond!, RAISE - raised]);
      await write(investor, a.bond!, bondAbi, 'deposit', [RAISE - raised]);
    }
    console.log(
      '  Agent bond funded. Activate after the first compliant CRE report: pnpm tsx scripts/activate-watched.ts',
    );
  }
}

// Locked bonds still carry a policy commitment; it names the guard policy version.
const keccak = (s: string) => keccak256(stringToHex(s));

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
