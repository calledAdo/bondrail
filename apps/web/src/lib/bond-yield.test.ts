import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bondImpliedYield } from './bond-yield';

const now = 1_800_000_000;
const account = { verifiedDaily: 8 };
const bond: Parameters<typeof bondImpliedYield>[0] = {
  phase: 'Active', supply: 100, pool: 20, effectiveCap: 160, collected: 40,
  revenueShare: 25, maturity: now + 50 * 86_400,
};
const address = '0x1111111111111111111111111111111111111111';
const kuru = { bond: address, market: address, vault: address, tx: '0x01' } as const;

test('Kuru midpoint and percentage share map to per-claim yield', () => {
  const y = bondImpliedYield({ ...bond, kuru }, account, 1, now);
  assert.equal(y.expectedDaily, 2);
  assert.equal(y.price, 1);
  assert.ok(Math.abs(y.impliedAPR! - 1.46) < 1e-9);
  assert.equal(y.paybackDays, 40);
});

test('only Funding without a market falls back to a raise price of 1.0', () => {
  const funding = { ...bond, phase: 'Funding' as const };
  assert.equal(bondImpliedYield(funding, account, null, now).price, 1);
  assert.equal(bondImpliedYield({ ...funding, kuru }, account, 0.9, now).price, 0.9);
  for (const b of [bond, { ...bond, kuru }, { ...funding, kuru }]) {
    const y = bondImpliedYield(b, account, null, now);
    assert.equal(y.price, null);
    assert.equal(y.impliedAPR, null);
    assert.equal(y.paybackDays, null);
  }
});

test('missing attributed history and zero outstanding supply never imply a return', () => {
  assert.equal(bondImpliedYield({ ...bond, kuru }, undefined, 1, now).impliedAPR, null);
  assert.equal(bondImpliedYield({ ...bond, kuru, supply: 0 }, account, 1, now).impliedAPR, null);
});

test('Closing, Closed and Cancelled bonds do not project Active revenue rights', () => {
  for (const phase of ['Closing', 'Closed', 'Cancelled'] as const) {
    const y = bondImpliedYield({ ...bond, kuru, phase }, account, 1, now);
    assert.equal(y.impliedReturn, null);
    assert.equal(y.impliedAPR, null);
    assert.equal(y.paybackDays, null);
  }
});
