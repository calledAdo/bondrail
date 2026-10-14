'use client';
// Bond page and account (credit profile) page: a wide evidence column and a narrower decision panel.
import Link from 'next/link';
import { useState } from 'react';
import { useReadContract } from 'wagmi';
import { AlertTriangle, ArrowLeft, ExternalLink } from 'lucide-react';
import { bondAbi, covenantAbi } from '@/lib/abi';
import { chain } from '@/lib/wallet';
import { days, fmt, short, useProtocol, type AccountView, type BondView } from '@/lib/protocol';
import { cn } from '@/lib/cn';
import { creditLine, defaultCreditTerms } from '@bondrail/sdk/credit';
import { RegistryCreditProfile } from './credit-profile';
import { BondActions } from './bond-actions';
import { Trade } from './trade';
import { ImpliedYieldPanel } from './implied-yield';
import { Badge, Empty, Figure, Panel, PhaseBadge, RevenueBars, Ribbon, TierBadge } from './ui';

const explorer = (kind: 'address' | 'tx', v: string) => `${chain.blockExplorers?.default.url}/${kind}/${v}`;
const date = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');

const REASONS: Record<string, string> = {
  issuer_wallet: 'Issuer wallet',
  funded_by_issuer_treasury: 'Funded by issuer',
  unclassified_inflow: 'Not a fee or x402 payment',
};
type NansenResult = { address: string; labels: { label: string }[] | null; error?: string };

function Payers({ a }: { a: AccountView }) {
  const [nansen, setNansen] = useState<Record<string, NansenResult>>({});
  const [note, setNote] = useState('');
  async function screen() {
    setNote('Asking Nansen…');
    try {
      const r = await fetch('/api/nansen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addresses: a.payers.slice(0, 10).map((x) => x.payer) }),
      });
      const j = (await r.json()) as { results?: NansenResult[]; error?: string };
      if (!r.ok || !j.results) throw new Error(j.error ?? 'Nansen unavailable');
      setNansen(Object.fromEntries(j.results.map((x) => [x.address, x])));
      setNote('');
    } catch (e) {
      setNote((e as Error).message);
    }
  }
  const excluded = a.payers.filter((p) => p.related).length;
  return (
    <Panel title="Payers" aside={<Badge>{excluded} of {a.payers.length} excluded</Badge>}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={screen} disabled={!a.payers.length || !!note} className="h-9 rounded-lg border border-foreground/15 px-3 text-sm hover:bg-foreground/5 disabled:opacity-40">
          Screen top payers with Nansen
        </button>
        <span className="text-xs text-foreground/60">{note || 'Labels from Monad mainnet (Nansen does not cover testnet).'}</span>
      </div>
      {a.payers.length === 0 ? (
        <p className="text-sm text-foreground/60">No payments indexed yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-foreground/60">
              <tr className="border-b border-foreground/10">
                <th className="py-2 font-normal">Payer</th>
                <th className="py-2 font-normal">How</th>
                <th className="py-2 text-right font-normal">Payments</th>
                <th className="py-2 text-right font-normal">Paid</th>
                <th className="py-2 pl-4 font-normal">Counted</th>
                {Object.keys(nansen).length > 0 && <th className="py-2 font-normal">Nansen</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-foreground/5">
              {a.payers.slice(0, 25).map((p) => (
                <tr key={p.payer}>
                  <td className="py-2 font-mono text-xs">
                    <a href={explorer('address', p.payer)} target="_blank" rel="noreferrer" className="hover:underline">
                      {short(p.payer)}
                    </a>
                  </td>
                  <td className="py-2 text-foreground/70">{p.source === 'x402' ? 'x402 (signed)' : p.source === 'native' ? 'Pulled fee' : 'Plain transfer'}</td>
                  <td className="py-2 text-right font-mono tabular">{p.payments}</td>
                  <td className="py-2 text-right font-mono tabular">{fmt(p.amount, a.asset)}</td>
                  <td className="py-2 pl-4">
                    {p.related ? <Badge tone="warn">{p.reasons.map((r) => REASONS[r] ?? r).join(', ') || 'Excluded'}</Badge> : <span className="text-foreground/60">No link found</span>}
                  </td>
                  {Object.keys(nansen).length > 0 && (
                    <td className="py-2 text-xs text-foreground/70">{nansen[p.payer]?.labels?.map((l) => l.label).join(', ') || '–'}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function History({ a }: { a: AccountView }) {
  const feeRate = a.volume ? (a.revenue / a.volume) * 100 : null;
  return (
    <Panel title="Credit history" aside={<span className="font-mono text-xs text-foreground/60">since {a.firstRevenueAt ? date(a.firstRevenueAt).slice(0, 10) : '–'}</span>}>
      <dl className="mb-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Figure label="Attributed revenue" value={fmt(a.verified, a.asset)} hint={`raw ${fmt(a.revenue, a.asset)}`} />
        <Figure label="Attributed per day" value={fmt(a.verifiedDaily, a.asset)} hint="trailing 7 days" />
        <Figure label="Attributed payers" value={a.uniquePayers} hint={a.topPayerShare ? `top payer ${(a.topPayerShare * 100).toFixed(0)}%` : undefined} />
        <Figure label={feeRate !== null ? 'Fee rate' : 'History'} value={feeRate !== null ? `${feeRate.toFixed(2)}%` : days(a.ageDays)} hint={feeRate !== null ? `on ${fmt(a.volume!, a.asset)} volume` : 'account age'} />
      </dl>
      <RevenueBars daily={a.daily} label={`Daily revenue for the last ${a.daily.length} days`} />
    </Panel>
  );
}

const REPORT_INTERVAL = 30 * 60; // the reporter's schedule (ops/covenant-server)
const ago = (s: number) => (s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`);

function Health({ b, a }: { b: BondView; a?: AccountView }) {
  const covenant = useReadContract({ address: b.address, abi: bondAbi, functionName: 'covenant', chainId: chain.id, query: { enabled: b.tier === 'Watched' } });
  const dark = useReadContract({
    address: covenant.data as `0x${string}` | undefined,
    abi: covenantAbi,
    functionName: 'darkFor',
    args: [b.address],
    chainId: chain.id,
    query: { enabled: !!covenant.data, refetchInterval: 15_000 },
  });
  if (b.tier === 'Native')
    return (
      <Panel title="Source" aside={<TierBadge tier="Native" />}>
        <p className="text-sm text-foreground/70">
          Built on Bondrail: every fee moves through the account, which is fixed into the project&apos;s code. There is no other fee path.
        </p>
        <p className={cn('mt-3 text-sm', a?.reviewed ? 'text-foreground' : 'text-orange-500')}>
          {a?.reviewed ? 'Reviewed: the disclosed reviewer checked that every fee goes through SliceEarner.' : 'Awaiting review: history accrues, but the project cannot raise until its code is reviewed.'}
        </p>
        {b.minFeeBps > 0 && <p className="mt-3 text-sm text-foreground/70">Fee floor while live: {(b.minFeeBps / 100).toFixed(2)}% of each payment.</p>}
      </Panel>
    );
  const last = b.checks[0];
  const darkFor = Number(dark.data ?? 0);
  const drop = a?.revenueDrop;
  const age = last ? Math.max(0, Math.round(Date.now() / 1000 - last.at)) : 0;
  // A report is current evidence only until the next scheduled check is overdue.
  const stale = !!last && age > REPORT_INTERVAL + 5 * 60;
  const status = b.defaulted
    ? { dot: 'bg-red-500', text: 'Defaulted: the stake went to bondholders' }
    : b.phase === 'Closed' || b.phase === 'Cancelled'
      ? { dot: 'bg-foreground/30', text: `${b.phase}: monitoring has ended` }
      : !last
        ? { dot: 'bg-foreground/30', text: 'No CRE report yet' }
        : stale
          ? { dot: 'bg-orange-500', text: `Monitor stale: the last report is ${ago(age)} old and is not current evidence` }
          : last.result === 2
            ? { dot: 'bg-red-500', text: `Violation at the last check (${ago(age)} ago): confirming in the next epoch` }
            : last.result === 1
              ? { dot: 'bg-foreground', text: `Compliant at the last check, ${ago(age)} ago · next check within ${ago(Math.max(60, REPORT_INTERVAL - age))}` }
              : { dot: 'bg-orange-500', text: `Unknown at the last check (${ago(age)} ago): the offer was unreachable or unreadable` };
  const dropped = !!drop && last?.result === 1 && !stale && drop.last24h < drop.dailyAverage / 4;
  return (
    <Panel title="Monitoring" aside={<TierBadge tier="Watched" />}>
      <p className="text-sm text-foreground/70">
        Chainlink CRE checks the manifest and every paid endpoint every 30 minutes. A violation is re-checked in the next 30-second
        epoch; two adjacent violations default the bond and slash the stake. A day of Unknown reports (the offer unreachable) also
        defaults it; a monitor outage does not.
      </p>
      <div className="mt-4 flex items-start gap-2 text-sm">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', status.dot)} />
        <span>{status.text}</span>
      </div>
      {darkFor > 0 && (
        <p className="mt-3 flex gap-2 text-sm text-orange-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Unreachable to the monitor for {Math.round(darkFor / 60)} min.{' '}
          {darkFor >= 3600 ? 'Deposits are paused; a full day while live defaults the bond.' : 'After an hour, deposits pause.'}
        </p>
      )}
      {dropped && (
        <p className="mt-3 flex gap-2 text-sm text-orange-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Attributed x402 revenue yesterday ({fmt(drop!.last24h, b.asset)}) was under a quarter of the 7-day average before it ({fmt(drop!.dailyAverage, b.asset)}) while monitoring reports compliant. Customers may be shown a different payTo; only guarded buyers verify it.
        </p>
      )}
      {b.checks.length > 0 && (
        <ul className="mt-4 space-y-1 font-mono text-xs text-foreground/60">
          {b.checks.slice(0, 6).map((c) => (
            <li key={c.txHash + c.at}>
              {date(c.at)} · {c.result === 1 ? 'compliant' : c.result === 2 ? 'violation' : 'unknown'} ·{' '}
              <a href={explorer('tx', c.txHash)} target="_blank" rel="noreferrer" className="hover:underline">
                {short(c.txHash)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Terms({ b }: { b: BondView }) {
  const rows: [string, string][] = [
    ['Raise', fmt(b.raise, b.asset)],
    ['Repayment cap', `${fmt(b.cap, b.asset)} (${b.multiple.toFixed(2)}×)`],
    ['Base revenue share', `${b.baseRevenueShare}% of each payment`],
    ...(b.triggerWindowDays > 0 ? [
      ['Revenue trigger', `Below ${fmt(b.triggerRevenue, b.asset)} over ${b.triggerWindowDays} complete UTC days`],
      ['Stepped-up share', `${b.stepUpShare}%`],
    ] satisfies [string, string][] : []),
    ['Released at activation', `${b.firstReleasePct}%`],
    ['Second release', `${b.milestoneMode === 'Onchain' ? 'On-chain' : 'Signed'} milestone: ${fmt(b.minRevenue, b.asset)} revenue`],
    ['Second release window', `${date(b.secondReleaseNotBefore)} → ${date(b.secondReleaseDeadline)}`],
    ['Funding deadline', date(b.fundingDeadline)],
    ['Maturity', date(b.maturity)],
    ['Issuer stake', b.stake ? fmt(b.stake, b.asset) : 'None'],
  ];
  return (
    <Panel title="Terms" aside={<span className="font-mono text-xs text-foreground/60">fixed at issuance</span>}>
      <dl className="divide-y divide-foreground/5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-6 py-2">
            <dt className="text-foreground/60">{k}</dt>
            <dd className="text-right font-mono text-xs tabular sm:text-sm">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function Back() {
  return (
    <Link href="/markets" className="inline-flex items-center gap-1.5 text-sm text-foreground/60 hover:text-foreground">
      <ArrowLeft className="size-4" /> Markets
    </Link>
  );
}

export function BondPage({ address }: { address: string }) {
  const { data, loading, error, configured } = useProtocol();
  if (!configured) return <Empty title="No indexer configured" />;
  if (loading) return <div className="h-96 animate-pulse rounded-xl border border-foreground/10" />;
  if (error) return <Empty title="Couldn't reach the indexer">{error.message}</Empty>;
  const b = data!.bonds.find((x) => x.address.toLowerCase() === address.toLowerCase());
  if (!b) return <Empty title="No bond at this address">It may not be indexed yet.</Empty>;
  const a = data!.accounts.find((x) => x.address === b.account);
  return (
    <div className="space-y-8">
      <Back />
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <TierBadge tier={b.tier} />
            <PhaseBadge phase={b.phase} defaulted={b.defaulted} />
            {b.triggered && b.phase === 'Active' && <Badge tone="warn">Triggered</Badge>}
            <Badge>repays in {b.asset.symbol}</Badge>
          </div>
          <h1 className="text-4xl font-semibold">{b.name}</h1>
          <p className="text-sm text-foreground/70">
            Share {b.baseRevenueShare}%
            {b.triggerWindowDays > 0 && <> · steps up to {b.stepUpShare}% if revenue &lt; {fmt(b.triggerRevenue, b.asset)} over {b.triggerWindowDays} days</>}
          </p>
          {b.triggerWindowDays > 0 && (
            <p className="text-xs text-foreground/60">
              Current share: {b.revenueShare}%. Checks start after {b.triggerWindowDays} complete UTC days
              following the activation day. The activation day and current day are excluded; issuer self-payments count.
            </p>
          )}
          <p className="font-mono text-xs text-foreground/60">
            {b.symbol} ·{' '}
            <a href={explorer('address', b.address)} target="_blank" rel="noreferrer" className="hover:underline">
              {short(b.address)} <ExternalLink className="inline size-3" />
            </a>{' '}
            · account <Link href={`/accounts/${b.account}`} className="hover:underline">{short(b.account)}</Link>
          </p>
        </div>
      </header>
      {b.flags.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl border border-orange-500/30 p-4 text-sm text-orange-500">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {b.flags.join(' · ')}
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Panel>
            <dl className="mb-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Figure label={b.phase === 'Funding' ? 'Raised' : 'Repaid'} value={fmt(b.phase === 'Funding' ? b.raised : b.collected, b.asset)} hint={`of ${fmt(b.phase === 'Funding' ? b.raise : b.effectiveCap, b.asset)}`} />
              <Figure label="Backing per claim" value={b.backingPerToken.toFixed(4)} hint="redeemable now" />
              <Figure label="Coverage" value={b.coverage === null ? '–' : `${b.coverage.toFixed(2)}×`} hint="projected repayment ÷ remaining cap" />
              <Figure label="Principal at risk" value={`${b.atRiskPct.toFixed(0)}%`} hint="released to the business" />
            </dl>
            <Ribbon b={b} />
          </Panel>
          <ImpliedYieldPanel b={b} account={a} />
          {a && <History a={a} />}
          <Health b={b} a={a} />
          <Terms b={b} />
          {a && <Payers a={a} />}
        </div>
        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          {b.kuru && (b.phase === 'Active' || b.phase === 'Closing') && (
            <Panel title="Trade on Kuru">
              <Trade b={b} />
            </Panel>
          )}
          <Panel title="Act">
            <BondActions b={b} onDone={() => undefined} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** What this history supports: the largest raise at standard terms, priced only on attributed revenue. */
function CreditLinePanel({ a }: { a: AccountView }) {
  const t = defaultCreditTerms;
  const c = creditLine({ revenuePerDay: a.verifiedDaily, ageDays: a.ageDays, uniquePayers: a.uniquePayers, topPayerShare: a.topPayerShare });
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <Panel title="Credit line">
      <p className="font-mono text-2xl tabular">[{fmt(c.maxRaise, a.asset)}]</p>
      <p className="mt-1 text-xs text-foreground/60">
        {c.eligible
          ? `largest raise this history supports at ${t.revenueBps / 100}% of revenue for ${t.termDays} days, ${t.capMultiple}× cap, ${t.targetCoverage}× coverage`
          : c.reason}
      </p>
      <dl className="mt-3 space-y-1 text-xs">
        {(
          [
            ['Attributed revenue', `${fmt(a.verifiedDaily, a.asset)}/day`],
            ['Expected to investors', fmt(c.expectedRepayment, a.asset)],
            ['Stress haircut', pct(c.factors.stress)],
            [`History weight (${a.ageDays.toFixed(1)} of ${t.fullHistoryDays} days)`, pct(c.factors.history)],
            [`Diversification (top payer ${pct(a.topPayerShare)})`, pct(c.factors.diversification)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4">
            <dt className="text-foreground/60">{k}</dt>
            <dd className="font-mono tabular">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function AccountPage({ address }: { address: string }) {
  const { data, loading, error, configured } = useProtocol();
  const a = data?.accounts.find((x) => x.address.toLowerCase() === address.toLowerCase());
  if (!a) return <div className="space-y-8"><Back /><h1 className="text-4xl font-semibold">Credit profile</h1>
    <RegistryCreditProfile account={address} />
    <Empty title={!configured ? 'No indexer configured' : loading ? 'Loading indexed estimates…' : error ? "Couldn't reach the indexer" : 'No indexed account yet'}>
      Registry reads are independent of the indexed estimates below.
    </Empty>
  </div>;
  const bonds = data!.bonds.filter((b) => b.account === a.address);
  return (
    <div className="space-y-8">
      <Back />
      <header className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {a.tier && <TierBadge tier={a.tier} />}
          {a.tier === 'Native' && <Badge tone={a.reviewed ? 'neutral' : 'warn'}>{a.reviewed ? 'Reviewed' : 'Awaiting review'}</Badge>}
          <Badge>earns in {a.asset.symbol}</Badge>
        </div>
        <h1 className="text-4xl font-semibold">Credit profile</h1>
        <p className="font-mono text-xs text-foreground/60">
          <a href={explorer('address', a.address)} target="_blank" rel="noreferrer" className="hover:underline">
            {a.address}
          </a>{' '}
          · issuer {short(a.issuer)}
        </p>
      </header>
      <RegistryCreditProfile account={a.address} />
      <h2 className="text-xl font-semibold">Indexer estimates · unsigned</h2>
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <History a={a} />
          <Payers a={a} />
        </div>
        <aside className="space-y-6">
          <CreditLinePanel a={a} />
          <Panel title="Bonds" aside={<span className="font-mono text-xs text-foreground/60">[{bonds.length}]</span>}>
            {bonds.length === 0 ? (
              <p className="text-sm text-foreground/60">No bonds yet. This account is building history.</p>
            ) : (
              <ul className="space-y-3">
                {bonds.map((b) => (
                  <li key={b.address}>
                    <Link href={`/bonds/${b.address}`} className="block rounded-lg border border-foreground/10 p-3 hover:border-foreground/25">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{b.symbol}</span>
                        <PhaseBadge phase={b.phase} defaulted={b.defaulted} />
                      </div>
                      <p className="mt-1 text-xs text-foreground/60">
                        {fmt(b.collected, b.asset)} repaid of {fmt(b.effectiveCap, b.asset)} · {b.multiple.toFixed(2)}×
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Collected for investors">
            <p className="font-mono text-2xl tabular">[{fmt(a.toInvestors, a.asset)}]</p>
            <p className="mt-1 text-xs text-foreground/60">across all bonds, split inside each payment</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
