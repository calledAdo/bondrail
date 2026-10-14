import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getCreditProfile, indexedCreditMetrics } from './credit.ts';
const registry = '0x1111111111111111111111111111111111111111';
const account = '0x2222222222222222222222222222222222222222';

test('profile reader pins both layers and current attester to one block', async () => {
  const calls: { functionName: string; blockNumber: bigint; args?: readonly unknown[]; address: string }[] = [];
  const client = {
    getBlockNumber: async () => 42n,
    readContract: async (request: typeof calls[number]) => {
      calls.push(request);
      if (request.functionName === 'onchainProfile') return { issuer: account };
      if (request.functionName === 'attestedProfile') return [{ evidenceHash: '0x01' }, registry, false];
      return account;
    },
  } as unknown as Parameters<typeof getCreditProfile>[0];
  const result = await getCreditProfile(client, registry, account);
  assert.equal(result.blockNumber, 42n);
  assert.equal(result.attested.valid, false);
  assert.equal(result.attested.signer, registry);
  assert.equal(result.currentAttester, account);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.blockNumber === 42n && c.address === registry));
  assert.deepEqual(calls.filter(c => c.args).map(c => c.args), [[account], [account]]);
});

test('profile read errors propagate instead of returning synthetic zero credit', async () => {
  const client = { getBlockNumber: async () => 42n, readContract: async () => { throw new Error('offline'); } } as unknown as Parameters<typeof getCreditProfile>[0];
  await assert.rejects(getCreditProfile(client, registry, account), /offline/);
});

test('shared metrics exclude related payers and future/old buckets, with conservative concentration rounding', () => {
  const result = indexedCreditMetrics({ now: 40 * 86400, firstRevenueAt: 86400,
    payers: [{ amount: 1n, related: false }, { amount: 1n, related: false }, { amount: 1n, related: false }, { amount: 20n, related: true }],
    daily: [{ day: 33, verified: 999n }, { day: 34, verified: 3n }, { day: 40, verified: 4n }, { day: 41, verified: 999n }] });
  assert.equal(result.attributedRevenue, 3n); assert.equal(result.excludedRevenue, 20n);
  assert.equal(result.distinctPayers, 3); assert.equal(result.topPayerShareBps, 3334);
  assert.equal(result.recentRevenue, 7n); assert.equal(result.rateDays, 7);
});
