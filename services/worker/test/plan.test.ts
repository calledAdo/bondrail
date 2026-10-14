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

test('configured trigger runs once per UTC day, including after a worker restart', () => {
  const active: BondState = { ...state, now: 103n * 86_400n, maturity: 200n * 86_400n,
    secondReleaseDeadline: 150n * 86_400n,
    trigger: { triggerWindowDays: 2, activationTime: 100n * 86_400n + 43_200n,
      defaultedAt: 0n, lastTriggerCheckDay: 0n } };
  assert.equal(nextOperation({ ...active, now: active.now - 1n }), undefined);
  assert.equal(nextOperation(active), 'checkTrigger');
  // State re-read from the chain after a confirmation or process restart.
  const checked = { ...active, trigger: { ...active.trigger!, lastTriggerCheckDay: 103n } };
  assert.equal(nextOperation(checked), undefined);
  assert.equal(nextOperation({ ...checked, now: active.now + 86_399n }), undefined);
  assert.equal(nextOperation({ ...checked, now: active.now + 86_400n }), 'checkTrigger');
  assert.equal(nextOperation({ ...active, trigger: undefined }), undefined);
  assert.equal(nextOperation({ ...active, trigger: { ...active.trigger!, triggerWindowDays: 0 } }), undefined);
  assert.equal(nextOperation({ ...active, trigger: { ...active.trigger!, defaultedAt: 1n } }), undefined);
  for (const phase of [0, 2, 3, 4])
    assert.notEqual(nextOperation({ ...active, phase }), 'checkTrigger');
  assert.equal(nextOperation({ ...active, now: active.maturity }), 'closeBondAtMaturity');
  assert.equal(nextOperation({ ...active, now: active.secondReleaseDeadline }), 'expireUndrawn');
  // Pending receipts are booked today; they cannot change yesterday's complete buckets.
  // Give the daily check priority so constant new receipts cannot starve it.
  assert.equal(nextOperation({ ...active, freeReceipts: 1n }), 'checkTrigger');
  assert.equal(nextOperation({ ...checked, freeReceipts: 1n }), 'sweep');
});

test('trigger eligibility starts after complete UTC days strictly after the activation day', () => {
  for (let window = 1; window <= 30; window++) {
    for (const activationSecond of [0n, 43_200n, 86_399n]) {
      const firstCheck = (100n + 1n + BigInt(window)) * 86_400n;
      const active: BondState = { ...state, now: firstCheck, maturity: 200n * 86_400n,
        secondReleaseDeadline: 150n * 86_400n,
        trigger: { triggerWindowDays: window, activationTime: 100n * 86_400n + activationSecond,
          defaultedAt: 0n, lastTriggerCheckDay: 0n } };
      assert.equal(nextOperation({ ...active, now: firstCheck - 86_400n }), undefined);
      assert.equal(nextOperation({ ...active, now: firstCheck - 1n }), undefined);
      assert.equal(nextOperation(active), 'checkTrigger');
    }
  }
});
