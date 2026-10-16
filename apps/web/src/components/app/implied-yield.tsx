'use client';
import { bondImpliedYield, yieldPercent } from '@/lib/bond-yield';
import { useKuruPrice } from '@/lib/kuru';
import { fmt, type AccountView, type BondView } from '@/lib/protocol';
import { useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { erc20Abi, formatUnits } from 'viem';
import { chain } from '@/lib/wallet';
import { claimEstimate, purchaseEstimate } from '@/lib/bond-decision';
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
    : y.impliedReturn !== null ? 'Not by maturity' : null;
  return (
    <Panel title={<Term term="yield">Implied yield</Term>}>
      {!b.kuru && <p className="mb-4 text-sm text-foreground/70"><TermsText>No market yet — yield appears once claims trade. Funding estimate below uses the par price.</TermsText></p>}
      <dl className="grid grid-cols-2 gap-5 text-sm sm:grid-cols-4">
        {[
          [b.kuru ? 'Kuru mid price' : b.phase === 'Funding' ? 'Raise price' : 'Market price', y.price === null ? null : fmt(y.price, b.asset, 4)],
          ['Implied return', y.impliedReturn === null ? null : yieldPercent(y.impliedReturn)],
          ['Simple APR', y.impliedAPR === null ? null : yieldPercent(y.impliedAPR)],
          ['Payback', payback],
        ].filter(([, value]) => value !== null).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-foreground/70"><TermsText>{label!}</TermsText></dt>
            <dd className="break-words font-mono tabular">{value}</dd>
          </div>
        ))}
      </dl>
      {y.impliedReturn === null && <p className="mt-3 text-sm">Return and payback need a usable market price, claim supply and revenue history; those inputs could not all be read.</p>}
      <p className="mt-4 text-xs text-foreground/70">
        Assumes attributed revenue continues at the trailing 7-day rate; not a guarantee.
        {b.phase === 'Funding' && ' Funding assumes the full raise activates at the funding deadline and only the initial capital release occurs. It excludes later releases and capital or stake recoveries.'}
      </p>
    </Panel>
  );
}

/** Purchase scenarios when entry exists; otherwise value the claims already outstanding. */
export function WhatYouGet({ b, account, now }: { b: BondView; account?: AccountView; now: number }) {
  const [amount, setAmount] = useState('10');
  const prices = useKuruPrice(b.kuru?.market);
  const { address } = useAccount();
  const holdingMode = b.phase !== 'Funding' && (b.phase !== 'Active' || !b.kuru);
  const balance = useReadContract({ address: b.address, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined,
    chainId: chain.id, query: { enabled: holdingMode && !!address, refetchInterval: 10000 } });
  const held = balance.data === undefined ? 0 : Number(formatUnits(balance.data, b.asset.decimals));
  const valid = /^\d+(\.\d+)?$/.test(amount) && Number(amount) > 0 && Number.isFinite(Number(amount));
  const estimate = valid ? purchaseEstimate(b, account, Number(amount), prices.ask, now) : null;
  const value = holdingMode ? claimEstimate(b, account, now) : estimate;
  const usd = /USD/i.test(b.asset.symbol);
  const explanation = holdingMode ? b.phase === 'Active'
    ? "You can't buy claims here right now — no market. These values describe existing claims."
    : 'This bond is no longer open for new purchases. These values describe existing claims.'
    : !usd ? `No USD conversion is available for ${b.asset.symbol}. The bond pays in ${b.asset.symbol}.`
    : b.phase === 'Active' && prices.ask === null ? prices.loading ? 'Reading the market’s current asking price…' : 'No usable asking price. A listed market needs a seller before you can buy.'
    : b.phase === 'Funding' ? 'Deposit at par: $1 buys one claim if the raise activates.' : `Buy at the current Kuru asking price: ${fmt(prices.ask!, b.asset, 4)} per claim.`;
  const rows = [
    ...(holdingMode && value && 'backing' in value ? [{ label: b.phase === 'Cancelled' ? 'Refundable now' : b.phase === 'Closing' ? 'Current backing' : 'Redeemable now (backing)', value: value.backing }] : !holdingMode && estimate ? [{ label: 'Claims received', value: estimate.claims, claims: true }] : []),
    { label: b.phase === 'Closed' || b.phase === 'Closing' || b.phase === 'Cancelled' ? 'At settlement / refund' : 'Expected by maturity at the current rate', value: value?.expected },
    { label: 'If revenue stops today', value: value?.stopped },
    { label: 'Best case', value: value?.best },
  ].filter((row): row is typeof row & { value: number } => typeof row.value === 'number' && Number.isFinite(row.value));
  function scenarios(multiplier: number) {
    return <dl className="grid grid-cols-2 gap-x-4 gap-y-4 lg:grid-cols-4">
      {rows.map(row => <div key={row.label}><dt className="text-xs text-foreground/80"><TermsText>{row.label}</TermsText></dt>
        <dd className="mt-1 break-words font-mono text-lg tabular">{'claims' in row && row.claims ? row.value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : fmt(row.value * multiplier, b.asset, 4)}</dd>
      </div>)}
    </dl>;
  }
  return <Panel compact title={holdingMode ? 'What one claim is worth' : 'What you get'} className="p-4 sm:p-6">
    <div className={`mb-4 grid gap-3 ${!holdingMode && usd ? 'sm:grid-cols-[12rem_1fr] sm:items-end' : ''}`}>
      {!holdingMode && usd && <label className="block space-y-2"><span className="text-sm">Amount in USD</span><input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-invalid={!valid} aria-describedby={rows.length ? "calculator-assumption" : undefined}
        className="min-h-11 w-full rounded-lg border border-foreground/25 bg-transparent px-3 font-mono tabular focus-visible:outline-2 focus-visible:outline-foreground" /></label>}
      <p className="text-sm text-foreground/80"><TermsText>{explanation}</TermsText></p>
    </div>
    {!holdingMode && usd && !valid && <p role="alert" className="mb-3 text-sm">Enter a positive amount, such as 10.</p>}
    {prices.error && b.kuru && <p role="alert" className="mb-3 text-sm">Market prices could not be read. <button type="button" onClick={() => void prices.refetch()} className="min-h-11 underline">Retry price</button></p>}
    <div aria-live="polite" aria-atomic="true">
      {rows.length > 0 && scenarios(1)}
      {holdingMode && held > 0 && rows.length > 0 && <div className="mt-4 border-t border-foreground/10 pt-4" data-testid="holder-value">
        <h3 className="mb-3 text-sm font-medium">Your {held.toLocaleString('en-US', { maximumFractionDigits: 6 })} claims</h3>{scenarios(held)}
      </div>}
      {holdingMode && address && balance.isError && <p className="mt-3 text-sm">Your claim balance could not be read, so wallet totals are omitted.</p>}
      {value && value.expected === null && <p className="mt-3 text-sm">The revenue history or projection inputs could not be read, so the current-rate estimate is omitted.</p>}
      {(holdingMode || (!holdingMode && usd && valid && (b.phase === 'Funding' || prices.ask !== null))) && !value && <p className="mt-3 text-sm">There is no usable outstanding supply or pool balance, so claim values cannot be calculated.</p>}
    </div>
    {!holdingMode && estimate && <>
      {estimate.gain !== null && estimate.apr !== null && <p className="mt-3 text-xs text-foreground/70">{yieldPercent(estimate.gain)} gain/loss · {yieldPercent(estimate.apr)} <Term term="apr">simple APR</Term></p>}
      {estimate.paybackDays !== null && <p className="mt-3 text-sm">Estimated payback: <span className="font-mono tabular">{estimate.paybackDays.toLocaleString('en-US', { maximumFractionDigits: 1 })} days</span> from today.</p>}
      {estimate.exceedsSupply && <p className="mt-3 text-sm"><TermsText>This amount exceeds all available claims. The figures show proportions only; reduce the amount before investing.</TermsText></p>}
    </>}
    {b.phase === 'Funding' && usd && valid && Number(amount) > b.raise - b.raised && <p className="mt-3 text-sm">Only {fmt(Math.max(0, b.raise - b.raised), b.asset)} remains to fund. This amount cannot be deposited in full.</p>}
    {rows.length > 0 && <p id="calculator-assumption" className="mt-4 text-xs leading-relaxed text-foreground/70"><TermsText>{b.phase === 'Cancelled' ? 'Each cancelled claim refunds one asset unit from the funding escrow. No future revenue is projected.' : ['Closing', 'Closed'].includes(b.phase) ? 'Collection has stopped. Values include the current pool and any undrawn capital if returned; they exclude future stake recovery and fees.' : `Current rate assumes trailing revenue/share, no further release and returned undrawn capital. “Stops” is backing + undrawn; best case reaches the cap with any still-possible release. Excludes fees${holdingMode ? '' : ', price impact'} and future stake recovery. Not guaranteed.${b.phase === 'Funding' ? ' Funding assumes a full raise at the deadline; cancelled deposits are refundable.' : ''}`}</TermsText></p>}
  </Panel>;
}
