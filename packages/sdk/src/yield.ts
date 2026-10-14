export interface ImpliedYieldInput {
  /** Claim tokens outstanding, in whole-token units (not base units). */
  supply: number | null | undefined;
  /** Cash currently redeemable by the outstanding claims, in asset units. */
  pool: number | null | undefined;
  effectiveCap: number | null | undefined;
  collected: number | null | undefined;
  /** Account's attributed revenue per day at the trailing 7-day rate; excludes other inflows. */
  verifiedDaily: number | null | undefined;
  /** Investor share as a fraction, e.g. 0.25 for 25%. */
  revenueShare: number | null | undefined;
  /** Unix timestamps in seconds. The caller supplies now to keep the calculation pure. */
  maturity: number | null | undefined;
  now: number | null | undefined;
  /** Asset per claim: Kuru mid price, or 1.0 during Funding when no market exists. */
  price?: number | null;
}

export interface ImpliedYield {
  backing: number | null;
  remainingCap: number | null;
  expectedDaily: number | null;
  daysLeft: number | null;
  expectedFuture: number | null;
  expectedValue: number | null;
  /** Fractional return, e.g. 0.2 means 20%. */
  impliedReturn: number | null;
  /** Simple annualised return (not compounded), also a fraction. */
  impliedAPR: number | null;
  /** Days from now; 0 if backing covers the price, null if unavailable or unreachable by maturity. */
  paybackDays: number | null;
}

const nonnegative = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;
const finiteOrNull = (n: number) => (Number.isFinite(n) ? n : null);

/**
 * Implied yield for Active bonds (or Funding, with the caller supplying the raise price of 1.0
 * when no market exists). All cash and token amounts must use whole units, not chain base units.
 *
 * supply = claim tokens outstanding; backing = pool / supply.
 * remainingCap = effectiveCap - collected: revenue investors can still receive.
 * expectedDaily = account.verifiedDaily * revenueShare: attributed revenue only.
 * daysLeft = max(0, (maturity - now) / 86400): fractional days, with a floor of zero.
 * expectedFuture = min(remainingCap, expectedDaily * daysLeft): capped revenue before maturity.
 * expectedValue = backing + expectedFuture / supply, per claim.
 * impliedReturn = expectedValue / price - 1.
 * impliedAPR = impliedReturn * 365 / max(daysLeft, 1): label this "simple APR".
 * Payback is the first t >= 0 where backing + expectedDaily * t / supply reaches price;
 * it must fit both the remaining revenue cap and the maturity horizon, otherwise it is null.
 *
 * Missing/invalid fundamentals or zero supply yield null fields. A missing/invalid price leaves
 * only the price-dependent fields null. No field returns NaN or Infinity.
 */
export function impliedYield(input: ImpliedYieldInput): ImpliedYield {
  const empty: ImpliedYield = {
    backing: null,
    remainingCap: null,
    expectedDaily: null,
    daysLeft: null,
    expectedFuture: null,
    expectedValue: null,
    impliedReturn: null,
    impliedAPR: null,
    paybackDays: null,
  };
  const { supply, pool, effectiveCap, collected, verifiedDaily, revenueShare, maturity, now, price } = input;
  if (
    !nonnegative(supply) || supply === 0 || !nonnegative(pool) || !nonnegative(effectiveCap) ||
    !nonnegative(collected) || collected > effectiveCap || !nonnegative(verifiedDaily) ||
    !nonnegative(revenueShare) || revenueShare > 1 || !nonnegative(maturity) || !nonnegative(now)
  ) return empty;

  const backing = pool / supply;
  const remainingCap = effectiveCap - collected;
  const expectedDaily = verifiedDaily * revenueShare;
  const daysLeft = Math.max(0, (maturity - now) / 86_400);
  const expectedFuture = Math.min(remainingCap, expectedDaily * daysLeft);
  const expectedValue = backing + expectedFuture / supply;
  if (![backing, remainingCap, expectedDaily, daysLeft, expectedFuture, expectedValue].every(Number.isFinite)) return empty;

  const result = { ...empty, backing, remainingCap, expectedDaily, daysLeft, expectedFuture, expectedValue };
  if (!nonnegative(price) || price === 0) return result;

  const impliedReturn = expectedValue / price - 1;
  const impliedAPR = impliedReturn * (365 / Math.max(daysLeft, 1));
  const payback = price <= backing ? 0 : expectedDaily > 0 ? ((price - backing) * supply) / expectedDaily : null;
  return {
    ...result,
    impliedReturn: finiteOrNull(impliedReturn),
    impliedAPR: finiteOrNull(impliedAPR),
    paybackDays: payback !== null && Number.isFinite(payback) && price <= expectedValue && payback <= daysLeft ? payback : null,
  };
}
