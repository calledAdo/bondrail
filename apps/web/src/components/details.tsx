'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  ShieldCheck,
  Radio,
  Check,
  Clock3,
  LockKeyhole,
  Info,
  FileText,
  ChevronRight,
} from 'lucide-react';
import { type Market, money, shortAddress } from '@/lib/data';
import { CapitalRibbon, RevenueChart } from './visuals';
import { LiveContract } from './live-contract';
export function Details({ market, issuer = false }: { market: Market; issuer?: boolean }) {
  const [scenario, setScenario] = useState('Current example');
  const [tab, setTab] = useState('Overview');
  const live = !!market.live;
  const m = live
    ? market
    : scenario === 'Default & recovery'
      ? {
          ...market,
          phase: 'Active' as const,
          raised: market.target,
          released: (market.target * market.firstRelease) / 100,
          undrawn: 0,
          recovery: (market.target * (100 - market.firstRelease)) / 100,
          defaulted: true,
        }
      : scenario === 'Closing'
        ? {
            ...market,
            phase: 'Closing' as const,
            raised: market.target,
            released: (market.target * market.firstRelease) / 100,
            undrawn: 0,
            recovery: (market.target * (100 - market.firstRelease)) / 100,
          }
        : market;
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={15} />
        All markets
      </Link>
      <div className="page-heading detail-heading">
        <div className="business-icon large blue">
          {market.adapter === 'Watched' ? <Radio size={29} /> : <ShieldCheck size={29} />}
        </div>
        <div className="detail-title">
          <div className="crumb">{issuer ? 'Business profile' : `Revenue claim / ${market.symbol}`}</div>
          <h1>
            {market.name}
            <span className={`badge ${m.defaulted ? 'danger' : m.phase === 'Funding' ? 'neutral' : 'good'}`}>
              {m.defaulted ? 'Default recorded' : m.phase}
            </span>
          </h1>
          <p>{market.description}</p>
        </div>
        <Link href={issuer ? `/bonds/${market.id}` : `/issuers/${market.id}`} className="button">
          {issuer ? 'View financing' : 'Business profile'}
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="detail-layout">
        <div className="detail-main">
          <section className="panel capital-panel">
            <div className="section-heading">
              <h2>Where the capital stands</h2>
              {live ? (
                <span className="badge good">Live · Monad testnet</span>
              ) : (
                <label className="scenario-select">
                  <span className="sr-only">Synthetic scenario</span>
                  <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                    <option>Current example</option>
                    <option>Default & recovery</option>
                    <option>Closing</option>
                  </select>
                </label>
              )}
            </div>
            <div className="capital-total">
              <span>Total capital raised</span>
              <strong>
                {money(m.raised, 2, m.unit)}
                <small>{m.unit ?? 'USDC'}{live ? '' : ' · synthetic'}</small>
              </strong>
            </div>
            <CapitalRibbon market={m} />
            <div className="capital-secondary">
              <div>
                <span>Revenue collected</span>
                <strong>{money(m.revenue, 2, m.unit)}</strong>
              </div>
              <div>
                <span>Principal recovery</span>
                <strong>{money(m.recovery, 2, m.unit)}</strong>
              </div>
              <div>
                <span>Stake {m.defaulted ? 'recovery' : 'held'}</span>
                <strong>{money(m.stake, 2, m.unit)}</strong>
              </div>
            </div>
            {m.defaulted ? (
              <p className="notice danger">
                The undrawn commitment is now reserved for tokenholder recovery. Default does not guarantee
                full repayment. Redemption follows final settlement.
              </p>
            ) : m.phase === 'Closing' ? (
              <p className="notice warning">
                Collection has stopped. A 120-second window admits eligible historical evidence before final
                settlement. New capital releases are disabled.
              </p>
            ) : (
              <p className="capital-note">
                <Info size={15} />
                Undrawn capital may still go to the issuer. It is distinct from collected revenue and
                permanent principal recovery.
              </p>
            )}
          </section>
          <div className="tabs detail-tabs" aria-label="Detail sections">
            {['Overview', 'Revenue & evidence', 'Terms'].map((t) => (
              <button
                key={t}
                className={tab === t ? 'selected' : ''}
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'Overview' && (
            <>
              <section className="panel">
                <div className="section-heading">
                  <h2>Two releases. One claim.</h2>
                  <span>
                    {m.firstRelease} / {100 - m.firstRelease} split
                  </span>
                </div>
                <div className="release-step">
                  <div className="step-icon complete">
                    <Check size={18} />
                  </div>
                  <div>
                    <h3>
                      First release <span>{m.firstRelease}% of raised capital</span>
                    </h3>
                    <p>
                      Only after the raise is completely funded and the issuer activates. Revenue collection
                      starts at activation.
                    </p>
                  </div>
                </div>
                <div className="release-step">
                  <div className="step-icon">
                    <LockKeyhole size={18} />
                  </div>
                  <div>
                    <h3>
                      Second release <span>{100 - m.firstRelease}% conditional</span>
                    </h3>
                    <p>
                      Within the fixed release window, with a healthy source and proof of revenue since
                      activation: either the SliceAccount&apos;s own on-chain counter or a signed, wash-adjusted
                      attestation, as fixed in the bond&apos;s terms.
                    </p>
                    <div className="mini-gates">
                      <span>
                        <Clock3 size={13} />
                        Operating interval
                      </span>
                      <span>
                        <FileText size={13} />
                        Revenue evidence
                      </span>
                      <span>
                        <ShieldCheck size={13} />
                        Source health
                      </span>
                    </div>
                  </div>
                </div>
                <div className="release-step">
                  <div className="step-icon">
                    <ArrowLeft size={18} />
                  </div>
                  <div>
                    <h3>Unreleased capital can become recovery</h3>
                    <p>
                      If the deadline is missed, default occurs, or collection closes, the remaining
                      commitment belongs to claim holders at final redemption.
                    </p>
                  </div>
                </div>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h2>The source boundary</h2>
                  <span className="badge neutral">{m.adapter}</span>
                </div>
                <p>
                  {m.adapter === 'Native'
                    ? 'Built on Slice: every fee is pulled through this business\'s SliceAccount, which is fixed into its contract forever. There is no other fee path, so revenue cannot be diverted.'
                    : 'Paid over x402. Chainlink CRE checks the advertised payTo every 30 seconds; two adjacent violations default the bond and slash the issuer\'s stake. Payments between a switch and its detection are at risk.'}
                </p>
                <SourceHealth market={m} />
              </section>
              {m.live && m.credit && <CreditHistory market={m} />}
            </>
          )}
          {tab === 'Revenue & evidence' && (
            <>
              <section className="panel">
                <div className="section-heading">
                  <h2>Receipts, with context</h2>
                  <span className="badge neutral">{live ? `${m.payments ?? 0} payments indexed by Envio` : 'Synthetic sample'}</span>
                </div>
                <RevenueChart market={m} />
                <p className="notice warning">
                  {m.days} observed day{m.days === 1 ? '' : 's'}. A live terms recommendation needs 30 complete
                  days. Separate funding does not prove independent customers.
                </p>
              </section>
              {live && <PayerTable market={m} />}
              <section className="panel">
                <h2>Payer evidence</h2>
                <div className="evidence-row">
                  <div>
                    <strong>Separately funded cohort</strong>
                    <p>Team-controlled demonstration wallets</p>
                  </div>
                  <span className="badge neutral">Synthetic</span>
                </div>
                <div className="evidence-row">
                  <div>
                    <strong>Issuer-funded cohort</strong>
                    <p>Known treasury funding pattern</p>
                  </div>
                  <span className="badge warning">Excluded</span>
                </div>
                <div className="evidence-row">
                  <div>
                    <strong>Nansen enrichment</strong>
                    <p>Screens payers against Nansen labels on Monad mainnet; never mapped onto testnet activity</p>
                  </div>
                  <span className="badge neutral">On demand</span>
                </div>
                <p className="footnote">
                  An empty provider response or missing funding edge means incomplete knowledge, not a
                  clean-wallet certificate.
                </p>
              </section>
            </>
          )}
          {tab === 'Terms' && (
            <section className="panel">
              <h2>{live ? 'Instrument terms (read from the bond contract)' : 'Illustrative instrument terms'}</h2>
              <dl className="fact-list roomy">
                <div>
                  <dt>Revenue participation</dt>
                  <dd>{m.share}% of routed receipts</dd>
                </div>
                <div>
                  <dt>Collection term</dt>
                  <dd>{m.term} days</dd>
                </div>
                <div>
                  <dt>First / second release</dt>
                  <dd>
                    {m.firstRelease}% / {100 - m.firstRelease}%
                  </dd>
                </div>
                <div>
                  <dt>Cap after first release</dt>
                  <dd>{money((m.cap * m.firstRelease) / 100, 2, m.unit)}</dd>
                </div>
                <div>
                  <dt>Full-release cap</dt>
                  <dd>{money(m.cap, 2, m.unit)}</dd>
                </div>
                <div>
                  <dt>Claim class</dt>
                  <dd>One fungible class</dd>
                </div>
                <div>
                  <dt>Early redemption</dt>
                  <dd>From activation, at the current backing per claim</dd>
                </div>
                <div>
                  <dt>Second-release evaluator</dt>
                  <dd>Dedicated trusted signer</dd>
                </div>
                <div>
                  <dt>Historical evidence window</dt>
                  <dd>120 seconds after collection close</dd>
                </div>
              </dl>
              <p className="notice">
                The cap scales with released capital. Revenue, principal recovery and slashed stake are
                accounted for separately. Preview amounts are not an offer or live contract terms.
              </p>
            </section>
          )}
        </div>
        <aside>
          <section className="panel decision-panel">
            <span className="badge neutral">{live ? m.symbol : `Illustrative series ${m.symbol}`}</span>
            <h2>
              {m.share}%<small>revenue participation</small>
            </h2>
            <dl className="fact-list">
              <div>
                <dt>Raise target</dt>
                <dd>{money(m.target, 2, m.unit)}</dd>
              </div>
              <div>
                <dt>Term</dt>
                <dd>{m.term} days</dd>
              </div>
              <div>
                <dt>Capital release</dt>
                <dd>
                  {m.firstRelease}% + {100 - m.firstRelease}%
                </dd>
              </div>
              <div>
                <dt>Repayment guarantee</dt>
                <dd>None</dd>
              </div>
            </dl>
            <p>
              Payment depends on collected receipts and recovery. A cap is a ceiling, not a promised return.
            </p>
            <Link className="button full" href={`/issuers/${m.id}`}>
              Review issuer evidence <ChevronRight size={16} />
            </Link>
          </section>
          <LiveContract id={m.id} />
        </aside>
      </div>
    </>
  );
}

const REASONS: Record<string, string> = {
  issuer_wallet: 'Issuer wallet',
  funded_by_issuer_treasury: 'Funded by issuer treasury',
  unclassified_inflow: 'Not a fee or x402 payment',
};

/** Every payer the indexer attributed revenue to, with the evidence for excluding related ones. */
type NansenResult = { address: string; labels: { label: string; category?: string }[] | null; error?: string };

function PayerTable({ market }: { market: Market }) {
  const rows = market.payers ?? [];
  const [nansen, setNansen] = useState<Record<string, NansenResult>>({});
  const [screening, setScreening] = useState('');
  async function screen() {
    setScreening('Asking Nansen…');
    try {
      const r = await fetch('/api/nansen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addresses: rows.slice(0, 10).map((x) => x.payer) }),
      });
      const j = (await r.json()) as { results?: NansenResult[]; error?: string };
      if (!r.ok || !j.results) throw new Error(j.error ?? 'Nansen unavailable');
      setNansen(Object.fromEntries(j.results.map((x) => [x.address, x])));
      setScreening('');
    } catch (e) {
      setScreening((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Payers</h2>
        <span className="badge neutral">
          {rows.filter((r) => r.related).length} of {rows.length} excluded
        </span>
      </div>
      <div className="nansen-bar">
        <button className="button" onClick={screen} disabled={!rows.length || !!screening}>
          Screen top payers with Nansen
        </button>
        <span className="help">
          {screening || 'Nansen labels from Monad mainnet; it does not cover testnet. Empty lookups are free.'}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="help">No payments indexed yet.</p>
      ) : (
        <table className="payer-table">
          <thead>
            <tr>
              <th>Payer</th>
              <th>Source</th>
              <th>Payments</th>
              <th>Paid</th>
              <th>Counted as</th>
              {Object.keys(nansen).length > 0 && <th>Nansen (mainnet)</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 25).map((r) => (
              <tr key={r.payer}>
                <td className="mono">{shortAddress(r.payer)}</td>
                <td>
                  {r.source === 'x402'
                    ? 'x402 settlement (signed by payer)'
                    : r.source === 'native'
                      ? 'Pulled fee (proven payer)'
                      : 'Plain transfer (unclassified)'}
                </td>
                <td>{r.payments}</td>
                <td>{money(r.amount, 4, market.unit)}</td>
                <td>
                  {r.related ? (
                    <span className="badge warning" title={r.reasons.map((x) => REASONS[x] ?? x).join(', ')}>
                      Excluded · {r.reasons.map((x) => REASONS[x] ?? x).join(', ')}
                    </span>
                  ) : (
                    <span className="badge good">Verified</span>
                  )}
                </td>
                {Object.keys(nansen).length > 0 && (
                  <td>
                    {!nansen[r.payer] ? (
                      <span className="help">not screened</span>
                    ) : nansen[r.payer].labels === null ? (
                      <span className="help">{nansen[r.payer].error}</span>
                    ) : nansen[r.payer].labels!.length === 0 ? (
                      <span className="help">No labels</span>
                    ) : (
                      nansen[r.payer].labels!.slice(0, 2).map((l) => (
                        <span key={l.label} className="badge neutral" title={l.category}>
                          {l.label}
                        </span>
                      ))
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="footnote">
        Exclusions come from on-chain funding edges: a payer whose funds came from the issuer&apos;s own
        treasury is the business paying itself.
      </p>
    </section>
  );
}

/** Native: the reviewer's approval. Watched: the latest CRE-delivered observation of the payTo. */
function SourceHealth({ market: m }: { market: Market }) {
  if (!m.live)
    return (
      <div className="source-health">
        <span className="status-dot" />
        Synthetic scenario only<span>Live monitoring status unavailable</span>
      </div>
    );
  if (m.adapter === 'Native')
    return (
      <div className="source-health">
        <span className={`status-dot ${m.nativeApproved ? 'good' : ''}`} />
        {m.nativeApproved ? 'Reviewed: fees pulled through the SliceAccount' : 'Awaiting Slice review'}
        <span>
          {m.nativeApproved
            ? 'The disclosed reviewer checked that every fee goes through SliceEarner'
            : 'History accrues, but the project cannot raise until its code is reviewed'}
        </span>
      </div>
    );
  const last = m.checks?.[0];
  const label = !last ? 'No CRE report yet' : last.result === 1 ? 'Compliant' : last.result === 2 ? 'Violation' : 'Unknown';
  return (
    <div className="source-health">
      <span className={`status-dot ${last?.result === 1 ? 'good' : last?.result === 2 ? 'danger' : ''}`} />
      {label}
      <span>
        {last
          ? `Last Chainlink CRE report ${Math.max(0, Math.round(Date.now() / 1000 - last.at))} s ago · ${m.checks!.length} recent`
          : 'Waiting for the first covenant report'}
      </span>
    </div>
  );
}

/** The SliceAccount's own on-chain record: every booked payment since its first one, bond or no bond. */
function CreditHistory({ market: m }: { market: Market }) {
  const c = m.credit!;
  const since = c.since ? new Date(c.since * 1000).toISOString().slice(0, 10) : '—';
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Revenue history since day one</h2>
        <span className="badge neutral">On-chain · SliceAccount</span>
      </div>
      <dl className="fact-list">
        <div>
          <dt>Total revenue booked</dt>
          <dd>{money(c.cumulative, 4, m.unit)}</dd>
        </div>
        <div>
          <dt>Payments</dt>
          <dd>{c.payments}</dd>
        </div>
        <div>
          <dt>Distinct proven payers</dt>
          <dd>{m.adapter === 'Native' ? c.uniquePayers : 'Off-chain attribution'}</dd>
        </div>
        <div>
          <dt>First revenue</dt>
          <dd>{since}</dd>
        </div>
      </dl>
      <p className="footnote">
        The account counts revenue from its first payment, whether or not a bond exists, so the record that
        underwrites a raise predates the raise. On-chain milestones read the same counter.
      </p>
    </section>
  );
}
