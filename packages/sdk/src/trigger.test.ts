import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTriggerTerms } from './trigger';

const input = { triggerRevenue: '10.000001', triggerWindowDays: '2', stepUpBps: '4000' };
test('trigger input preserves exact asset units and accepts inclusive contract bounds', () => {
  assert.deepEqual(parseTriggerTerms(input, 6, 2500), { triggerRevenue: 10_000001n, triggerWindowDays: 2, stepUpBps: 4000 });
  for (const days of ['1', '30']) for (const step of ['2501', '5000'])
    assert.doesNotThrow(() => parseTriggerTerms({ ...input, triggerWindowDays: days, stepUpBps: step }, 6, 2500));
  assert.equal(parseTriggerTerms({ ...input, triggerRevenue: '0.000000000000000001' }, 18, 2500).triggerRevenue, 1n);
});

test('all blank or all zero disables; every partial configuration is rejected', () => {
  for (const zero of ['', '0'])
    assert.deepEqual(parseTriggerTerms({ triggerRevenue: zero, triggerWindowDays: zero, stepUpBps: zero }, 6, 2500),
      { triggerRevenue: 0n, triggerWindowDays: 0, stepUpBps: 0 });
  for (let mask = 1; mask < 7; mask++) {
    const mixed = { triggerRevenue: mask & 1 ? input.triggerRevenue : '0',
      triggerWindowDays: mask & 2 ? '2' : '0', stepUpBps: mask & 4 ? '4000' : '0' };
    assert.throws(() => parseTriggerTerms(mixed, 6, 2500));
  }
});

test('rejects rounding, invalid numbers and out-of-range days/shares', () => {
  for (const triggerRevenue of ['-1', 'NaN', 'Infinity', '1e6', '0.0000001', String(2n ** 256n)])
    assert.throws(() => parseTriggerTerms({ ...input, triggerRevenue }, 6, 2500));
  for (const triggerWindowDays of ['-1', '31', '1.5', 'Infinity'])
    assert.throws(() => parseTriggerTerms({ ...input, triggerWindowDays }, 6, 2500));
  for (const stepUpBps of ['2499', '2500', '5001', '4000.5', 'Infinity'])
    assert.throws(() => parseTriggerTerms({ ...input, stepUpBps }, 6, 2500));
});
