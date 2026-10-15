import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BaseError, InsufficientFundsError, keccak256, parseGwei, parseTransaction, TransactionReceiptNotFoundError,
  WaitForTransactionReceiptTimeoutError, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { DurableStore } from '@bondrail/observer/store';
import { settlementSender, type GasEvent } from '../src/settlement.js';
import { defaultGasPolicy, type GasPolicy } from '../src/gas.js';

const account = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const recipient = '0x1111111111111111111111111111111111111111' as const;
const slotKey = `facilitator-wallet:10143:${account.address.toLowerCase()}`;
function fixture(policy: GasPolicy = defaultGasPolicy) {
  const values = new Map<string, string>();
  const state = { balance: 10n ** 18n, baseFee: parseGwei('100'), estimate: 190_000n,
    latest: 0, pending: 0, now: 1000, autoMine: true, sendFails: false, failMirror: false,
    estimateError: undefined as Error | undefined,
    status: 'success', signs: 0, builds: 0, writes: [] as Hex[], events: [] as GasEvent[], alerts: [] as GasEvent[],
    receipts: new Map<Hex, { transactionHash: Hex; status: string }>() };
  const store: DurableStore = {
    get: async key => values.get(key) ?? null,
    cas: async (key, old, next) => {
      if (key !== slotKey && state.failMirror) throw new Error('store unavailable');
      if ((values.get(key) ?? null) !== old) return false;
      values.set(key, next); return true;
    },
  };
  const receipt = async ({ hash }: { hash: Hex }) => {
    const r = state.receipts.get(hash);
    if (!r) throw new TransactionReceiptNotFoundError({ hash });
    return r;
  };
  const mine = (raw: Hex, status = 'success') => {
    const tx = parseTransaction(raw);
    const hash = keccak256(raw);
    state.receipts.set(hash, { transactionHash: hash, status });
    state.latest = state.pending = tx.nonce! + 1;
  };
  const client = {
    getBlock: async () => ({ timestamp: BigInt(state.now), baseFeePerGas: state.baseFee }),
    getBalance: async () => state.balance,
    estimateGas: async () => { if (state.estimateError) throw state.estimateError; return state.estimate; },
    getTransactionCount: async ({ blockTag }: { blockTag: string }) => blockTag === 'pending' ? state.pending : state.latest,
    getTransactionReceipt: receipt,
    waitForTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      if (!state.receipts.has(hash)) throw new WaitForTransactionReceiptTimeoutError({ hash });
      return receipt({ hash });
    },
  };
  const wallet = {
    account, prepareTransactionRequest: async (request: unknown) => request,
    signTransaction: async (request: Parameters<typeof account.signTransaction>[0]) => {
      state.signs++; return account.signTransaction(request);
    },
    sendRawTransaction: async ({ serializedTransaction }: { serializedTransaction: Hex }) => {
      state.writes.push(serializedTransaction);
      if (state.autoMine) mine(serializedTransaction, state.status);
      if (state.sendFails) throw new Error('connection lost');
      return keccak256(serializedTransaction);
    },
  };
  const restart = () => settlementSender({ chainId: 10143, store, policy, now: () => state.now,
    client: client as never, wallet: wallet as never,
    log: e => state.events.push(e), onLowBalance: async e => { state.alerts.push(e); } });
  const build = async () => { state.builds++; return { to: recipient, data: '0x12345678' as Hex, validBefore: 1300 }; };
  const sender = restart();
  const submit = (key = 'a', service = sender) => service.submit(key, `${key}:binding`, build, async () => {});
  return { sender, state, values, store, submit, restart, mine, build };
}

test('refuses unaffordable gas before signing, either journal, or broadcast; same authorization retries after funding', async () => {
  const f = fixture();
  f.state.balance = 218_500n * parseGwei('112') - 1n;
  await assert.rejects(f.submit(), /insufficient_gas_funds/);
  assert.equal(f.values.size, 0);
  assert.equal(f.state.signs, 0);
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.events.at(-1)?.event, 'insufficient_gas_funds');
  f.state.balance++;
  const result = await f.submit();
  assert.equal(result.errorReason, undefined);
  const signed = parseTransaction(f.state.writes[0]);
  assert.equal(signed.gas, 218_500n);
  assert.equal(signed.maxFeePerGas, parseGwei('112'));
  assert.equal(signed.maxPriorityFeePerGas, parseGwei('2'));
  assert.equal(signed.nonce, 0);
});

test('gas or fee cap refusal leaves the nonce and journals untouched', async () => {
  for (const reason of ['gas_limit_exceeded', 'gas_fee_cap_exceeded']) {
    const f = fixture();
    if (reason === 'gas_limit_exceeded') f.state.estimate = 500_000n;
    else f.state.baseFee = parseGwei('149');
    await assert.rejects(f.submit(), new RegExp(reason));
    assert.equal(f.values.size, 0);
    assert.equal(f.state.signs, 0);
  }
});

test('RPC funding refusal during estimation returns the same uncharged error without a journal', async () => {
  const f = fixture();
  f.state.estimateError = new BaseError('Estimate failed', { cause: new InsufficientFundsError() });
  await assert.rejects(f.submit(), /insufficient_gas_funds/);
  assert.equal(f.values.size, 0);
  assert.equal(f.state.signs, 0);
  assert.equal(f.state.events.at(-1)?.event, 'insufficient_gas_funds');
  f.state.estimateError = new Error('execution reverted');
  await assert.rejects(f.submit(), /execution reverted/);
});

test('concurrent different authorizations use contiguous mined nonces; duplicate requests reuse the result', async () => {
  const f = fixture();
  const [a, b, replay] = await Promise.all([f.submit('a'), f.submit('b'), f.submit('a')]);
  assert.equal(a.errorReason, undefined);
  assert.equal(b.errorReason, undefined);
  assert.deepEqual(replay, a);
  assert.deepEqual(f.state.writes.map(t => parseTransaction(t).nonce), [0, 1]);
  assert.equal(f.values.get(slotKey), 'null');
});

test('a timeout reserves the nonce across new payments and restart; no later nonce is broadcast', async () => {
  const f = fixture(); f.state.autoMine = false;
  const a = await f.submit('a');
  assert.equal(a.errorReason, 'settlement_pending');
  await assert.rejects(f.submit('b'), /wallet_busy/);
  assert.equal(f.state.signs, 1);
  assert.equal(f.state.builds, 1);
  assert.equal(f.values.has('b'), false);
  const service = f.restart();
  f.state.autoMine = true;
  const recovered = await f.submit('a', service);
  assert.equal(recovered.transaction, a.transaction);
  assert.equal(recovered.errorReason, undefined);
  assert.equal(f.state.signs, 1);
  assert.ok(f.state.writes.every(raw => raw === f.state.writes[0]));
  await f.submit('b', service);
  assert.equal(parseTransaction(f.state.writes.at(-1)!).nonce, 1);
});

test('an older paid or legacy authorization never becomes an empty-hash busy refusal during another job', async () => {
  const f = fixture();
  const original = await f.submit('a');
  f.state.autoMine = false;
  assert.equal((await f.submit('b')).errorReason, 'settlement_pending');
  assert.deepEqual(await f.submit('a'), original);
  const hash = `0x${'ab'.repeat(32)}`;
  f.values.set('legacy', JSON.stringify({ binding: 'legacy:binding', transaction: hash }));
  assert.equal((await f.submit('legacy')).transaction, hash);
  assert.equal(f.state.writes.length, 2);
});

test('crash after slot write but before authorization journal/send recovers the original bytes', async () => {
  const f = fixture(); f.state.failMirror = true;
  assert.equal((await f.submit()).errorReason, 'settlement_pending');
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.values.has('a'), false);
  const expected = JSON.parse(f.values.get(slotKey)!).attempts[0].transaction;
  f.state.failMirror = false;
  await f.restart().recover();
  assert.equal(keccak256(f.state.writes[0]), expected);
  assert.equal(f.state.signs, 1);
  assert.equal(f.values.get(slotKey), 'null');
});

test('lost broadcast response is resolved by the exact signed receipt', async () => {
  const f = fixture(); f.state.sendFails = true;
  const result = await f.submit();
  assert.equal(result.errorReason, undefined);
  assert.equal(result.transaction, keccak256(f.state.writes[0]));
  assert.equal(f.state.signs, 1);
});

test('background recovery raises both fees at the same nonce; the original can still win', async () => {
  const f = fixture(); f.state.autoMine = false;
  const original = await f.submit();
  f.state.now += 31;
  await f.sender.recover();
  const [first, second] = f.state.writes.map(raw => parseTransaction(raw));
  assert.equal(second.nonce, first.nonce);
  assert.equal(second.to, first.to);
  assert.equal(second.data, first.data);
  assert.equal(second.gas, first.gas);
  assert.ok(second.maxFeePerGas! > first.maxFeePerGas! * 9n / 8n);
  assert.ok(second.maxPriorityFeePerGas! > first.maxPriorityFeePerGas! * 9n / 8n);
  f.mine(f.state.writes[0]);
  const result = await f.submit();
  assert.equal(result.transaction, original.transaction);
  assert.equal(result.errorReason, undefined);
  assert.equal(f.state.signs, 2);
});

test('a crash while mirroring a replacement retains its bytes and all prior attempts across restart', async () => {
  const f = fixture(); f.state.autoMine = false;
  await f.submit(); f.state.now += 31; f.state.failMirror = true;
  await f.sender.recover();
  assert.equal(f.state.signs, 2);
  assert.equal(f.state.writes.length, 1);
  const job = JSON.parse(f.values.get(slotKey)!);
  assert.equal(job.attempts.length, 2);
  f.state.failMirror = false; f.state.autoMine = true;
  await f.restart().recover();
  assert.equal(f.state.signs, 2);
  assert.equal(keccak256(f.state.writes[1]), job.attempts[1].transaction);
  assert.equal(JSON.parse(f.values.get('a')!).result.transaction, job.attempts[1].transaction);
  assert.equal(f.values.get(slotKey), 'null');
});

test('replacement receipt can complete settlement and reverts consume the nonce without reporting success', async () => {
  for (const status of ['success', 'reverted']) {
    const f = fixture(); f.state.autoMine = false;
    await f.submit(); f.state.now += 31;
    f.state.autoMine = true; f.state.status = status;
    const result = await f.submit();
    assert.equal(result.transaction, keccak256(f.state.writes[1]));
    assert.equal(result.errorReason, status === 'success' ? undefined : 'settlement_reverted');
    assert.equal(f.values.get(slotKey), 'null');
    await f.submit('b');
    assert.equal(parseTransaction(f.state.writes.at(-1)!).nonce, 1);
  }
});

test('replacement fee caps retain the slot and do not allocate another nonce', async () => {
  const f = fixture({ ...defaultGasPolicy, maxFeePerGas: parseGwei('120') });
  f.state.autoMine = false;
  await f.submit(); f.state.now += 31;
  await f.sender.recover();
  assert.equal(f.state.signs, 1);
  assert.equal(f.state.writes.length, 1);
  assert.equal((await f.sender.health()).blockedReason, 'gas_fee_cap_exceeded');
  await assert.rejects(f.submit('b'), /wallet_busy/);
});

test('expiry clears a stuck nonce with a capped 21k self-transfer; cancellation is never payment success', async () => {
  const f = fixture(); f.state.autoMine = false;
  await f.submit(); f.state.now = 1300; f.state.autoMine = true;
  await f.sender.recover();
  const cancel = parseTransaction(f.state.writes[1]);
  assert.equal(cancel.nonce, 0);
  assert.equal(cancel.to?.toLowerCase(), account.address.toLowerCase());
  assert.equal(cancel.data ?? '0x', '0x');
  assert.equal(cancel.value ?? 0n, 0n);
  assert.equal(cancel.gas, 21_000n);
  assert.equal((await f.submit()).errorReason, 'settlement_cancelled');
  assert.equal(f.values.get(slotKey), 'null');
});

test('health reserves an older settlement that can still win against a pending cheaper cancellation', async () => {
  const f = fixture(); f.state.autoMine = false;
  await f.submit(); f.state.now = 1300;
  await f.sender.recover();
  const health = await f.sender.health();
  assert.equal(health.reservedWei, String(218_500n * parseGwei('112')));
  f.mine(f.state.writes[0]);
  const result = await f.submit();
  assert.equal(result.errorReason, undefined);
  assert.equal(result.transaction, keccak256(f.state.writes[0]));
});

test('foreign pending nonce fails closed and a foreign mined replacement is never settlement success', async () => {
  const f = fixture(); f.state.pending = 1;
  await assert.rejects(f.submit(), /wallet_nonce_blocked/);
  assert.equal(f.values.size, 0);
  f.state.pending = 0; f.state.autoMine = false;
  await f.submit(); f.state.latest = f.state.pending = 1;
  assert.equal((await f.submit()).errorReason, 'settlement_nonce_consumed');
  assert.equal(f.values.get(slotKey), 'null');
  // Late receipt visibility can still prove the original settlement on replay.
  f.mine(f.state.writes[0]);
  assert.equal((await f.submit()).errorReason, undefined);
});

test('legacy hash journals only poll; different bindings cannot reuse an authorization', async () => {
  const f = fixture(); const hash = `0x${'ab'.repeat(32)}` as Hex;
  f.values.set('a', JSON.stringify({ binding: 'a:binding', transaction: hash }));
  let polled: Hex | undefined;
  assert.equal((await f.sender.submit('a', 'a:binding', f.build, async tx => { polled = tx; })).transaction, hash);
  assert.equal(polled, hash);
  assert.equal(f.state.signs, 0);
  await assert.rejects(f.sender.submit('a', 'different', f.build, async () => {}), /authorization_already_bound/);
});

test('health budgets reserved gas, exposes nonce state and throttles low-balance hooks', async () => {
  const f = fixture(); f.state.balance = parseGwei('100000000'); // 0.1 native
  let health = await f.sender.health();
  assert.equal(health.balanceNative, '0.1');
  assert.equal(health.settlementsRemaining, '1'); // boot uses conservative cap
  assert.equal(health.lowBalance, true);
  await f.sender.health();
  assert.equal(f.state.alerts.length, 1);
  f.state.autoMine = false; await f.submit();
  health = await f.sender.health();
  assert.equal(health.inFlightNonce, 0);
  assert.equal(health.reservedWei, String(218_500n * parseGwei('112')));
  assert.equal(health.settlementsRemaining, '3');
  f.state.now += 301; await f.sender.health();
  assert.equal(f.state.alerts.length, 2);
});

test('free local-chain fees do not make health divide by zero', async () => {
  const f = fixture({ ...defaultGasPolicy, priorityFeePerGas: 0n });
  f.state.baseFee = 0n;
  const health = await f.sender.health();
  assert.equal(health.estimatedSettlementCostWei, '0');
  assert.equal(health.settlementsRemaining, null);
  assert.equal(health.lowBalance, false);
});
