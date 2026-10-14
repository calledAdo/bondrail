import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Address, TypedDataDomain } from 'viem';
import type { AddressInfo } from 'node:net';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from 'viem/chains';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { exactUsdcRequirements, httpFacilitator } from '@bondrail/sdk/x402';
import { authorizationTypes, createFacilitator, NETWORK, type FacilitatorOptions } from '../src/index.js';
import { facilitatorServer } from '../src/http.js';

const payer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
const gasPayer = privateKeyToAccount(`0x${'02'.repeat(32)}`);
const asset = '0x1111111111111111111111111111111111111111';
const account = '0x2222222222222222222222222222222222222222';
const factory = '0x3333333333333333333333333333333333333333';
const tx = `0x${'ab'.repeat(32)}` as const;
const now = 1_800_000_000;

async function setup() {
  const requirements = exactUsdcRequirements({ chainId: 10143, asset, amount: '10000', payTo: account });
  const authorization = { from: payer.address, to: account as Address, value: '10000', validAfter: String(now - 1), validBefore: String(now + 300), nonce: `0x${'12'.repeat(32)}` as const };
  const sign = (domain: TypedDataDomain = { name: 'USDC', version: '2', chainId: 10143, verifyingContract: asset }) => payer.signTypedData({
    domain, types: authorizationTypes, primaryType: 'TransferWithAuthorization',
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  const payload: PaymentPayload = { x402Version: 2, accepted: structuredClone(requirements), payload: { authorization, signature: await sign() } };
  const state = { isAccount: true, accountAsset: asset, used: false, balance: 10000n, chainId: 10143,
    simulationFails: false, receiptStatus: 'success', timeout: false, blockTime: BigInt(now), writes: [] as any[], simulations: [] as any[] };
  const publicClient = {
    getChainId: async () => state.chainId,
    getBlock: async () => ({ timestamp: state.blockTime }),
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'isAccount') return state.isAccount;
      if (functionName === 'asset') return state.accountAsset;
      if (functionName === 'authorizationState') return state.used;
      if (functionName === 'balanceOf') return state.balance;
      throw new Error('unexpected read');
    },
    simulateContract: async (request: unknown) => {
      state.simulations.push(request);
      if (state.simulationFails) throw new Error('execution reverted');
      return { request };
    },
    waitForTransactionReceipt: async ({ hash }: { hash: string }) => {
      assert.equal(hash, tx);
      if (state.timeout) throw new Error('timeout waiting for receipt');
      return { status: state.receiptStatus };
    },
  } as unknown as FacilitatorOptions['publicClient'];
  const walletClient = { account: gasPayer, chain: monadTestnet,
    writeContract: async (request: unknown) => { state.writes.push(request); state.used = true; return tx; },
  } as unknown as FacilitatorOptions['walletClient'];
  const service = createFacilitator({ factory, asset, publicClient, walletClient, now: () => now });
  return { service, state, payload, requirements, authorization, sign };
}

test('valid signature verifies without a write and settles via the account after simulation', async () => {
  const f = await setup();
  assert.deepEqual(await f.service.verify(f.payload, f.requirements), { isValid: true, payer: payer.address });
  assert.equal(f.state.writes.length, 0);
  assert.deepEqual(await f.service.settle(f.payload, f.requirements), {
    success: true, transaction: tx, network: NETWORK, payer: payer.address, amount: '10000',
  });
  assert.equal(f.state.writes.length, 1);
  assert.equal(f.state.writes[0].address, account);
  assert.equal(f.state.writes[0].functionName, 'settle');
  assert.deepEqual(f.state.writes[0].args.slice(0, 5), [payer.address, 10000n, BigInt(now - 1), BigInt(now + 300), f.authorization.nonce]);
  assert.equal(f.state.simulations.length, 2);
});

type Fixture = Awaited<ReturnType<typeof setup>>;
const rejects: [string, (f: Fixture) => void | Promise<void>][] = [
  ['wrong signature', f => { f.payload.payload.signature = `0x${'01'.repeat(64)}1b`; }],
  ['wrong signed domain', async f => { f.payload.payload.signature = await f.sign({ name: 'FAKE', version: '2', chainId: 10143, verifyingContract: asset }); }],
  ['wrong network', f => { f.requirements.network = 'eip155:1'; }],
  ['wrong scheme', f => { f.requirements.scheme = 'upto'; }],
  ['wrong asset', f => { f.requirements.asset = factory; }],
  ['wrong payTo', f => { f.requirements.payTo = factory; }],
  ['wrong amount', f => { f.authorization.value = '10001'; }],
  ['zero amount', f => { f.requirements.amount = f.payload.accepted.amount = f.authorization.value = '0'; }],
  ['zero payer', f => { f.authorization.from = `0x${'00'.repeat(20)}`; }],
  ['self payer', f => { f.authorization.from = account; }],
  ['malformed nonce', f => { f.payload.payload.authorization = { ...f.authorization, nonce: '0x12' }; }],
  ['malformed uint', f => { f.authorization.value = '-1'; }],
  ['overflowing uint', f => { f.authorization.validBefore = String(2n ** 256n); }],
  ['expired', f => { f.authorization.validBefore = String(now); }],
  ['not yet valid at strict boundary', f => { f.authorization.validAfter = String(now); }],
  ['overlong authorization', f => { f.authorization.validBefore = String(now + 301); }],
  ['offer domain mismatch', f => { f.requirements.extra.name = 'FAKE'; }],
  ['accepted requirements mismatch', f => { f.payload.accepted.amount = '123'; }],
  ['non-Slice recipient', f => { f.state.isAccount = false; }],
  ['account asset mismatch', f => { f.state.accountAsset = factory; }],
  ['already consumed authorization', f => { f.state.used = true; }],
  ['insufficient payer funds', f => { f.state.balance = 9999n; }],
  ['RPC chain mismatch', f => { f.state.chainId = 1; }],
  ['chain timestamp past expiry', f => { f.state.blockTime = BigInt(now + 301); }],
  ['reverting simulation or old implementation', f => { f.state.simulationFails = true; }],
  ['malformed payload', f => { f.payload.payload = null as never; }],
];
for (const [name, mutate] of rejects) {
  test(`refuses ${name} before submitting`, async () => {
    const f = await setup();
    await mutate(f);
    assert.equal((await f.service.verify(f.payload, f.requirements)).isValid, false);
    assert.equal((await f.service.settle(f.payload, f.requirements)).success, false);
    assert.equal(f.state.writes.length, 0);
  });
}

test('concurrent replay submits once, then rechecks nonce before the next write', async () => {
  const f = await setup();
  const responses = await Promise.all([f.service.settle(f.payload, f.requirements), f.service.settle(f.payload, f.requirements)]);
  assert.equal(responses.filter(r => r.success).length, 1);
  assert.equal(responses[1].errorReason, 'authorization_used');
  assert.equal(f.state.writes.length, 1);
});

test('receipt timeout retains broadcast hash; reverted receipts never report success', async () => {
  for (const timeout of [false, true]) {
    const f = await setup();
    f.state.timeout = timeout;
    f.state.receiptStatus = 'reverted';
    const result = await f.service.settle(f.payload, f.requirements);
    assert.equal(result.success, false);
    assert.equal(result.transaction, tx);
    assert.equal(result.errorReason, timeout ? 'settlement_pending' : 'settlement_reverted');
  }
});

test('x402 resource server used by the agent discovers, verifies and settles over HTTP', async t => {
  const f = await setup();
  const server = facilitatorServer(f.service);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const client = httpFacilitator(url, 10143);
  assert.equal((await client.verify(f.payload, f.requirements)).isValid, true);
  const result = await client.settle(f.payload, f.requirements);
  assert.equal(result.success, true);
  assert.equal(result.transaction, tx);
  assert.equal((await fetch(`${url}/verify`, { method: 'POST', body: '{' })).status, 400);
  assert.equal((await fetch(`${url}/settle`, { method: 'POST', body: 'x'.repeat(17000) })).status, 413);
  assert.equal((await fetch(`${url}/unknown`)).status, 404);
});
