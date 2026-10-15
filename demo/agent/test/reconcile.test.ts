import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeEventTopics, encodeAbiParameters, parseAbi, type Address, type Hex } from 'viem';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '@bondrail/observer/store';
import { receiptProvesPayment, reconcile } from '../src/lib/reconcile';
import type { PaymentRecord } from '../src/lib/payment';

const payer = '0x1111111111111111111111111111111111111111' as Address;
const recipient = '0x2222222222222222222222222222222222222222' as Address;
const token = '0x3333333333333333333333333333333333333333' as Address;
const nonce = `0x${'44'.repeat(32)}` as Hex;
const abi = parseAbi([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
  'event Settled(address indexed payer,uint256 value,bytes32 indexed nonce)',
]);
const record: PaymentRecord = {
  state: 'settlement_pending',
  binding: 'test',
  payloadHash: 'test',
  requirements: {
    scheme: 'exact',
    network: 'eip155:10143',
    asset: token,
    amount: '10000',
    payTo: recipient,
    maxTimeoutSeconds: 300,
    extra: {},
  },
  payer,
  nonce,
  resource: 'https://example.com/api/oracle',
  createdAt: '2026-10-09',
  result: 'cached answer',
};
const transfer = {
  address: token,
  data: encodeAbiParameters([{ type: 'uint256' }], [10000n]),
  topics: encodeEventTopics({
    abi,
    eventName: 'Transfer',
    args: { from: payer, to: recipient },
  }) as Hex[],
};
const used = {
  address: token,
  data: '0x' as Hex,
  topics: encodeEventTopics({
    abi,
    eventName: 'AuthorizationUsed',
    args: { authorizer: payer, nonce },
  }) as Hex[],
};
const settled = {
  address: recipient,
  data: encodeAbiParameters([{ type: 'uint256' }], [10000n]),
  topics: encodeEventTopics({ abi, eventName: 'Settled', args: { payer, nonce } }) as Hex[],
};
test('reconciliation requires exact token, amount, destination and authorization nonce', () => {
  assert.equal(receiptProvesPayment(record, [transfer, used, settled]), true);
  assert.equal(receiptProvesPayment(record, [transfer, used]), false, 'direct token transfer is not account settlement');
  assert.equal(receiptProvesPayment(record, [transfer, used, { ...settled, address: payer }]), false);
  assert.equal(receiptProvesPayment(record, [transfer, used, { ...settled, data: encodeAbiParameters([{ type: 'uint256' }], [1n]) }]), false);
  assert.equal(receiptProvesPayment(record, [transfer]), false);
  assert.equal(receiptProvesPayment(record, [used]), false);
  assert.equal(receiptProvesPayment(record, [{ ...transfer, address: recipient }, used, settled]), false);
  assert.equal(
    receiptProvesPayment(record, [
      {
        ...transfer,
        data: encodeAbiParameters([{ type: 'uint256' }], [9999n]),
      },
      used, settled,
    ]),
    false,
  );
  assert.equal(receiptProvesPayment({ ...record, nonce: `0x${'55'.repeat(32)}` }, [transfer, used, settled]), false);
  assert.equal(
    receiptProvesPayment({ ...record, requirements: { ...record.requirements, payTo: payer } }, [
      transfer,
      used, settled,
    ]),
    false,
  );
});

const transaction = `0x${'aa'.repeat(32)}` as Hex;
const key = `payment:0x${'bb'.repeat(32)}`;
function clientFixture() {
  const state = { chainId: 10143, status: 'success', head: 11n, used: true, reads: 0,
    logs: [transfer, used, settled] };
  const client = {
    getChainId: async () => state.chainId,
    getTransactionReceipt: async ({ hash }: { hash: Hex }) => {
      assert.equal(hash, transaction);
      return { status: state.status, blockNumber: 10n, logs: state.logs };
    },
    getBlockNumber: async () => state.head,
    readContract: async (request: { address: Address; functionName: string; args: unknown[]; blockNumber: bigint }) => {
      assert.equal(request.address, token);
      assert.equal(request.functionName, 'authorizationState');
      assert.deepEqual(request.args, [payer, nonce]);
      assert.equal(request.blockNumber, 10n);
      state.reads++;
      return state.used;
    },
  } as unknown as NonNullable<Parameters<typeof reconcile>[5]>;
  return { state, client };
}

test('pending payment becomes complete only after nonce and account receipt proof; repeat is idempotent', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bondrail-reconcile-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new LocalStore(dir);
  await store.cas(key, null, JSON.stringify(record));
  const { client, state } = clientFixture();
  const result = await reconcile(store, key, transaction, ['https://rpc.example'], 10143, client);
  assert.deepEqual(result, { status: 'complete', transaction });
  const saved = JSON.parse((await store.get(key))!);
  assert.equal(saved.result, 'cached answer');
  assert.equal(saved.state, 'complete');
  assert.equal(saved.settlement.success, true);
  assert.equal(state.reads, 1);
  assert.deepEqual(await reconcile(store, key, transaction, ['https://rpc.example'], 10143, client), result);
  assert.equal(state.reads, 1);
});

test('wrong chain, reverted/unconfirmed receipts, unused nonce and direct transfers stay pending', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'bondrail-reconcile-fail-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new LocalStore(dir);
  const raw = JSON.stringify(record);
  await store.cas(key, null, raw);
  for (const mutate of [
    (s: ReturnType<typeof clientFixture>['state']) => { s.chainId = 1; },
    (s: ReturnType<typeof clientFixture>['state']) => { s.status = 'reverted'; },
    (s: ReturnType<typeof clientFixture>['state']) => { s.head = 10n; },
    (s: ReturnType<typeof clientFixture>['state']) => { s.used = false; },
    (s: ReturnType<typeof clientFixture>['state']) => { s.logs = [transfer, used]; },
    (s: ReturnType<typeof clientFixture>['state']) => { s.logs = [transfer, settled]; },
  ]) {
    const { client, state } = clientFixture();
    mutate(state);
    await assert.rejects(reconcile(store, key, transaction, ['https://rpc.example'], 10143, client));
    assert.equal(await store.get(key), raw);
  }
});

test('reconcile admin endpoint rejects unauthenticated callers', async () => {
  const { POST } = await import('../src/app/api/admin/reconcile/route');
  const response = await POST(new Request('https://agent.example/api/admin/reconcile', { method: 'POST', body: '{}' }));
  assert.equal(response.status, 401);
});
