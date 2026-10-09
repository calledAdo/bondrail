'use client';
import { useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Search,
  SlidersHorizontal,
  ShieldCheck,
  Radio,
  ArrowRight,
  Layers3,
} from 'lucide-react';
import { money } from '@/lib/data';
import { useMarkets } from '@/lib/live';
import { CapitalRibbon, Sparkline } from './visuals';
export function Marketplace() {
  const [filter, setFilter] = useState('All markets');
  const [query, setQuery] = useState('');
  const { markets, live } = useMarkets();
  const totals = markets.reduce(
    (t, m) => ({
      released: t.released + (m.phase === 'Funding' ? 0 : m.released),
      escrow: t.escrow + (m.phase === 'Funding' ? 0 : m.undrawn),
      funding: t.funding + (m.phase === 'Funding' ? m.raised : 0),
    }),
    { released: 0, escrow: 0, funding: 0 },
  );
  const committed = totals.released + totals.escrow + totals.funding;
  const visible = markets.filter(
    (m) =>
      (filter === 'All markets' || m.phase === filter) &&
      `${m.name} ${m.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="crumb">Explore / Revenue financing</div>
          <h1>
            Revenue markets<span className="count">{String(markets.length).padStart(2, '0')}</span>
          </h1>
          <p>Back a business. See where every part of your capital goes.</p>
        </div>
        <Link className="button primary" href="/issue">
          Raise capital <ArrowUpRight size={16} aria-hidden />
        </Link>
      </div>
      <section className="market-overview" aria-label="Marketplace overview">
        <div className="overview-title">
          <Layers3 size={22} aria-hidden />
          <h2>
            Capital has stages.
            <br />
            Your view should, too.
          </h2>
          <p>
            Release a portion upfront. Keep the rest committed until the business meets its agreed milestone.
          </p>
        </div>
        <div className="overview-capital">
          <div className="overview-total">
            <span>{live ? 'Capital committed on Monad testnet' : 'Illustrative capital committed'}</span>
            <strong>
              {money(committed, committed < 100 ? 2 : 0)}
              <small>test USDC</small>
            </strong>
          </div>
          <div className="overview-strip">
            {(['released', 'escrow', 'funding'] as const)
              .filter((k) => totals[k] > 0)
              .map((k) => (
                <span key={k} className={k} style={{ flex: totals[k] }}>
                  {money(totals[k], totals[k] < 100 ? 2 : 0)}
                </span>
              ))}
          </div>
          <div className="overview-legend">
            <span>
              <i className="released" />
              Released
            </span>
            <span>
              <i className="escrow" />
              Awaiting milestone
            </span>
            <span>
              <i className="funding" />
              Funding escrow
            </span>
          </div>
          <p>Undrawn capital may still be released. It is not earned yield or guaranteed recovery.</p>
        </div>
      </section>
      <div className="market-toolbar">
        <div className="tabs" aria-label="Filter markets">
          {['All markets', 'Active', 'Funding'].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={filter === f ? 'selected' : ''}
            >
              {f}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={17} aria-hidden />
          <input
            aria-label="Search businesses"
            placeholder="Search businesses"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <section className="market-list" aria-label="Revenue markets">
        <div className="market-labels">
          <span>Business / revenue source</span>
          <span>Capital raised</span>
          <span>Revenue share</span>
          <span>Term</span>
          <span>Observed trend</span>
          <span />
        </div>
        {visible.map((m) => (
          <Link href={`/bonds/${m.id}`} key={m.id} className="market-row">
            <div className="business">
              <div className={`business-icon ${m.accent}`}>
                {m.id === 'pumplab' ? <Layers3 size={25} /> : <Radio size={25} />}
              </div>
              <div>
                <h3>
                  {m.name}
                  <span className={`badge ${m.phase === 'Active' ? 'good' : 'neutral'}`}>
                    {m.phase === 'Active' ? 'Collecting' : 'Funding'}
                  </span>
                </h3>
                <p>
                  {m.category} <span className="inline-dot" />{' '}
                  {m.adapter === 'Watched' ? <Radio size={13} /> : <ShieldCheck size={13} />} {m.adapter}{' '}
                  source
                </p>
              </div>
            </div>
            <div className="row-capital">
              <strong>
                {money(m.raised)} <span>/ {money(m.target)}</span>
              </strong>
              <CapitalRibbon market={m} compact />
              <small>
                {m.firstRelease}% upfront · {100 - m.firstRelease}% conditional
              </small>
            </div>
            <div className="row-number">
              <strong>{m.share}%</strong>
              <small>of routed receipts</small>
            </div>
            <div className="row-number">
              <strong>{m.term} days</strong>
              <small>collection term</small>
            </div>
            <div className="trend">
              <Sparkline values={m.history} color={m.accent === 'teal' ? 'var(--teal)' : 'var(--blue)'} />
              <small>{m.days}-day synthetic sample</small>
            </div>
            <ArrowUpRight size={20} className="row-arrow" aria-hidden />
          </Link>
        ))}
        {visible.length === 0 && (
          <div className="empty">
            <Search size={24} />
            <h3>No matching businesses</h3>
            <p>Try another name or view all markets.</p>
            <button
              className="button"
              onClick={() => {
                setFilter('All markets');
                setQuery('');
              }}
            >
              Reset filters
            </button>
          </div>
        )}
      </section>
      <div className="market-bottom">
        <section>
          <h3>Revenue is an outcome, not a promise.</h3>
          <p>
            These claims pay from collected revenue and any principal or stake recovery. A repayment cap
            limits receipts; it does not guarantee a return.
          </p>
        </section>
        <Link href="/bonds/pumplab" className="learn-link">
          <span>
            Follow a financing cycle<small>From first release to final settlement</small>
          </span>
          <ArrowRight size={21} />
        </Link>
      </div>
      <div className="section-heading">
        <h2>What sits behind a market</h2>
        <span>Know the collection boundary</span>
      </div>
      <div className="adapter-explain">
        <div>
          <ShieldCheck size={23} />
          <h3>Native source</h3>
          <p>
            Built on Slice from day one: fees are pulled through the business&apos;s SliceAccount, so they
            cannot be diverted, and its revenue history starts with its first payment.
          </p>
        </div>
        <div>
          <ShieldCheck size={23} />
          <h3>Locked source</h3>
          <p>
            A recognized fee guard restricts changes to the committed route. Its permission boundary is
            explicit.
          </p>
        </div>
        <div>
          <Radio size={23} />
          <h3>Watched source</h3>
          <p>
            Signed observations monitor one declared payment offer. Unavailable monitoring is shown as
            unknown.
          </p>
        </div>
        <div>
          <SlidersHorizontal size={23} />
          <h3>Conditional capital</h3>
          <p>
            A second draw needs the agreed time window, revenue evidence and a healthy source. No silent
            unlocks.
          </p>
        </div>
      </div>
    </>
  );
}
