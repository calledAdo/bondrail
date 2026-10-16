'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpRight, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { days, fmt, indexedPhase, unit, listed, marketTab, short, useProtocol, type AccountView, type BondView } from '@/lib/protocol';
import { Badge, Empty, PhaseBadge, Ribbon, TierBadge } from './ui';
import { bondImpliedYield, yieldPercent } from '@/lib/bond-yield';
import { useKuruPrice } from '@/lib/kuru';

const TABS = [
  ['raising', 'Raising', 'Bonds open for deposits'],
  ['trading', 'Trading', 'Live bonds repaying from revenue; claims trade on Kuru'],
  ['record', 'Track record', 'Businesses building history, and finished bonds'],
] as const;

function TradingYield({ b, account }: { b: BondView; account?: AccountView }) {
  const { mid } = useKuruPrice(b.kuru?.market);
  const y = bondImpliedYield(b, account, mid, Date.now() / 1000);
  if (mid === null) return null;
  return (
    <p className="text-sm">
      <span className="text-foreground/60">Implied APR </span>
      <span className="font-mono tabular">{yieldPercent(y.impliedAPR)}</span>
      <span className="text-xs text-foreground/60"> · simple APR</span>
    </p>
  );
}

function BondCard({ b, account }: { b: BondView; account?: AccountView }) {
  const warn = b.flags.length > 0;
  return (
    <Link
      href={`/bonds/${b.address}`}
      className="group flex flex-col gap-5 rounded-xl border border-foreground/10 p-5 transition-colors duration-300 hover:border-foreground/25"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">{b.name}</h3>
          <p className="font-mono text-xs text-foreground/60">{b.symbol}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <TierBadge tier={b.tier} />
          <PhaseBadge phase={b.phase} defaulted={b.defaulted} />
        </div>
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-foreground/60">{b.phase === 'Funding' ? 'Raised' : 'Repaid'}</span>
          <span className="font-mono tabular">
            {b.phase === 'Funding' ? fmt(b.raised, b.asset) : fmt(b.collected, b.asset)}{' '}
            <span className="text-foreground/60">/ {fmt(b.phase === 'Funding' ? b.raise : b.effectiveCap, b.asset)}</span>
          </span>
        </div>
        <Ribbon b={b} compact />
      </div>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-foreground/60">Multiple</dt>
          <dd className="font-mono tabular">{b.multiple.toFixed(2)}×</dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/60">Coverage</dt>
          <dd className={cn('font-mono tabular', b.coverage !== null && b.coverage < 1.2 && 'text-orange-500')}>
            {b.coverage === null ? '–' : `${b.coverage.toFixed(1)}×`}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-foreground/60">Share</dt>
          <dd className="font-mono tabular">{b.revenueShare}%</dd>
        </div>
      </dl>
      {marketTab(b) === 'trading' && b.kuru && <TradingYield b={b} account={account} />}
      <p className="text-xs text-foreground/60">
        {account ? (
          <>
            Attributed {fmt(account.verifiedDaily, b.asset)}/day · {account.uniquePayers} payers · {days(account.ageDays)} of history
          </>
        ) : (
          'No indexed history'
        )}
        {' · '}repays in {b.asset.symbol}
      </p>
      {warn && (
        <p className="flex items-start gap-1.5 text-xs text-orange-500">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {b.flags.join(' · ')}
        </p>
      )}
    </Link>
  );
}

function AccountRow({ a }: { a: AccountView }) {
  return (
    <Link href={`/accounts/${a.address}`} className="grid grid-cols-2 gap-3 py-4 text-sm transition-colors hover:bg-foreground/[0.02] sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] sm:items-center">
      <span className="font-mono">{short(a.address)}</span>
      <span className="text-foreground/60">{a.tier ?? 'No source yet'}</span>
      <span className="font-mono tabular">{fmt(a.verified, a.asset)} attributed</span>
      <span className="text-foreground/60">{a.uniquePayers} payers · {days(a.ageDays)}</span>
      <ArrowUpRight className="hidden size-4 text-foreground/40 sm:block" />
    </Link>
  );
}

export function Markets() {
  const { data, loading, error, configured, metas } = useProtocol();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('raising');
  const [all, setAll] = useState(false);
  const [q, setQ] = useState('');
  const accounts = useMemo(() => new Map(data?.accounts.map((a) => [a.address, a])), [data]);
  const bonds = (data?.bonds ?? []).filter((b) => marketTab(b) === tab && (!q || `${b.name} ${b.symbol}`.toLowerCase().includes(q.toLowerCase())));
  const shown = all ? bonds : bonds.filter(listed);
  const hidden = bonds.length - shown.length;
  const pending = (data?.indexedBonds ?? []).filter(b => !data?.bonds.some(full => full.address === b.id) && marketTab({ phase: indexedPhase(b) }) === tab);
  const pipeline = (data?.accounts ?? []).filter((a) => !a.activeBond && a.payments > 0);

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-3">
          <p className="font-mono text-xs text-foreground/60">(markets)</p>
          <h1 className="text-4xl font-semibold sm:text-5xl">Revenue bonds</h1>
          <p className="max-w-xl text-foreground/60">
            Every bond is backed by an account whose revenue is on-chain. Ranked by evidence, not by who paid for placement.
          </p>
        </div>
        <Link href="/console" className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Issue a revenue bond <ArrowUpRight className="size-4" />
        </Link>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground/10">
        <div role="tablist" className="flex gap-6">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn('-mb-px border-b-2 pb-3 text-sm transition-colors', tab === id ? 'border-foreground text-foreground' : 'border-transparent text-foreground/60 hover:text-foreground')}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="mb-3 flex h-9 items-center gap-2 rounded-lg border border-foreground/15 px-3 text-sm">
          <Search className="size-4 text-foreground/60" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bonds" className="w-40 bg-transparent outline-none placeholder:text-foreground/40" />
        </label>
      </div>
      <p className="-mt-6 text-sm text-foreground/60">{TABS.find((t) => t[0] === tab)![2]}</p>

      {!configured ? (
        <Empty title="No indexer configured">Set NEXT_PUBLIC_INDEXER_URL to list live bonds.</Empty>
      ) : loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-72 animate-pulse rounded-xl border border-foreground/10 bg-foreground/[0.02]" />
          ))}
        </div>
      ) : error ? (
        <Empty title="Couldn't reach the indexer">{error.message}</Empty>
      ) : (
        <>
          {shown.length === 0 && pending.length === 0 && (tab !== 'record' || pipeline.length === 0) ? (
            <Empty title={tab === 'raising' ? 'Nothing raising right now' : tab === 'trading' ? 'No live bonds' : 'No history yet'} />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pending.map(b => {
                const a = accounts.get(b.account);
                return <Link key={b.id} href={`/bonds/${b.id}`} className="rounded-xl border border-foreground/10 p-5">
                  <h3 className="font-semibold">{a?.profile?.profile.name || short(b.id)}</h3>
                  <PhaseBadge phase={indexedPhase(b)} defaulted={b.defaulted} />
                  {a && <p className="mt-3 text-sm">Repaid {fmt(unit(b.revenueCollected, a.asset), a.asset)} of {fmt(unit(b.effectiveCap, a.asset), a.asset)} (current cap)</p>}
                  <p className="mt-3 text-xs text-foreground/70">{metas[data!.indexedBonds.indexOf(b)]?.error ? 'Full terms could not be read. Open the bond to retry.' : 'Full terms are loading. Open the bond for details.'}</p>
                </Link>;
              })}
              {shown.map((b) => (
                <BondCard key={b.address} b={b} account={accounts.get(b.account)} />
              ))}
            </div>
          )}
          {hidden > 0 && (
            <button type="button" onClick={() => setAll(true)} className="text-sm text-foreground/60 underline-offset-4 hover:text-foreground hover:underline">
              Show all ({hidden} hidden: no signed profile, unhealthy source, unrecognised asset, or too few payers)
            </button>
          )}
          {all && <Badge tone="warn">Showing unverified listings</Badge>}
          {tab === 'record' && pipeline.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">Building history</h2>
              <p className="text-sm text-foreground/60">Accounts with revenue and no live bond: the next to raise.</p>
              <div className="divide-y divide-foreground/10 border-y border-foreground/10">
                {pipeline.map((a) => (
                  <AccountRow key={a.address} a={a} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
