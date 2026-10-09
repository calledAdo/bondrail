import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextOperation, type BondState } from '../src/plan.js';
const state: BondState = {
  phase: 1,
  now: 100n,
  fundingDeadline: 80n,
  maturity: 200n,
  secondReleaseDeadline: 150n,
  undrawnPrincipal: 50n,
  settleAfter: 320n,
  freeReceipts: 0n,
};
test('worker respects strict lifecycle boundaries and prioritizes close over draw expiry', () => {
  assert.equal(nextOperation(state), undefined);
  assert.equal(nextOperation({ ...state, phase: 0, now: 80n }), 'cancelFunding');
  assert.equal(nextOperation({ ...state, now: 150n }), 'expireUndrawn');
  assert.equal(nextOperation({ ...state, now: 200n }), 'closeBondAtMaturity');
  assert.equal(nextOperation({ ...state, freeReceipts: 1n }), 'sweep');
  assert.equal(nextOperation({ ...state, phase: 2, now: 319n }), undefined);
  assert.equal(nextOperation({ ...state, phase: 2, now: 320n }), 'finalizeSettlement');
  assert.equal(nextOperation({ ...state, phase: 3, freeReceipts: 100n }), undefined);
});
