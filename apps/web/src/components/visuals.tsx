import type { Market } from '@/lib/data';
import { money } from '@/lib/data';
export function CapitalRibbon({ market, compact = false }: { market: Market; compact?: boolean }) {
  const m = market;
  const segments =
    m.phase === 'Funding'
      ? [
          { label: 'In funding escrow', value: m.raised, kind: 'escrow' },
          { label: 'Remaining to raise', value: m.target - m.raised, kind: 'unfunded' },
        ]
      : [
          { label: 'Released to issuer', value: m.released, kind: 'released' },
          { label: 'Undrawn commitment', value: m.undrawn, kind: 'escrow' },
          { label: 'Principal recovery', value: m.recovery, kind: 'recovery' },
        ];
  return (
    <div className={`capital ${compact ? 'compact' : ''}`}>
      <div
        className="capital-track"
        role="img"
        aria-label={segments
          .filter((s) => s.value)
          .map((s) => `${s.label}: ${money(s.value, 0, m.unit)}`)
          .join('; ')}
      >
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <div key={s.kind} className={`capital-segment ${s.kind}`} style={{ flex: s.value }}>
              {!compact && <span>{money(s.value, 0, m.unit)}</span>}
            </div>
          ))}
      </div>
      {!compact && (
        <div className="capital-legend">
          {segments
            .filter((s) => s.value > 0)
            .map((s) => (
              <span key={s.kind}>
                <i className={s.kind} />
                {s.label}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
export function Sparkline({ values, color = 'var(--blue)' }: { values: number[]; color?: string }) {
  return (
    <svg className="sparkline" viewBox="0 0 150 42" role="img" aria-label="Synthetic revenue trend">
      <path
        d={`M ${values.map((v, i) => `${(i * 150) / (values.length - 1)},${40 - v * 0.35}`).join(' L ')}`}
        fill="none"
        stroke={color}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function RevenueChart({ market }: { market: Market }) {
  if (market.live && market.daily?.length) return <LiveRevenueChart market={market} />;
  return (
    <div className="revenue-chart">
      <div className="chart-summary">
        <div>
          <span>Observed receipts</span>
          <strong>{money(market.observed, 0, market.unit)}</strong>
        </div>
        <div>
          <span>Eligible after known exclusions</span>
          <strong>{money(market.eligible, 0, market.unit)}</strong>
        </div>
        <div>
          <span>Concentration-adjusted</span>
          <strong>{money(market.adjusted, 0, market.unit)}</strong>
        </div>
      </div>
      <div
        className="bar-chart"
        role="img"
        aria-label={`Synthetic ${market.days}-day sample: observed ${money(market.observed, 0, market.unit)}, eligible ${money(market.eligible, 0, market.unit)}. Not sufficient for live underwriting.`}
      >
        {market.history.map((n, i) => (
          <div
            key={i}
            className="bar-column"
            title={`Sample day ${i + 1}: ${money((market.observed * n) / market.history.reduce((a, b) => a + b, 0), 2, market.unit)} observed; ${money((market.eligible * n) / market.history.reduce((a, b) => a + b, 0), 2, market.unit)} eligible`}
          >
            <div className="chart-bar" style={{ height: `${n}%` }}>
              <span style={{ height: `${(market.eligible / market.observed) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="chart-axis">
        <span>Sample start</span>
        <span>{market.days} observed days · synthetic</span>
        <span>Sample end</span>
      </div>
      <div className="chart-legend">
        <span>
          <i className="chart-key observed" />
          Observed
        </span>
        <span>
          <i className="chart-key eligible" />
          Eligible after known exclusions
        </span>
      </div>
    </div>
  );
}

/** Daily raw vs verified revenue from the indexer. The gap is revenue from related payers. */
function LiveRevenueChart({ market: m }: { market: Market }) {
  const days = m.daily!;
  const peak = Math.max(...days.map((d) => d.raw), 1e-9);
  return (
    <div className="revenue-chart">
      <div className="chart-summary">
        <div>
          <span>Raw revenue</span>
          <strong>{money(m.observed, 4, m.unit)}</strong>
        </div>
        <div>
          <span>Verified (related payers excluded)</span>
          <strong>{money(m.eligible, 4, m.unit)}</strong>
        </div>
        <div>
          <span>Concentration-adjusted</span>
          <strong>{money(m.adjusted, 4, m.unit)}</strong>
        </div>
      </div>
      <div
        className="bar-chart"
        role="img"
        aria-label={`${days.length} days: raw ${money(m.observed, 4, m.unit)}, verified ${money(m.eligible, 4, m.unit)}`}
      >
        {days.map((d) => (
          <div
            key={d.day}
            className="bar-column"
            title={`${new Date(d.day * 86_400_000).toISOString().slice(0, 10)}: ${money(d.raw, 4, m.unit)} raw; ${money(d.verified, 4, m.unit)} verified`}
          >
            <div className="chart-bar" style={{ height: `${(d.raw / peak) * 100}%` }}>
              <span style={{ height: `${d.raw ? (d.verified / d.raw) * 100 : 0}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="chart-axis">
        <span>{new Date(days[0].day * 86_400_000).toISOString().slice(0, 10)}</span>
        <span>{days.length} indexed day{days.length === 1 ? '' : 's'} · Envio</span>
        <span>{new Date(days[days.length - 1].day * 86_400_000).toISOString().slice(0, 10)}</span>
      </div>
      <div className="chart-legend">
        <span>
          <i className="chart-key observed" />
          Raw
        </span>
        <span>
          <i className="chart-key eligible" />
          Verified
        </span>
      </div>
    </div>
  );
}
