'use client';
import { bondImpliedYield, yieldPercent } from '@/lib/bond-yield';
import { useKuruPrice } from '@/lib/kuru';
import { fmt, type AccountView, type BondView } from '@/lib/protocol';
import Link from 'next/link';
import { useState } from 'react';
import { purchaseEstimate } from '@/lib/bond-decision';
import { Term, TermsText } from './term';
import { Panel } from './ui';

export function ImpliedYieldPanel({ b, account }: { b: BondView; account?: AccountView }) {
  const { mid } = useKuruPrice(b.kuru?.market);
  const y = bondImpliedYield(b, account, mid, Date.now() / 1000);
  if (!b.kuru && b.phase !== 'Funding') return (
    <p className="text-sm text-foreground/70"><TermsText>No market yet — yield appears once claims trade</TermsText></p>
  );
  const payback = y.paybackDays !== null
    ? y.paybackDays === 0 ? 'Now' : `${y.paybackDays.toLocaleString('en-US', { maximumFractionDigits: 1 })} days`
    : y.impliedReturn !== null ? 'Not by maturity' : '–';
  return (
    <Panel title={<Term term="yield">Implied yield</Term>}>
      {!b.kuru && <p className="mb-4 text-sm text-foreground/70"><TermsText>No market yet — yield appears once claims trade. Funding estimate below uses the par price.</TermsText></p>}
      <dl className="grid grid-cols-2 gap-5 text-sm sm:grid-cols-4">
        {[
          [b.kuru ? 'Kuru mid price' : b.phase === 'Funding' ? 'Raise price' : 'Market price', y.price === null ? '–' : fmt(y.price, b.asset, 4)],
          ['Implied return', yieldPercent(y.impliedReturn)],
          ['Simple APR', yieldPercent(y.impliedAPR)],
          ['Payback', payback],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-foreground/70"><TermsText>{label}</TermsText></dt>
            <dd className="break-words font-mono tabular">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-foreground/70">
        Assumes attributed revenue continues at the trailing 7-day rate; not a guarantee.
        {b.phase === 'Funding' && ' Funding assumes the full raise activates at the funding deadline and only the initial capital release occurs. It excludes later releases and capital or stake recoveries.'}
      </p>
    </Panel>
  );
}

/** The first decision layer; technical midpoint yield remains available below full terms. */
export function WhatYouGet({ b, account, now }: { b: BondView; account?: AccountView; now: number }) {
  const [amount, setAmount] = useState('10');
  const prices = useKuruPrice(b.kuru?.market);
  const valid = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && Number.isFinite(Number(amount));
  const estimate = valid ? purchaseEstimate(b, account, Number(amount), prices.ask, now) : null;
  const purchasable = b.phase === 'Funding' || b.phase === 'Active';
  const explanation = !/USD/i.test(b.asset.symbol) ? `No USD conversion is available for ${b.asset.symbol}. The bond pays in ${b.asset.symbol}.`
    : !purchasable ? 'This bond is no longer open for new purchases. Existing holders can use the actions below.'
    : b.phase === 'Active' && !b.kuru ? "No market — you can't buy claims right now; the vault may hold them."
    : b.phase === 'Active' && prices.ask === null ? prices.loading ? 'Reading the market’s current asking price…' : 'No usable asking price. A listed market needs a seller before you can buy.'
    : b.phase === 'Funding' ? 'Deposit at par: $1 buys one claim if the raise activates.' : `Buy at the current Kuru asking price: ${fmt(prices.ask!, b.asset, 4)} per claim.`;
  const cash = (n: number | null | undefined) => n === null || n === undefined ? 'Unavailable' : fmt(n, b.asset, 4);
  return <Panel title="What you get" className="min-h-[26rem]">
    <div className="mb-5 grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-end">
      <label className="block space-y-2"><span className="text-sm">Amount in USD</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-invalid={!valid} aria-describedby="calculator-assumption"
        className="min-h-11 w-full rounded-lg border border-foreground/25 bg-transparent px-3 font-mono tabular focus-visible:outline-2 focus-visible:outline-foreground" /></label>
      <p className="text-sm text-foreground/80"><TermsText>{explanation}</TermsText>{b.phase === 'Active' && !b.kuru && <> <Link href="/vault" className="underline underline-offset-4">View vault holdings</Link>.</>}</p>
    </div>
    {!valid && <p role="alert" className="mb-3 text-sm">Enter a positive amount, such as 10.</p>}
    {prices.error && b.kuru && <p role="alert" className="mb-3 text-sm">Market prices could not be read. <button type="button" onClick={() => void prices.refetch()} className="min-h-11 underline">Retry price</button></p>}
    <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite" aria-atomic="true">
      <div><dt className="text-sm"><Term term="claim">Claims</Term> received</dt><dd className="mt-1 font-mono text-xl tabular">{estimate?.claims.toLocaleString('en-US', { maximumFractionDigits: 4 }) ?? 'Unavailable'}</dd></div>
      <div><dt className="text-sm">Expected back by <Term term="maturity">maturity</Term> at the current revenue rate</dt><dd className="mt-1 font-mono text-xl tabular">{cash(estimate?.expected)}</dd><p className="mt-1 text-xs text-foreground/70">{yieldPercent(estimate?.gain ?? null)} gain/loss · {yieldPercent(estimate?.apr ?? null)} <Term term="apr">simple APR</Term></p></div>
      <div><dt className="text-sm">If revenue stops today</dt><dd className="mt-1 font-mono text-xl tabular">{cash(estimate?.stopped)}</dd><p className="mt-1 text-xs text-foreground/70"><Term term="backing">Backing</Term> + capital still held, if returned</p></div>
      <div><dt className="text-sm">Best case</dt><dd className="mt-1 font-mono text-xl tabular">{cash(estimate?.best)}</dd><p className="mt-1 text-xs text-foreground/70"><Term term="cap">Repayment cap</Term> reached; includes any returnable capital</p></div>
    </dl>
    {estimate?.paybackDays !== null && estimate?.paybackDays !== undefined && <p className="mt-4 text-sm">Estimated payback: <span className="font-mono tabular">{estimate.paybackDays.toLocaleString('en-US', { maximumFractionDigits: 1 })} days</span> from today.</p>}
    {estimate?.exceedsSupply && <p className="mt-4 text-sm"><TermsText>This amount exceeds all available claims. The figures show proportions only; reduce the amount before investing.</TermsText></p>}
    {b.phase === 'Funding' && valid && Number(amount) > b.raise - b.raised && <p className="mt-3 text-sm">Only {fmt(Math.max(0, b.raise - b.raised), b.asset)} remains to fund. This amount cannot be deposited in full.</p>}
    <p id="calculator-assumption" className="mt-5 text-xs leading-relaxed text-foreground/70"><TermsText>{`Assumes trailing 7-day attributed revenue and the current share continue, no further capital release, and undrawn capital returns by maturity; excludes fees, price impact and future stake recovery. Not a guarantee.${b.phase === 'Funding' ? ' Funding assumes the full raise activates at the deadline; if cancelled, deposits are refunded in full.' : ''} Best case allows the second release only while still possible.`}</TermsText></p>
    {!account && <p className="mt-3 text-sm">Revenue history is unavailable, so expected return cannot be estimated.</p>}
  </Panel>;
}
