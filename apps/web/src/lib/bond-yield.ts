import { impliedYield } from '@bondrail/sdk/yield';
import type { AccountView, BondView } from './protocol';

type YieldBond = Pick<BondView, 'phase' | 'kuru' | 'supply' | 'pool' | 'effectiveCap' | 'collected' | 'revenueShare' | 'maturity'
  | 'raise' | 'cap' | 'firstReleasePct' | 'fundingDeadline'>;

/** Map the app's percentage share and phase/price policy to the SDK's plain numeric inputs. */
export function bondImpliedYield(b: YieldBond, account: Pick<AccountView, 'verifiedDaily'> | undefined, midPrice: number | null, now: number) {
  const eligible = b.phase === 'Active' || b.phase === 'Funding';
  // Use par only during Funding without a market; an existing but unreadable market stays unknown.
  const price = eligible ? (b.kuru ? midPrice : b.phase === 'Funding' ? 1.0 : null) : null;
  const funding = b.phase === 'Funding';
  return {
    price,
    ...impliedYield({
      // Funding has no revenue-bearing claims yet. Project the full raise at activation,
      // with only the initial release; do not inflate yield using partial or zero supply.
      supply: funding ? b.raise : b.supply,
      pool: funding ? 0 : b.pool,
      effectiveCap: funding ? b.cap * b.firstReleasePct / 100 : b.effectiveCap,
      collected: funding ? 0 : b.collected,
      verifiedDaily: account?.verifiedDaily,
      revenueShare: b.revenueShare / 100,
      maturity: b.maturity,
      now: funding ? Math.max(now, b.fundingDeadline) : now,
      price,
    }),
  };
}

export const yieldPercent = (value: number | null) => value === null ? '–' : `${(value * 100).toFixed(1)}%`;

/** Remaining revenue rights for the selected claims. Closing has already stopped collection.
 * Excludes potential undrawn-capital/stake recovery and assumes no change in share or supply. */
export function earlyRedemptionEstimate(b: YieldBond, account: Pick<AccountView, 'verifiedDaily'> | undefined, claims: number, now: number) {
  if (!Number.isFinite(claims) || claims <= 0 || !Number.isFinite(b.supply) || b.supply <= 0 || claims > b.supply
    || !Number.isFinite(b.pool) || b.pool < 0) return null;
  const future = b.phase === 'Closing' ? 0 : bondImpliedYield(b, account, null, now).expectedFuture;
  if (future === null) return null;
  const additional = future * claims / b.supply;
  return { additional, total: (b.pool * claims / b.supply) + additional };
}
