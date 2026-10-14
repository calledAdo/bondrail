import { impliedYield } from '@bondrail/sdk/yield';
import type { AccountView, BondView } from './protocol';

type YieldBond = Pick<BondView, 'phase' | 'kuru' | 'supply' | 'pool' | 'effectiveCap' | 'collected' | 'revenueShare' | 'maturity'>;

/** Map the app's percentage share and phase/price policy to the SDK's plain numeric inputs. */
export function bondImpliedYield(b: YieldBond, account: Pick<AccountView, 'verifiedDaily'> | undefined, midPrice: number | null, now: number) {
  const eligible = b.phase === 'Active' || b.phase === 'Funding';
  // Use par only during Funding without a market; an existing but unreadable market stays unknown.
  const price = eligible ? (b.kuru ? midPrice : b.phase === 'Funding' ? 1.0 : null) : null;
  return {
    price,
    ...impliedYield({
      supply: b.supply,
      pool: b.pool,
      effectiveCap: b.effectiveCap,
      collected: b.collected,
      verifiedDaily: account?.verifiedDaily,
      revenueShare: b.revenueShare / 100,
      maturity: b.maturity,
      now,
      price,
    }),
  };
}

export const yieldPercent = (value: number | null) => value === null ? '–' : `${(value * 100).toFixed(1)}%`;
