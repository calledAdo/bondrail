'use client';
import { bondImpliedYield, yieldPercent } from '@/lib/bond-yield';
import { useKuruPrice } from '@/lib/kuru';
import { fmt, type AccountView, type BondView } from '@/lib/protocol';
import { Panel } from './ui';

export function ImpliedYieldPanel({ b, account }: { b: BondView; account?: AccountView }) {
  const { mid } = useKuruPrice(b.kuru?.market);
  const y = bondImpliedYield(b, account, mid, Date.now() / 1000);
  if (!b.kuru && b.phase !== 'Funding') return (
    <p className="text-sm text-foreground/60">No market yet — yield appears once claims trade</p>
  );
  const payback = y.paybackDays !== null
    ? y.paybackDays === 0 ? 'Now' : `${y.paybackDays.toLocaleString('en-US', { maximumFractionDigits: 1 })} days`
    : y.impliedReturn !== null ? 'Not by maturity' : '–';
  return (
    <Panel title="Implied yield">
      {!b.kuru && <p className="mb-4 text-sm text-foreground/60">No market yet — yield appears once claims trade. Funding estimate below uses the par price.</p>}
      <dl className="grid grid-cols-2 gap-5 text-sm sm:grid-cols-4">
        {[
          [b.kuru ? 'Kuru mid price' : b.phase === 'Funding' ? 'Raise price' : 'Market price', y.price === null ? '–' : fmt(y.price, b.asset, 4)],
          ['Implied return', yieldPercent(y.impliedReturn)],
          ['Simple APR', yieldPercent(y.impliedAPR)],
          ['Payback', payback],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-foreground/60">{label}</dt>
            <dd className="break-words font-mono tabular">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-xs text-foreground/60">
        Assumes attributed revenue continues at the trailing 7-day rate; not a guarantee.
        {b.phase === 'Funding' && ' Funding assumes the full raise activates at the funding deadline and only the initial capital release occurs. It excludes later releases and capital or stake recoveries.'}
      </p>
    </Panel>
  );
}
