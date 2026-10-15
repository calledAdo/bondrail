import {
  BaseError, InsufficientFundsError, formatEther, keccak256, TransactionReceiptNotFoundError, WaitForTransactionReceiptTimeoutError,
  type Account, type Address, type Chain, type Hex, type PublicClient, type Transport, type WalletClient,
} from 'viem';
import type { DurableStore } from '@bondrail/observer/store';
import { isTransientRpcError } from '@bondrail/shared';
import { feesForBlock, gasLimit, type GasPolicy } from './gas.js';

type GasClient = Pick<PublicClient, 'getBlock' | 'getBalance' | 'estimateGas' | 'getTransactionCount' |
  'getTransactionReceipt' | 'waitForTransactionReceipt'>;
type GasWallet = WalletClient<Transport, Chain, Account>;
export type GasEvent = { event: string; wallet: Address; [key: string]: unknown };
export interface Outcome { transaction: Hex; errorReason?: string }
interface Attempt {
  transaction: Hex;
  serializedTransaction: Hex;
  gas: string;
  maxFeePerGas: string;
  maxPriorityFeePerGas: string;
  createdAt: number;
  cancel: boolean;
}
interface Job {
  version: 2;
  key: string;
  binding: string;
  nonce: number;
  to: Address;
  data: Hex;
  validBefore: number;
  attempts: Attempt[];
  result?: Outcome;
}
interface Options {
  chainId: number;
  client: GasClient;
  wallet: GasWallet;
  store: DurableStore;
  policy: GasPolicy;
  now: () => number;
  log: (event: GasEvent) => void;
  onLowBalance?: (event: GasEvent) => Promise<void>;
}

/** One durable outstanding nonce per key. Keep one writer process per key/namespace. */
export function settlementSender(o: Options) {
  const { client, wallet, store, policy } = o;
  const address = wallet.account.address;
  const slotKey = `facilitator-wallet:${o.chainId}:${address.toLowerCase()}`;
  let queue: Promise<unknown> = Promise.resolve();
  let estimatedGas = policy.maxGas; // conservative until a real settlement has been estimated
  let blockedReason: string | undefined;
  let lastAlert = -Infinity;
  const log = (event: string, details: Record<string, unknown> = {}) => o.log({ event, wallet: address, ...details });
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  };
  const decode = (raw: string | null): Job | null => {
    if (!raw || raw === 'null') return null;
    const job = JSON.parse(raw) as Job;
    if (job.version !== 2 || !Number.isSafeInteger(job.nonce) || job.nonce < 0 || !job.attempts?.length ||
        job.attempts.some(a => keccak256(a.serializedTransaction) !== a.transaction))
      throw new Error('invalid_settlement_journal');
    return job;
  };
  async function mirror(job: Job) {
    const raw = await store.get(job.key);
    const saved = raw ? JSON.parse(raw) as Job : undefined;
    if (saved && (saved.binding !== job.binding || saved.attempts?.[0]?.transaction !== job.attempts[0].transaction))
      throw new Error('settlement_journal_conflict');
    const next = JSON.stringify(job);
    if (raw !== next && !await store.cas(job.key, raw, next)) throw new Error('settlement_journal_conflict');
  }
  async function save(previous: Job, next: Job) {
    if (!await store.cas(slotKey, JSON.stringify(previous), JSON.stringify(next)))
      throw new Error('settlement_journal_conflict');
    await mirror(next);
  }
  async function finish(job: Job, result: Outcome) {
    // The slot is authoritative until the final per-authorization record is durable.
    const next = { ...job, result };
    await save(job, next);
    if (!await store.cas(slotKey, JSON.stringify(next), 'null')) throw new Error('settlement_journal_conflict');
    blockedReason = undefined;
    return result;
  }
  async function affordable(gas: bigint, maxFeePerGas: bigint) {
    const balance = await client.getBalance({ address, blockTag: 'latest' });
    const required = gas * maxFeePerGas;
    if (balance < required) {
      log('insufficient_gas_funds', { balanceWei: balance.toString(), requiredWei: required.toString() });
      throw new Error('insufficient_gas_funds');
    }
  }
  async function sign(to: Address, data: Hex, nonce: number, gas: bigint,
    fees: { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }, cancel = false): Promise<Attempt> {
    await affordable(gas, fees.maxFeePerGas);
    const request = await wallet.prepareTransactionRequest({
      account: wallet.account, chainId: o.chainId, type: 'eip1559', to, data, value: 0n,
      nonce, gas, ...fees,
    });
    const serializedTransaction = await wallet.signTransaction(request);
    return { serializedTransaction, transaction: keccak256(serializedTransaction), gas: String(gas),
      maxFeePerGas: String(fees.maxFeePerGas), maxPriorityFeePerGas: String(fees.maxPriorityFeePerGas),
      createdAt: o.now(), cancel };
  }
  async function receipts(job: Job): Promise<Outcome | undefined> {
    for (const attempt of [...job.attempts].reverse()) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: attempt.transaction });
        if (receipt.transactionHash !== attempt.transaction) throw new Error('settlement_receipt_mismatch');
        return { transaction: attempt.transaction, ...(attempt.cancel ? { errorReason: 'settlement_cancelled' } :
          receipt.status !== 'success' ? { errorReason: 'settlement_reverted' } : {}) };
      } catch (e) { if (!(e instanceof TransactionReceiptNotFoundError)) throw e; }
    }
  }
  async function progress(job: Job, wait: boolean): Promise<Outcome> {
    await mirror(job); // also repairs a crash between writing the slot and the authorization journal
    if (job.result) {
      if (!await store.cas(slotKey, JSON.stringify(job), 'null')) throw new Error('settlement_journal_conflict');
      return job.result;
    }
    const found = await receipts(job);
    if (found) return finish(job, found);
    const latest = await client.getTransactionCount({ address, blockTag: 'latest' });
    if (latest > job.nonce) {
      // Recheck after the nonce read to cover inclusion between RPC calls. Never treat an
      // unknown same-nonce transaction (possibly an operator cancellation) as a settlement.
      const raced = await receipts(job);
      return finish(job, raced ?? { transaction: job.attempts.at(-1)!.transaction, errorReason: 'settlement_nonce_consumed' });
    }
    if (latest < job.nonce) throw new Error('wallet_nonce_gap');
    let attempt = job.attempts.at(-1)!;
    const block = await client.getBlock({ blockTag: 'latest' });
    const expired = Math.max(o.now(), Number(block.timestamp)) + 6 >= job.validBefore;
    if (o.now() - attempt.createdAt >= policy.stuckSeconds || (expired && !attempt.cancel)) {
      const fees = feesForBlock(block.baseFeePerGas, policy, {
        maxFeePerGas: BigInt(attempt.maxFeePerGas), maxPriorityFeePerGas: BigInt(attempt.maxPriorityFeePerGas),
      });
      const cancel = expired || attempt.cancel;
      const replacement = await sign(cancel ? address : job.to, cancel ? '0x' : job.data,
        job.nonce, cancel ? 21_000n : BigInt(attempt.gas), fees, cancel);
      const next = { ...job, attempts: [...job.attempts, replacement] };
      await save(job, next); // every hash is durable before send; previous attempts may still win
      job = next;
      attempt = replacement;
      log(cancel ? 'settlement_cancellation' : 'settlement_fee_replacement', { nonce: job.nonce, transaction: attempt.transaction });
    }
    await affordable(BigInt(attempt.gas), BigInt(attempt.maxFeePerGas));
    try { await wallet.sendRawTransaction({ serializedTransaction: attempt.serializedTransaction }); }
    catch {
      // Acceptance is ambiguous. Retain signed bytes and this nonce; receipt/rebroadcast recovers it.
      log('settlement_broadcast_unconfirmed', { nonce: job.nonce, transaction: attempt.transaction });
    }
    if (wait) {
      try {
        const receipt = await client.waitForTransactionReceipt({ hash: attempt.transaction, confirmations: 1,
          timeout: 20_000, pollingInterval: 1500, checkReplacement: false, retryCount: 0 });
        if (receipt.transactionHash !== attempt.transaction) throw new Error('settlement_receipt_mismatch');
        return finish(job, { transaction: attempt.transaction, ...(attempt.cancel ? { errorReason: 'settlement_cancelled' } :
          receipt.status !== 'success' ? { errorReason: 'settlement_reverted' } : {}) });
      } catch (e) {
        if (!(isTransientRpcError(e) || e instanceof WaitForTransactionReceiptTimeoutError ||
          e instanceof TransactionReceiptNotFoundError)) throw e;
      }
    }
    const mined = await receipts(job);
    return mined ? finish(job, mined) : { transaction: attempt.transaction, errorReason: 'settlement_pending' };
  }
  async function advance(job: Job, wait: boolean): Promise<Outcome> {
    blockedReason = undefined;
    try { return await progress(job, wait); }
    catch (e) {
      blockedReason = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'settlement_recovery_failed';
      log(blockedReason, { nonce: job.nonce });
      let current = job;
      try { current = decode(await store.get(slotKey)) ?? job; }
      catch { /* A store outage must not erase the hash already known to this caller. */ }
      return { transaction: current.attempts.at(-1)!.transaction,
        errorReason: blockedReason === 'settlement_receipt_mismatch' ? blockedReason : 'settlement_pending' };
    }
  }
  return {
    submit(key: string, binding: string, build: () => Promise<{ to: Address; data: Hex; validBefore: number }>,
      legacy: (transaction: Hex) => Promise<void>): Promise<Outcome> {
      return serial(async () => {
        blockedReason = undefined;
        const slot = await store.get(slotKey);
        const active = decode(slot);
        if (active?.key === key) {
          if (active.binding !== binding) throw new Error('authorization_already_bound');
          return advance(active, true);
        }
        // Resolve an already-bound payment before returning an empty-hash refusal for
        // another active job. An old payment may already have charged its payer.
        const old = await store.get(key);
        if (old) {
          const saved = JSON.parse(old) as Job & { transaction?: Hex };
          if (saved.binding !== binding) throw new Error('authorization_already_bound');
          if (saved.version === 2) {
            // A consumed nonce may have been observed before its receipt was available.
            if (saved.result?.errorReason === 'settlement_nonce_consumed') return await receipts(saved) ?? saved.result;
            if (!saved.result) throw new Error('settlement_journal_conflict');
            return saved.result;
          }
          // Backward compatibility: hash-only entries cannot safely be recreated or replaced.
          if (!/^0x[0-9a-fA-F]{64}$/.test(saved.transaction ?? '')) throw new Error('invalid_settlement_journal');
          try { await legacy(saved.transaction!); return { transaction: saved.transaction! }; }
          catch (e) { return { transaction: saved.transaction!, errorReason:
            e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'settlement_pending' }; }
        }
        if (active) {
          await advance(active, false);
          if (decode(await store.get(slotKey))) throw new Error('wallet_busy');
        }
        const availableSlot = await store.get(slotKey);
        if (decode(availableSlot)) throw new Error('wallet_busy');
        const tx = await build();
        const [latest, pending, block] = await Promise.all([
          client.getTransactionCount({ address, blockTag: 'latest' }),
          client.getTransactionCount({ address, blockTag: 'pending' }), client.getBlock({ blockTag: 'latest' }),
        ]);
        if (pending !== latest) {
          blockedReason = 'wallet_nonce_blocked';
          log(blockedReason, { latest, pending });
          throw new Error(blockedReason);
        }
        const fees = feesForBlock(block.baseFeePerGas, policy);
        // Some nodes reject estimation itself when the sender cannot fund even intrinsic gas.
        await affordable(21_000n, fees.maxFeePerGas);
        let estimate: bigint;
        try {
          estimate = await client.estimateGas({ account: wallet.account, to: tx.to, data: tx.data, value: 0n, ...fees });
        } catch (error) {
          if (error instanceof BaseError && error.walk(cause => cause instanceof InsufficientFundsError) instanceof InsufficientFundsError) {
            log('insufficient_gas_funds', { phase: 'estimate' });
            throw new Error('insufficient_gas_funds');
          }
          throw error;
        }
        const gas = gasLimit(estimate, policy);
        estimatedGas = gas;
        const attempt = await sign(tx.to, tx.data, latest, gas, fees);
        const job: Job = { version: 2, key, binding, nonce: latest, ...tx, attempts: [attempt] };
        // Funding refusal happens before either journal write. The slot must come first so
        // a crash can never orphan a signed authorization and allocate its nonce again.
        if (!await store.cas(slotKey, availableSlot, JSON.stringify(job)))
          throw new Error('settlement_journal_conflict');
        return advance(job, true);
      });
    },
    recover: () => serial(async () => {
      const active = decode(await store.get(slotKey));
      if (active) await advance(active, false);
    }),
    async health() {
      const [balance, block, raw, latest, pending] = await Promise.all([
        client.getBalance({ address, blockTag: 'latest' }), client.getBlock({ blockTag: 'latest' }), store.get(slotKey),
        client.getTransactionCount({ address, blockTag: 'latest' }), client.getTransactionCount({ address, blockTag: 'pending' }),
      ]);
      const active = decode(raw);
      // An older settlement can still win a race against its cheaper cancellation.
      const reserved = active?.attempts.reduce((max, attempt) => {
        const cost = BigInt(attempt.gas) * BigInt(attempt.maxFeePerGas);
        return cost > max ? cost : max;
      }, 0n) ?? 0n;
      const available = balance > reserved ? balance - reserved : 0n;
      let feeError: string | undefined;
      let price = policy.maxFeePerGas;
      try { price = feesForBlock(block.baseFeePerGas, policy).maxFeePerGas; }
      catch { feeError = 'gas_fee_cap_exceeded'; }
      const cost = estimatedGas * price;
      const remaining = cost === 0n ? null : available / cost;
      const lowBalance = remaining !== null && remaining < BigInt(policy.lowBalanceSettlements);
      const data = { wallet: address, network: `eip155:${o.chainId}`, balanceWei: balance.toString(),
        balanceNative: formatEther(balance), reservedWei: reserved.toString(), estimatedGasLimit: estimatedGas.toString(),
        estimatedSettlementCostWei: cost.toString(), settlementsRemaining: remaining?.toString() ?? null,
        lowBalance, latestNonce: latest, pendingNonce: pending, inFlightNonce: active?.nonce ?? null,
        blockedReason: feeError ?? blockedReason ?? (!active && pending !== latest ? 'wallet_nonce_blocked' : null) };
      if (lowBalance && o.now() - lastAlert >= 300) {
        lastAlert = o.now();
        const event = { event: 'facilitator_low_gas_balance', ...data };
        o.log(event);
        try { await o.onLowBalance?.(event); } catch { log('low_balance_alert_failed'); }
      }
      if (!lowBalance) lastAlert = -Infinity;
      return data;
    },
  };
}
