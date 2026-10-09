import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateScore,
  suggestRaise,
  reconcileReceipts,
  type RevenueWindow,
  type RevenuePayment,
} from './index.ts';
const account = '0x123';
const base: RevenueWindow = {
  chainId: 10143,
  account,
  from: 0,
  to: 2592000,
  block: '123',
  blockHash: '0xabc',
  coverageComplete: true,
  payments: [],
};
const payment = (id: string, amount: string, extras: Partial<RevenuePayment> = {}): RevenuePayment => ({
  id,
  chainId: 10143,
  account,
  payer: id,
  amount,
  timestamp: 86401,
  source: 'x402',
  synthetic: false,
  related: false,
  evidenceComplete: true,
  reasons: [],
  ...extras,
});
test('fixed denominator does not turn concentration into fake wash volume', () => {
  const s = calculateScore({ ...base, payments: [payment('a', '90000000'), payment('b', '10000000')] });
  assert.equal(s.eligibleRevenue, '100000000');
  assert.equal(s.concentrationAdjustedRevenue, '20000000');
  assert.equal(s.hhi, 0.82);
  assert.equal(s.relatedExcluded, '0');
  assert.equal(s.concentrationHaircut, '80000000');
});
test('empty, incomplete and short histories cannot produce a live recommendation', () => {
  assert.equal(calculateScore(base).score, null);
  const s = calculateScore({ ...base, to: 86400, payments: [payment('a', '100000000', { timestamp: 1 })] });
  assert.equal(s.score, null);
  assert.equal(suggestRaise(s, 2500, 86400, 12000), null);
});
test('synthetic and related exclusion uses one bucket and preserves reasons', () => {
  const s = calculateScore({
    ...base,
    payments: [
      payment('a', '100', { synthetic: true, related: true, reasons: ['team controlled', 'treasury edge'] }),
      payment('b', '100', { related: true }),
      payment('c', '100', { evidenceComplete: false }),
    ],
  });
  assert.equal(s.rawRevenue, '300');
  assert.equal(s.eligibleRevenue, '0');
  assert.equal(s.syntheticExcluded, '100');
  assert.equal(s.relatedExcluded, '100');
  assert.equal(s.incompleteExcluded, '100');
});
test('replay and issuer scoping', () => {
  const a = payment('a', '1000000');
  assert.equal(calculateScore({ ...base, payments: [a, a] }).rawRevenue, '1000000');
  assert.throws(() => calculateScore({ ...base, payments: [{ ...a, account: 'another' }] }));
});
test('known-control cluster does not gain address diversification', () => {
  const payments = Array.from({ length: 10 }, (_, i) =>
    payment(String(i), '10000000', { controlCluster: 'same' }),
  );
  const s = calculateScore({ ...base, payments });
  assert.equal(s.distinctPayers, 1);
  assert.equal(s.hhi, 1);
  assert.equal(s.concentrationAdjustedRevenue, '10000000');
});
test('ten equal eligible payers, unit-safe advisory terms', () => {
  const s = calculateScore({
    ...base,
    payments: Array.from({ length: 10 }, (_, i) => payment(String(i), '10000000')),
  });
  assert.equal(s.concentrationAdjustedRevenue, '100000000');
  assert.equal(s.hhi, 0.1);
  assert.equal(suggestRaise(s, 2000, 90 * 86400, 14000), '30000000');
});
test('dust contributes amount but does not manufacture counted payer days', () => {
  const s = calculateScore({
    ...base,
    payments: Array.from({ length: 25 }, (_, i) => payment(String(i), '1', { timestamp: i * 86400 + 1 })),
  });
  assert.equal(s.distinctPayers, 0);
  assert.equal(s.daysActive, 0);
});
test('5 recognized fees,9 receipts; attribution and duplicate prevention', () => {
  const receipts = [2, 3, 4].map((n, i) => ({
    id: String(i),
    chainId: 10143,
    account,
    from: 'payer',
    amount: String(n * 1e6),
    txHash: 'tx',
    blockHash: 'block',
    logIndex: i,
  }));
  const a = {
    receiptId: '0',
    source: 'launchpad' as const,
    payer: 'trader',
    amount: '2000000',
    evidenceId: 'trade',
  };
  const b = {
    receiptId: '1',
    source: 'x402' as const,
    payer: 'buyer',
    amount: '3000000',
    evidenceId: 'request',
  };
  assert.deepEqual(reconcileReceipts([...receipts, receipts[0]], [a, a, b]), {
    inbound: '9000000',
    recognized: '5000000',
    unattributed: '4000000',
  });
  assert.throws(() => reconcileReceipts(receipts, [a, { ...a, evidenceId: 'double' }]));
});
