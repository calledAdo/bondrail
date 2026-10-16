import { impliedYield } from '@bondrail/sdk/yield';
import { fmt } from './format';
import type { AccountView, BondView } from './protocol';

export const bondDate = (time?: number) => time ? new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'This event date is not exposed by the bond.';
export const shortBondDate = (time?: number) => time ? new Date(time * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'an unreported date';
const number = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });

export function bondSummary(b: BondView) {
  if (b.phase === 'Cancelled') return "This raise didn't complete. Every deposit can be refunded in full.";
  const stepUp = b.triggerWindowDays > 0
    ? ` (rising to ${number(b.stepUpShare)}% if revenue falls below ${fmt(b.triggerRevenue, b.asset)} over ${number(b.triggerWindowDays)} day${b.triggerWindowDays === 1 ? '' : 's'})${b.triggered ? ' — currently stepped up' : ''}` : '';
  const benefit = `claim holders receive ${number(b.baseRevenueShare)}% of its revenue${stepUp} until ${fmt(b.cap, b.asset)} has been repaid or ${shortBondDate(b.maturity)}.`;
  const sentence = b.phase === 'Funding'
    ? `${b.name} is raising ${fmt(b.raise, b.asset)}. If fully funded by ${shortBondDate(b.fundingDeadline)}, ${benefit}`
    : `${b.name} raised ${fmt(b.raised, b.asset)} of ${fmt(b.raise, b.asset)}. ${benefit[0].toUpperCase()}${benefit.slice(1)}`;
  return `${sentence} ${fmt(b.collected, b.asset)} repaid so far.${b.defaulted ? ` The issuer defaulted on ${b.defaultedAt ? shortBondDate(b.defaultedAt) : 'an unreported date'}; recovered funds are being paid to claim holders.` : ''}`;
}

export function depositPauseReason(b: BondView, now: number) {
  if (now >= b.fundingDeadline) return 'the funding deadline has passed';
  if (b.raised >= b.raise) return 'the raise is full and awaits activation';
  if (b.depositAllowed === false) return 'the payment source is unhealthy';
  if (b.depositAllowed === undefined) return 'source health could not be verified';
  return null;
}
export function phaseLabel(b: BondView, now: number) {
  if (b.defaulted) return 'Default recorded';
  return b.phase === 'Funding' ? depositPauseReason(b, now) ? 'Raising · deposits paused' : 'Raising'
    : b.phase === 'Active' ? b.triggered ? 'Repaying · higher share' : 'Repaying'
      : b.phase === 'Closing' ? 'Settling' : b.phase === 'Closed' ? 'Settled' : 'Raise cancelled';
}
export function bondAction(b: BondView, now: number) {
  if (b.phase === 'Funding') {
    const reason = depositPauseReason(b, now);
    return { primary: reason ? null : 'Deposit', message: reason ? `Deposits paused: ${reason}.` : null };
  }
  if (b.phase === 'Active') return { primary: b.kuru ? 'Buy claims' : null, message: b.kuru ? null : 'Hold to earn; redeem after settlement' };
  if (b.phase === 'Closing') return { primary: null, message: `Settling — redemption opens ${b.settleAfter ? bondDate(b.settleAfter) : 'after settlement; its opening time could not be read'}` };
  return { primary: b.phase === 'Closed' ? 'Redeem' : 'Refund', message: null };
}

export type LifecycleStep = { title: string; date: string; text: string; state: 'complete' | 'current' | 'pending' | 'skipped' };
export function bondTimeline(b: BondView, now: number): LifecycleStep[] {
  const funding = b.phase === 'Funding';
  const cancelled = b.phase === 'Cancelled';
  const raising: LifecycleStep = { title: 'Raising', date: bondDate(b.createdAt), text: `Deposits are held in the bond. You can withdraw until ${bondDate(b.fundingDeadline)}.`, state: funding ? 'current' : 'complete' };
  if (cancelled) return [raising, { title: 'Raise cancelled', date: 'The bond does not expose the cancellation date.', text: "This raise didn't complete. Every deposit can be refunded in full.", state: 'current' }];
  const released: LifecycleStep = { title: 'Released', date: funding ? 'At activation' : bondDate(b.activationTime), text: funding ? `${b.firstReleasePct}% goes to the business at activation; the rest waits for the milestone.` : `${b.firstReleasePct}% went to the business at activation; the rest waits for the milestone.`, state: funding ? 'pending' : 'complete' };
  if (b.defaulted) return [raising, released, { title: 'Default recovery', date: bondDate(b.defaultedAt), text: 'Undrawn capital and held stake move to claim holders. Released capital cannot be recovered by the contracts. Collection can continue until the cap or maturity.', state: 'current' }];
  const ended = b.phase === 'Closing' || b.phase === 'Closed';
  const secondReleased = b.released > b.raise * b.firstReleasePct / 100;
  const milestone: LifecycleStep = {
    title: 'Milestone', date: `${shortBondDate(b.secondReleaseNotBefore)} → ${shortBondDate(b.secondReleaseDeadline)}`,
    text: `The remaining ${100 - b.firstReleasePct}% is released only if revenue reaches ${fmt(b.minRevenue, b.asset)} between ${bondDate(b.secondReleaseNotBefore)} and ${bondDate(b.secondReleaseDeadline)}; otherwise it returns to claim holders.${secondReleased ? ' This release has happened; its exact date is unavailable.' : b.undrawn === 0 && !funding ? ' Undrawn capital has been returned.' : ''}`,
    state: secondReleased ? 'complete' : ended || (!funding && now >= b.secondReleaseDeadline) ? 'skipped' : 'pending',
  };
  return [raising, released, milestone,
    { title: 'Repaying', date: funding ? 'From activation' : bondDate(b.activationTime), text: `${number(b.revenueShare)}% of each payment goes to claims immediately. Plain transfers split when swept; repayment starts before the milestone.`, state: funding ? 'pending' : ended ? 'complete' : 'current' },
    { title: 'Maturity', date: bondDate(b.maturity), text: `${bondDate(b.maturity)}: collection stops.${ended ? ` Collection ended ${bondDate(b.collectionClosedAt)}${b.collectionClosedAt && b.collectionClosedAt < b.maturity ? ' after reaching the cap early' : ''}.` : ' It can stop earlier if the cap is reached.'}`, state: ended ? b.collectionClosedAt && b.collectionClosedAt < b.maturity ? 'skipped' : 'complete' : 'pending' },
    { title: 'Settled', date: b.phase === 'Closed' ? 'Finalized; the bond does not expose the exact date.' : b.settleAfter ? `Opens ${bondDate(b.settleAfter)}` : 'After collection ends', text: 'Claims redeem for their share of everything collected.', state: ended ? 'current' : 'pending' },
  ];
}

export function bondRisks(b: BondView, now: number): string[] {
  const risks = [b.phase === 'Cancelled' ? 'The raise did not activate. Deposits are refundable in full, but refunds still depend on the contracts working.'
    : b.phase === 'Closing' || b.phase === 'Closed' ? 'Revenue collection has stopped. Your share of the money collected may be less than you originally put in.'
      : 'If the business stops earning, you may receive less than you put in.'];
  risks.push(b.phase === 'Funding' ? `${b.firstReleasePct}% of principal will go to the business at activation. Once released, the contracts cannot take it back.`
    : b.phase === 'Cancelled' ? 'The raise was cancelled before capital was released. Refunds require a transaction.'
      : `${b.firstReleasePct}% of principal went to the business at activation${b.released > b.raise * b.firstReleasePct / 100 ? `; ${number(b.raise > 0 ? b.released / b.raise * 100 : 0)}% has now been released in total` : ''}; the contracts cannot recover it.`);
  if (b.tier === 'Watched') risks.push(`The API can divert payTo (the payment recipient) between checks. Detection is expected within about 30 minutes while monitoring works, but is not guaranteed. Its ${fmt(b.stake, b.asset)} stake covers only part of possible losses.`);
  if (b.triggerWindowDays && (b.phase === 'Funding' || b.phase === 'Active')) risks.push(`Revenue below ${fmt(b.triggerRevenue, b.asset)} over ${b.triggerWindowDays} complete UTC day${b.triggerWindowDays === 1 ? '' : 's'} can raise the share to ${b.stepUpShare}% after a trigger check. Self-payments count; ${b.triggered ? 'the higher share is now in effect.' : 'a step-up creates no revenue.'}`);
  if (b.defaulted) risks.push(`Default recorded ${bondDate(b.defaultedAt)}. Recovered capital and stake may not cover your loss.`);
  else if (b.tier === 'Watched' && b.phase !== 'Closed' && b.phase !== 'Cancelled') risks.push('Two qualifying routing violations in adjacent report epochs, or 24 hours of qualifying unreachable reports while active, can cause default. An outage of the monitor alone does not.');
  if (b.undrawn > 0 && now < b.secondReleaseDeadline) risks.push('The milestone can still release remaining capital; “revenue stops” assumes it returns to holders instead.');
  if (b.phase === 'Funding') risks.push('Claims cannot be sold during raising. If no liquid market opens after activation, they may be hard to sell.');
  else if (b.phase === 'Active') risks.push(b.kuru ? 'Claims may be hard to sell. The market may have too few buyers, and a large trade can move the price.' : 'No market: you cannot sell here. Early redemption gives up future receipts.');
  risks.push('Monad testnet. These contracts are unaudited; bugs can cause losses.');
  return risks;
}

/** Value of one claim, independent of a market or the holder's purchase price. */
export function claimEstimate(b: BondView, account: Pick<AccountView, 'verifiedDaily'> | undefined, now: number) {
  const funding = b.phase === 'Funding';
  const supply = funding ? b.raise : b.supply;
  if (!Number.isFinite(supply) || supply <= 0) return null;
  // Cancelled claims refund one asset unit each, including after other holders refund.
  if (b.phase === 'Cancelled') return { backing: 1, stopped: 1, expected: 1, best: 1 };
  const pool = funding ? 0 : b.pool;
  const undrawn = funding ? b.raise * (1 - b.firstReleasePct / 100) : b.undrawn;
  const cap = funding ? b.cap * b.firstReleasePct / 100 : b.effectiveCap;
  const collected = funding ? 0 : b.collected;
  if (![pool, undrawn, cap, collected].every(n => Number.isFinite(n) && n >= 0)) return null;
  const stopped = (pool + undrawn) / supply;
  const ended = ['Closing', 'Closed', 'Cancelled'].includes(b.phase) || now >= b.maturity;
  const y = impliedYield({ supply, pool, effectiveCap: cap, collected, verifiedDaily: account?.verifiedDaily,
    revenueShare: b.revenueShare / 100, maturity: b.maturity, now: funding ? Math.max(now, b.fundingDeadline) : now });
  const mayRelease = undrawn > 0 && now < b.secondReleaseDeadline && !b.defaulted;
  const bestPool = ended ? pool + undrawn : Math.max(pool + Math.max(0, cap - collected) + undrawn, mayRelease ? pool + Math.max(0, b.cap - collected) : 0);
  return { backing: pool / supply, stopped, expected: ended ? stopped : y.expectedValue === null ? null : y.expectedValue + undrawn / supply, best: bestPool / supply };
}

/** Purchase scenarios. Return undrawn capital only once, separately from capped revenue. */
export function purchaseEstimate(b: BondView, account: Pick<AccountView, 'verifiedDaily'> | undefined, amount: number, ask: number | null, now: number) {
  const funding = b.phase === 'Funding';
  const purchasable = funding || b.phase === 'Active';
  const price = /USD/i.test(b.asset.symbol) && purchasable ? funding ? 1 : b.kuru ? ask : null : null;
  if (!Number.isFinite(amount) || amount <= 0 || price === null || !Number.isFinite(price) || price <= 0) return null;
  const supply = funding ? b.raise : b.supply;
  const value = claimEstimate(b, account, now);
  if (!value) return null;
  const claims = amount / price;
  const pool = funding ? 0 : b.pool;
  const cap = funding ? b.cap * b.firstReleasePct / 100 : b.effectiveCap;
  const collected = funding ? 0 : b.collected;
  const start = funding ? Math.max(now, b.fundingDeadline) : now;
  const y = impliedYield({ supply, pool, effectiveCap: cap, collected, verifiedDaily: account?.verifiedDaily,
    revenueShare: b.revenueShare / 100, maturity: b.maturity, now: start, price });
  const stopped = value.stopped * claims;
  const expected = value.expected === null ? null : value.expected * claims;
  const gain = expected === null ? null : expected / amount - 1;
  return { price, claims, expected, stopped, best: value.best * claims, gain,
    apr: gain === null || y.daysLeft === null ? null : gain * 365 / Math.max(1, (b.maturity - now) / 86400),
    // Principal returns at maturity, so it cannot make revenue payback happen earlier.
    paybackDays: y.paybackDays !== null ? y.paybackDays + (start - now) / 86400 : expected !== null && expected >= amount ? Math.max(0, (b.maturity - now) / 86400) : null,
    exceedsSupply: claims > supply,
  };
}
