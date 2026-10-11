import { test } from 'node:test';
import assert from 'node:assert/strict';
import { creditLine, defaultCreditTerms } from './credit.ts';

const base = { revenuePerDay: 100, ageDays: 30, uniquePayers: 10, topPayerShare: 0.1 };

test('a mature, diversified history: stress haircut only', () => {
  const c = creditLine(base);
  // 100/day x 25% x 30 days x 0.7 = 525 expected; / (1.2 cap x 1.2 coverage) = 364.58
  assert.equal(c.expectedRepayment, 525);
  assert.ok(Math.abs(c.maxRaise - 525 / 1.44) < 1e-9);
  assert.ok(c.eligible);
});

test('a short history is weighted by its age', () => {
  const c = creditLine({ ...base, ageDays: 3 });
  assert.equal(c.factors.history, 0.1);
  assert.ok(Math.abs(c.expectedRepayment - 52.5) < 1e-9);
});

test('a dominant payer discounts the line', () => {
  assert.equal(creditLine({ ...base, topPayerShare: 1 }).maxRaise, 0);
  assert.ok(Math.abs(creditLine({ ...base, topPayerShare: 0.625 }).factors.diversification - 0.5) < 1e-9);
});

test('too few payers or no revenue: not eligible', () => {
  const few = creditLine({ ...base, uniquePayers: 2 });
  assert.equal(few.eligible, false);
  assert.equal(few.maxRaise, 0);
  assert.ok(few.expectedRepayment > 0); // still shown, so the issuer sees what it would be
  assert.equal(creditLine({ ...base, revenuePerDay: 0 }).reason, 'No attributed revenue yet');
});

test('invalid terms are rejected', () => {
  assert.throws(() => creditLine(base, { ...defaultCreditTerms, revenueBps: 6000 }));
  assert.throws(() => creditLine(base, { ...defaultCreditTerms, capMultiple: 0.9 }));
});
