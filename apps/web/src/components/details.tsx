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
import { type Market, money } from '@/lib/data';
import { CapitalRibbon, RevenueChart } from './visuals';
import { LiveContract } from './live-contract';
export function Details({ market, issuer = false }: { market: Market; issuer?: boolean }) {
  const [scenario, setScenario] = useState('Current example');
  const [tab, setTab] = useState('Overview');
  const m =
    scenario === 'Default & recovery'
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
          {market.adapter === 'Locked' ? <ShieldCheck size={29} /> : <Radio size={29} />}
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
              <label className="scenario-select">
                <span className="sr-only">Synthetic scenario</span>
                <select value={scenario} onChange={(e) => setScenario(e.target.value)}>
                  <option>Current example</option>
                  <option>Default & recovery</option>
                  <option>Closing</option>
                </select>
              </label>
            </div>
            <div className="capital-total">
              <span>Total capital raised</span>
              <strong>
                {money(m.raised)}
                <small>test USDC · synthetic</small>
              </strong>
            </div>
            <CapitalRibbon market={m} />
            <div className="capital-secondary">
              <div>
                <span>Revenue collected</span>
                <strong>{money(m.revenue)}</strong>
              </div>
              <div>
                <span>Principal recovery</span>
                <strong>{money(m.recovery)}</strong>
              </div>
              <div>
                <span>Stake {m.defaulted ? 'recovery' : 'held'}</span>
                <strong>{money(m.stake)}</strong>
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
                      Within the fixed release window, with a healthy source and a signed revenue milestone
                      from the disclosed evaluator.
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
                  {m.adapter === 'Locked'
                    ? 'A recognized PumpLab source commits its fee route through a restricted guard. Unknown calls, route changes and ownership changes are blocked while a bond is reserved.'
                    : 'The monitor observes one registered x402 payment offer. Signed reports can identify a mismatch at that endpoint; they cannot prove the absence of other, unobserved payment routes.'}
                </p>
                <div className="source-health">
                  <span className="status-dot" />
                  Synthetic scenario only<span>Live monitoring status unavailable</span>
                </div>
              </section>
            </>
          )}
          {tab === 'Revenue & evidence' && (
            <>
              <section className="panel">
                <div className="section-heading">
                  <h2>Receipts, with context</h2>
                  <span className="badge neutral">Synthetic sample</span>
                </div>
                <RevenueChart market={m} />
                <p className="notice warning">
                  {m.days} observed days. A live terms recommendation needs 30 complete days. Separate funding
                  does not prove independent customers.
                </p>
              </section>
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
                    <p>No mainnet labels are assigned to testnet accounts</p>
                  </div>
                  <span className="badge neutral">Unavailable on testnet</span>
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
              <h2>Illustrative instrument terms</h2>
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
                  <dd>{money((m.target * 1.2 * m.firstRelease) / 100)}</dd>
                </div>
                <div>
                  <dt>Full-release cap</dt>
                  <dd>{money(m.target * 1.2)}</dd>
                </div>
                <div>
                  <dt>Claim class</dt>
                  <dd>One fungible class</dd>
                </div>
                <div>
                  <dt>Early redemption</dt>
                  <dd>Unavailable</dd>
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
            <span className="badge neutral">Illustrative series {m.symbol}</span>
            <h2>
              {m.share}%<small>revenue participation</small>
            </h2>
            <dl className="fact-list">
              <div>
                <dt>Raise target</dt>
                <dd>{money(m.target)}</dd>
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
