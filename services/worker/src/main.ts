import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { address } from '@bondrail/observer/protocol';
import { storeFromEnv } from '@bondrail/observer/store';
import { createRpcTransport, rpcUrlsFromEnv } from '@bondrail/shared';
import { nextOperation } from './plan.js';
const checkTriggers = process.env.WORKER_CHECK_TRIGGERS === '1';
// Decode the original tuple when disabled, so existing deployments can still be maintained.
const legacyTermsABI = parseAbi([
  'function terms() view returns ((uint256 raiseAmount,uint256 repayCap,uint256 stake,uint256 minRevenue,uint64 fundingDeadline,uint64 maturity,uint64 secondReleaseNotBefore,uint64 secondReleaseDeadline,uint32 minOperatingPeriod,uint16 revenueBps,uint16 firstReleaseBps,uint8 milestoneMode,uint16 minFeeBps))',
]);
const bondABI = parseAbi([
  'function phase() view returns (uint8)',
  'function account() view returns (address)',
  'function undrawnPrincipal() view returns (uint256)',
  'function settleAfter() view returns (uint64)',
  'function asset() view returns (address)',
  'function terms() view returns ((uint256 raiseAmount,uint256 repayCap,uint256 stake,uint256 minRevenue,uint64 fundingDeadline,uint64 maturity,uint64 secondReleaseNotBefore,uint64 secondReleaseDeadline,uint32 minOperatingPeriod,uint16 revenueBps,uint16 firstReleaseBps,uint8 milestoneMode,uint16 minFeeBps,uint16 triggerWindowDays,uint16 stepUpBps,uint256 triggerRevenue))',
  'function activationTime() view returns (uint64)',
  'function defaultedAt() view returns (uint64)',
  'function lastTriggerCheckDay() view returns (uint64)',
  'function checkTrigger()',
  'function expireUndrawn()',
  'function finalizeSettlement()',
]);
const accountABI = parseAbi([
  'function issuerCredit() view returns (uint256)',
  'function activeBond() view returns (address)',
  'function sweep()',
  'function closeBondAtMaturity(address expectedBond)',
  'function cancelFunding(address expectedBond)',
]);
const tokenABI = parseAbi(['function balanceOf(address account) view returns (uint256)']);
// Contract maintenance only (sweeps, expiries, closes, settlement). Covenant reports for Watched bonds are
// sent by the CRE reporter (ops/bondrail-covenant.service), so each job has exactly one writer.
interface Target {
  bond: Address;
  account: Address;
}
const chainId = Number(process.env.BONDRAIL_CHAIN_ID ?? 10143);
if (chainId !== 10143 && chainId !== 31337) throw new Error('Worker forbids mainnet writes');
const { WORKER_TARGETS_FILE, WORKER_PRIVATE_KEY } = process.env;
const rpcUrls = rpcUrlsFromEnv();
if (!rpcUrls.length || !WORKER_TARGETS_FILE) throw new Error('Worker RPC and targets file required');
const targets = JSON.parse(await readFile(WORKER_TARGETS_FILE, 'utf8')) as Target[];
if (
  !Array.isArray(targets) ||
  targets.length > 16 ||
  targets.some((t) => !address(t.bond) || !address(t.account))
)
  throw new Error('Invalid bounded worker targets');
if (targets.some((t) => [t.bond, t.account].some((v) => /^0x0{40}$/i.test(v))))
  throw new Error('Replace zero-address worker placeholders');
const chain = defineChain({
  id: chainId,
  name: chainId === 10143 ? 'Monad Testnet' : 'Bondrail Local',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: rpcUrls } },
});
const rpcTransport = createRpcTransport(rpcUrls);
const client = createPublicClient({
  chain,
  // Public and wallet requests share the process bucket, including every retry.
  transport: rpcTransport,
});
let rpcChain: number;
try {
  rpcChain = await client.getChainId();
} catch {
  throw new Error('Worker RPC unavailable (provider details withheld)');
}
if (rpcChain !== chainId) throw new Error('Worker RPC chain mismatch');
const enabled = process.env.BONDRAIL_ENABLE_TESTNET_WRITES === '1';
if (!enabled || process.argv.includes('--check')) {
  console.log(
    JSON.stringify({
      network: chainId,
      targets: targets.length,
      writesEnabled: enabled,
      checkTriggers,
      keyConfigured: !!WORKER_PRIVATE_KEY,
      mode: 'diagnostic; no writes sent',
    }),
  );
  process.exit(0);
}
if (!/^0x[0-9a-fA-F]{64}$/.test(WORKER_PRIVATE_KEY ?? '')) throw new Error('Worker signer key missing');
const signer = privateKeyToAccount(WORKER_PRIVATE_KEY as Hex),
  wallet = createWalletClient({
    chain,
    account: signer,
    transport: rpcTransport,
  });
const store = storeFromEnv(),
  owner = randomUUID(),
  controller = new AbortController();
for (const name of ['SIGTERM', 'SIGINT']) process.on(name, () => controller.abort());
const pendingKey = `worker-pending:${chainId}:${signer.address.toLowerCase()}`;
const unfinished = await store.get(pendingKey);
if (unfinished && JSON.parse(unfinished).state !== 'confirmed')
  throw new Error('Unresolved prior worker transaction; reconcile its hash/nonce before restarting');
async function submitMaintenance(operation: string, bond: Address, send: () => Promise<Hex>): Promise<Hex> {
  const previous = await store.get(pendingKey);
  if (previous && JSON.parse(previous).state !== 'confirmed')
    throw new Error('Prior transaction remains unresolved');
  const nonce = await client.getTransactionCount({
    address: signer.address,
    blockTag: 'pending',
  });
  let raw = JSON.stringify({
    state: 'prepared',
    operation,
    bond,
    nonce,
    createdAt: new Date().toISOString(),
  });
  if (!(await store.cas(pendingKey, previous, raw))) throw new Error('Transaction journal contention');
  try {
    const transaction = await send();
    const submitted = JSON.stringify({
      state: 'submitted',
      operation,
      bond,
      nonce,
      transaction,
    });
    if (!(await store.cas(pendingKey, raw, submitted)))
      throw new Error('Submitted transaction journal failed');
    raw = submitted;
    const receipt = await client.waitForTransactionReceipt({
      hash: transaction,
      confirmations: 1,
      timeout: 30000,
    });
    if (receipt.status !== 'success') throw new Error('Maintenance transaction reverted');
    if (
      !(await store.cas(
        pendingKey,
        raw,
        JSON.stringify({
          state: 'confirmed',
          operation,
          bond,
          nonce,
          transaction,
        }),
      ))
    )
      throw new Error('Confirmed transaction journal failed');
    return transaction;
  } catch (e) {
    controller.abort();
    throw e;
  }
}
const maxCycles = Math.min(120, Math.max(1, Number(process.env.WORKER_MAX_CYCLES ?? 120)));
if (!Number.isSafeInteger(maxCycles)) throw new Error('Invalid cycle bound');
const maxGasPrice = BigInt(process.env.WORKER_MAX_GAS_PRICE_WEI ?? '200000000000');
let lease: string | null = null;
try {
  for (let cycle = 0; cycle < maxCycles && !controller.signal.aborted; cycle++) {
    const start = Date.now(),
      key = `worker-lease:${chainId}:${signer.address.toLowerCase()}`;
    const previous = await store.get(key);
    if (previous !== lease && previous && JSON.parse(previous).expiresAt > Date.now())
      throw new Error('Another worker holds the signer lease');
    const next = JSON.stringify({ owner, expiresAt: Date.now() + 180000 });
    if (!(await store.cas(key, previous, next))) throw new Error('Worker lease contention');
    lease = next;
    let writes = 0;
    // Keep bonds sequential; the transport spaces each read even when RPC responses are fast.
    for (const target of targets) {
      if (controller.signal.aborted || writes >= 4 || Date.now() - start > 90000) break;
      try {
        const phase = await client.readContract({
          address: target.bond,
          abi: bondABI,
          functionName: 'phase',
        });
        const revenueAccount = await client.readContract({ address: target.bond, abi: bondABI, functionName: 'account' });
        const asset = await client.readContract({ address: target.bond, abi: bondABI, functionName: 'asset' });
        if (revenueAccount.toLowerCase() !== target.account.toLowerCase()) throw new Error('Target account mismatch');
        if (writes >= 4) break;
        const block = await client.getBlock();
        // One read at a time: public RPCs rate-limit bursts (Monad testnet: 15 requests/s per IP).
        const terms = await client.readContract({ address: target.bond, abi: checkTriggers ? bondABI : legacyTermsABI, functionName: 'terms' });
        const trigger = checkTriggers && 'triggerWindowDays' in terms && terms.triggerWindowDays > 0 ? {
          triggerWindowDays: terms.triggerWindowDays,
          activationTime: await client.readContract({ address: target.bond, abi: bondABI, functionName: 'activationTime' }),
          defaultedAt: await client.readContract({ address: target.bond, abi: bondABI, functionName: 'defaultedAt' }),
          lastTriggerCheckDay: await client.readContract({ address: target.bond, abi: bondABI, functionName: 'lastTriggerCheckDay' }),
        } : undefined;
        const undrawnPrincipal = await client.readContract({ address: target.bond, abi: bondABI, functionName: 'undrawnPrincipal' });
        const settleAfter = await client.readContract({ address: target.bond, abi: bondABI, functionName: 'settleAfter' });
        const balance = await client.readContract({ address: asset, abi: tokenABI, functionName: 'balanceOf', args: [revenueAccount] });
        const credit = await client.readContract({ address: revenueAccount, abi: accountABI, functionName: 'issuerCredit' });
        const freshPhase = await client.readContract({ address: target.bond, abi: bondABI, functionName: 'phase' });
        const operation = nextOperation({
          phase: freshPhase,
          now: block.timestamp,
          ...terms,
          trigger,
          undrawnPrincipal,
          settleAfter,
          freeReceipts: balance > credit ? balance - credit : 0n,
        });
        if (!operation) continue;
        if ((await client.getGasPrice()) > maxGasPrice) throw new Error('Gas price exceeds configured bound');
        let tx: Hex;
        if (operation === 'expireUndrawn' || operation === 'finalizeSettlement' || operation === 'checkTrigger') {
          const { request } = await client.simulateContract({
            account: signer,
            address: target.bond,
            abi: bondABI,
            functionName: operation,
            gas: 1000000n,
            gasPrice: maxGasPrice,
          });
          tx = await submitMaintenance(operation, target.bond, () => wallet.writeContract(request));
        } else if (operation === 'sweep') {
          const active = await client.readContract({
            address: revenueAccount,
            abi: accountABI,
            functionName: 'activeBond',
          });
          if (active.toLowerCase() !== target.bond.toLowerCase())
            throw new Error('Account reserved for another bond');
          const { request } = await client.simulateContract({
            account: signer,
            address: revenueAccount,
            abi: accountABI,
            functionName: 'sweep',
            gas: 1000000n,
            gasPrice: maxGasPrice,
          });
          tx = await submitMaintenance(operation, target.bond, () => wallet.writeContract(request));
        } else {
          const { request } = await client.simulateContract({
            account: signer,
            address: revenueAccount,
            abi: accountABI,
            functionName: operation,
            args: [target.bond],
            gas: 1000000n,
            gasPrice: maxGasPrice,
          });
          tx = await submitMaintenance(operation, target.bond, () => wallet.writeContract(request));
        }
        writes++;
        await store.cas(
          `worker-tx:${tx}`,
          null,
          JSON.stringify({ operation, bond: target.bond, status: 'confirmed' }),
        );
        console.log(
          JSON.stringify({
            operation,
            bond: target.bond,
            transaction: tx,
            status: 'confirmed',
          }),
        );
      } catch (e) {
        // viem's shortMessage names the failure (e.g. a revert reason) without request or provider details.
        const err = e as { shortMessage?: string; details?: string };
        const reason = [err.shortMessage ?? (e instanceof Error ? e.message : 'unknown'), err.details].filter(Boolean).join(': ');
        console.error(
          JSON.stringify({
            bond: target.bond,
            status: 'failed',
            error: 'worker_operation_failed; check chain state and durable transaction journal',
            reason: reason.slice(0, 200),
          }),
        );
      }
    }
    if (!controller.signal.aborted)
      await delay(Math.max(1000, 30000 - (Date.now() - start)), undefined, {
        signal: controller.signal,
      }).catch(() => undefined);
  }
} finally {
  if (lease)
    await store.cas(
      `worker-lease:${chainId}:${signer.address.toLowerCase()}`,
      lease,
      JSON.stringify({ owner, expiresAt: 0 }),
    );
}
