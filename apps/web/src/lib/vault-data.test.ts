import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocationHeadroom, vaultAmount, vaultInputError } from './vault-data';
const p = { nav: 1000n, idle: 500n, holdingValue: 100n, cap: 2500n, buffer: 2000n, holdings: 1, maxBonds: 16n, tracked: true, raiseRemaining: 1000n };
test('headroom respects concentration, idle ceil, holding slots and remaining raise', () => {
  assert.deepEqual(allocationHeadroom(p), { available: 150n, concentration: 150n, liquidity: 300n, bufferRequired: 200n, slotAvailable: true });
  assert.equal(allocationHeadroom({ ...p, idle: 230n }).available, 30n);
  assert.equal(allocationHeadroom({ ...p, raiseRemaining: 40n }).available, 40n);
  assert.equal(allocationHeadroom({ ...p, nav: 1001n }).bufferRequired, 201n);
  assert.equal(allocationHeadroom({ ...p, holdings: 16, tracked: false }).available, 0n);
  assert.equal(allocationHeadroom({ ...p, holdings: 16 }).available, 150n);
  assert.equal(allocationHeadroom({ ...p, idle: 0n }).available, 0n);
  assert.equal(allocationHeadroom({ ...p, holdingValue: 400n }).available, 0n);
});
test('headroom respects stricter input limits without changing on-chain hard maxima', () => {
  assert.equal(allocationHeadroom({ ...p, cap: 1500n }).available, 50n);
  assert.equal(allocationHeadroom({ ...p, buffer: 4800n }).available, 20n);
  assert.equal(allocationHeadroom({ ...p, maxBonds: 1n, tracked: false }).available, 0n);
});
test('amount parsing rejects silent decimal rounding, negative amounts and scientific notation', () => {
  assert.equal(vaultAmount('1.000001', 6), 1_000_001n);
  for (const text of ['1.0000001', '-1', '1e6', '', 'NaN', '.']) assert.equal(vaultAmount(text, 6), undefined);
  assert.equal(vaultAmount('1.000000000001', 12), 1_000_000_000_001n);
});
test('transaction error states fail closed for wallet, network, failed reads, zero-share, limits and balance', () => {
  const good = { connected: true, correctNetwork: true, amount: 100n, balance: 200n, preview: 100n, max: 200n, deposit: true };
  assert.equal(vaultInputError(good), undefined);
  assert.match(vaultInputError({ ...good, connected: false })!, /Connect/);
  assert.match(vaultInputError({ ...good, correctNetwork: false })!, /Switch/);
  assert.match(vaultInputError({ ...good, closed: true })!, /Closed.*zero deposit limit/);
  assert.match(vaultInputError({ ...good, readError: true })!, /Could not refresh/);
  assert.match(vaultInputError({ ...good, preview: 0n })!, /zero shares/);
  assert.match(vaultInputError({ ...good, amount: 201n })!, /Insufficient/);
  assert.match(vaultInputError({ ...good, deposit: false, max: 99n })!, /rest is invested/);
  assert.match(vaultInputError({ ...good, balance: undefined })!, /Reading/);
  assert.match(vaultInputError({ ...good, amount: undefined })!, /valid amount/);
});
