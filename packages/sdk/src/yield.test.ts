import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impliedYield, type ImpliedYieldInput } from './yield.ts';

const DAY = 86_400;
const now = 1_800_000_000;
const base: ImpliedYieldInput = {
  supply: 100,
  pool: 20,
  effectiveCap: 160,
  collected: 40,
  verifiedDaily: 8,
  revenueShare: 0.25,
  maturity: now + 50 * DAY,
  now,
  price: 1,
};
const close = (actual: number | null, expected: number) => {
  assert.notEqual(actual, null);
  assert.ok(Math.abs(actual! - expected) < 1e-9, `${actual} != ${expected}`);
};

test('normal case: hand-computed backing, future value, return, simple APR and payback', () => {
  const y = impliedYield(base);
  // 20 / 100 = 0.20 backing; 8/day * 25% = 2/day; min(120, 2 * 50) = 100 future.
  // Value = 0.20 + 100 / 100 = 1.20; return = 20%; APR = 20% * 365 / 50 = 146%.
  // Payback = (1 - 0.20) * 100 / 2 = 40 days.
  assert.equal(y.backing, 0.2);
  assert.equal(y.remainingCap, 120);
  assert.equal(y.expectedDaily, 2);
  assert.equal(y.daysLeft, 50);
  assert.equal(y.expectedFuture, 100);
  assert.equal(y.expectedValue, 1.2);
  close(y.impliedReturn, 0.2);
  close(y.impliedAPR, 1.46);
  assert.equal(y.paybackDays, 40);
});

test('cap binds expected revenue and permits payback only within that cap', () => {
  const capped = { ...base, effectiveCap: 100, price: 0.5 };
  const y = impliedYield(capped);
  assert.equal(y.remainingCap, 60);
  assert.equal(y.expectedFuture, 60);
  assert.equal(y.expectedValue, 0.8);
  close(y.impliedReturn, 0.6);
  close(y.impliedAPR, 4.38);
  assert.equal(y.paybackDays, 15);
  // Uncapped cash would cover 1.0 in 40 days, but only 0.8 per claim can arrive.
  assert.equal(impliedYield({ ...capped, price: 1 }).paybackDays, null);
});

test('maturity passed: no future revenue and APR uses a one-day denominator', () => {
  const y = impliedYield({ ...base, maturity: now - DAY });
  assert.equal(y.daysLeft, 0);
  assert.equal(y.expectedFuture, 0);
  assert.equal(y.expectedValue, 0.2);
  close(y.impliedReturn, -0.8);
  close(y.impliedAPR, -292);
  assert.equal(y.paybackDays, null);
  assert.equal(impliedYield({ ...base, maturity: now, price: 0.2 }).paybackDays, 0);
});

test('zero supply returns only null fields', () => {
  assert.ok(Object.values(impliedYield({ ...base, supply: 0 })).every((v) => v === null));
});

test('price above expected value preserves negative return and has no payback', () => {
  const y = impliedYield({ ...base, price: 1.5 });
  close(y.impliedReturn, -0.2);
  close(y.impliedAPR, -1.46);
  assert.equal(y.paybackDays, null);
});

test('no market: no price-dependent estimates without a price', () => {
  for (const price of [undefined, null]) {
    const y = impliedYield({ ...base, price });
    assert.equal(y.expectedValue, 1.2);
    assert.equal(y.impliedReturn, null);
    assert.equal(y.impliedAPR, null);
    assert.equal(y.paybackDays, null);
  }
});

test('Funding without a market uses the caller-supplied raise price of 1.0', () => {
  close(impliedYield({ ...base, price: 1.0 }).impliedReturn, 0.2);
});

test('zero revenue or an exhausted cap cannot repay beyond current backing', () => {
  for (const input of [{ ...base, verifiedDaily: 0 }, { ...base, revenueShare: 0 }, { ...base, effectiveCap: 40 }]) {
    const y = impliedYield(input);
    assert.equal(y.expectedFuture, 0);
    assert.equal(y.paybackDays, null);
    assert.equal(impliedYield({ ...input, price: 0.1 }).paybackDays, 0);
    assert.equal(impliedYield({ ...input, price: 0.2 }).paybackDays, 0);
  }
});

test('payback can land exactly at maturity or exactly at the remaining cap', () => {
  assert.equal(impliedYield({ ...base, price: 1.2 }).paybackDays, 50);
  close(impliedYield({ ...base, effectiveCap: 100, price: 0.8 }).paybackDays, 30);
});

test('fractional days are retained, with a one-day minimum only for APR', () => {
  const y = impliedYield({ ...base, maturity: now + DAY / 2 });
  assert.equal(y.daysLeft, 0.5);
  assert.equal(y.expectedFuture, 1);
  close(y.expectedValue, 0.21);
  close(y.impliedAPR, -288.35);
  assert.equal(y.paybackDays, null);
});

test('missing, nonfinite or invalid fundamentals produce null fields', () => {
  for (const key of ['supply', 'pool', 'effectiveCap', 'collected', 'verifiedDaily', 'revenueShare', 'maturity', 'now'] as const) {
    for (const value of [undefined, null, NaN, Infinity, -1]) {
      assert.ok(Object.values(impliedYield({ ...base, [key]: value })).every((v) => v === null), `${key}: ${value}`);
    }
  }
  for (const input of [{ ...base, revenueShare: 25 }, { ...base, collected: 161 }]) {
    assert.ok(Object.values(impliedYield(input)).every((v) => v === null));
  }
});

test('invalid prices and numeric overflow never leak NaN or Infinity', () => {
  for (const price of [0, -1, NaN, Infinity]) {
    const y = impliedYield({ ...base, price });
    assert.equal(y.impliedReturn, null);
    assert.equal(y.impliedAPR, null);
    assert.equal(y.paybackDays, null);
  }
  for (const input of [{ ...base, price: Number.MIN_VALUE }, { ...base, supply: Number.MIN_VALUE }]) {
    assert.ok(Object.values(impliedYield(input)).every((v) => v === null || Number.isFinite(v)));
  }
});
