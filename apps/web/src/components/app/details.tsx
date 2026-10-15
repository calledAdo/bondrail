'use client';
// Bond decisions in reading order; the account page retains its full credit history.
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
import { BondSummary, BondTimeline } from './bond-summary';
import { DecisionLinks, DecisionPanel, type BondIntent } from './bond-decisions';
import { BondPlaceholders, BondSection } from './bond-section';
import { bondRisks, bondDate } from '@/lib/bond-decision';
import { Term, TermsText } from './term';
import { ImpliedYieldPanel, WhatYouGet } from './implied-yield';
import { nativeReviewLabel } from '@/lib/native-review';
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
  const [showAll, setShowAll] = useState(false);
  const [screening, setScreening] = useState(false);
  async function screen() {
    setScreening(true);
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
    } finally { setScreening(false); }
  }
  const excluded = a.payers.filter((p) => p.related).length;
  return (
    <Panel title="Payers" aside={<Badge>{excluded} of {a.payers.length} excluded</Badge>}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={screen} disabled={!a.payers.length || screening} className="min-h-11 rounded-lg border border-foreground/15 px-3 text-sm hover:bg-foreground/5 disabled:opacity-40">
          Screen top payers with Nansen
        </button>
        <span className="text-xs text-foreground/70">{note || 'Labels from Monad mainnet (Nansen does not cover testnet).'}</span>
      </div>
      {a.payers.length === 0 ? (
        <p className="text-sm text-foreground/70">No payments indexed yet. Payers appear here when customers pay the business.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-foreground/70">
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
              {a.payers.slice(0, showAll ? a.payers.length : 5).map((p) => (
                <tr key={p.payer}>
                  <td className="py-2 font-mono text-xs">
                    <a href={explorer('address', p.payer)} target="_blank" rel="noreferrer" className="hover:underline">
                      {short(p.payer)}
                    </a>
                  </td>
                  <td className="py-2 text-foreground/70">{p.source === 'x402' ? <><Term term="x402">x402</Term> (signed)</> : p.source === 'native' ? 'Pulled fee' : 'Plain transfer'}</td>
                  <td className="py-2 text-right font-mono tabular">{p.payments}</td>
                  <td className="py-2 text-right font-mono tabular">{fmt(p.amount, a.asset)}</td>
                  <td className="py-2 pl-4">
                    {p.related ? <Badge tone="warn" className="text-foreground">{p.reasons.map((r) => REASONS[r] ?? r).join(', ') || 'Excluded'}</Badge> : <span className="text-foreground/70">No link found</span>}
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
      {a.payers.length > 5 && <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className="mt-3 min-h-11 text-sm underline underline-offset-4">{showAll ? 'Show top 5' : `Show all ${a.payers.length} payers`}</button>}
    </Panel>
  );
}

function History({ a }: { a: AccountView }) {
  const feeRate = a.volume ? (a.revenue / a.volume) * 100 : null;
  return (
    <Panel title="Revenue history" aside={<span className="font-mono text-xs text-foreground/70">since {a.firstRevenueAt ? date(a.firstRevenueAt).slice(0, 10) : '–'}</span>}>
      <dl className="mb-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
        <Figure label={<TermsText>Attributed revenue</TermsText>} value={fmt(a.verified, a.asset)} hint={`raw ${fmt(a.revenue, a.asset)}`} />
        <Figure label={<TermsText>Attributed per day</TermsText>} value={fmt(a.verifiedDaily, a.asset)} hint="trailing 7 days" />
        <Figure label={<TermsText>Attributed payers</TermsText>} value={a.uniquePayers} hint={a.topPayerShare ? `top payer ${(a.topPayerShare * 100).toFixed(0)}%` : undefined} />
        <Figure label={feeRate !== null ? 'Fee rate' : 'History'} value={feeRate !== null ? `${feeRate.toFixed(2)}%` : days(a.ageDays)} hint={feeRate !== null ? `on ${fmt(a.volume!, a.asset)} volume` : 'account age'} />
      </dl>
      <p className="mb-4 text-sm text-foreground/70"><Term term="attributed">Attributed revenue</Term> excludes detected related payers and unclassified transfers; raw revenue includes them. No detected link does not prove that a payer is independent.</p>
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
  if (b.tier === 'Native') return <Panel title="Source">
    <p className="text-sm leading-relaxed text-foreground/80"><TermsText>{a?.nativeReview === 'template'
      ? 'Native · reviewed template: the factory deployed approved creation code, with no separate individual review. Review covers the fee-routing code path through this account; it does not guarantee future revenue.'
      : a?.nativeReview === 'individual' ? 'Native · reviewed contract: the disclosed reviewer approved this project individually. Review covers the fee-routing code path through this account; it does not guarantee future revenue.'
      : 'Native approval could not be verified as current. New deposits and releases require approval; existing repayment continues.'}</TermsText></p>
  </Panel>;
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
    <Panel title="Source" aside={<Badge><Term term="watched">Paid API · watched by Chainlink</Term></Badge>}>
      <p className="text-sm leading-relaxed text-foreground/80"><TermsText>Chainlink CRE checks the published manifest (the API’s account and endpoint list) and payment offers against the committed policy about every 30 minutes. Checks can miss diverted payments between observations and do not guarantee future revenue.</TermsText></p>
      <p className="mt-3 text-sm text-foreground/70">Last observation: {last ? `${bondDate(last.at)} · ${last.result === 1 ? 'compliant' : last.result === 2 ? 'violation' : 'unknown'}` : 'none yet — payment routing has not been observed.'}</p>
      <div className="mt-4 flex items-start gap-2 text-sm">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', status.dot)} />
        <span><TermsText>{status.text}</TermsText></span>
      </div>
      {darkFor > 0 && (
        <p className="mt-3 flex gap-2 text-sm text-foreground/80">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Unreachable to the monitor for {Math.round(darkFor / 60)} min.{' '}
          {darkFor >= 3600 ? 'Deposits are paused; a full day while live defaults the bond.' : 'After an hour, deposits pause.'}
        </p>
      )}
      {dropped && (
        <p className="mt-3 flex gap-2 text-sm text-foreground/80">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> Attributed x402 revenue yesterday ({fmt(drop!.last24h, b.asset)}) was under a quarter of the 7-day average before it ({fmt(drop!.dailyAverage, b.asset)}) while monitoring reports compliant. Customers may be shown a different payTo; only guarded buyers verify it.
        </p>
      )}
    </Panel>
  );
}

function Terms({ b }: { b: BondView }) {
  const rows: [string, string][] = [
    ['Claim symbol', b.symbol],
    ['Contract phase', b.phase],
    ['Raise', fmt(b.raise, b.asset)],
    ['Repayment cap', `${fmt(b.cap, b.asset)} (${b.multiple.toFixed(2)}×)`],
    ['Base revenue share', `${b.baseRevenueShare}% of booked revenue`],
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
    ['Current revenue share', `${b.revenueShare}%`],
    ['Minimum operating period', b.minOperatingPeriod === undefined ? 'Unavailable' : `${b.minOperatingPeriod / 86400} days`],
    ['Fee floor', `${(b.minFeeBps / 100).toFixed(2)}% of each payment while active`],
  ];
  return (
    <Panel title="Terms" aside={<span className="font-mono text-xs text-foreground/70">fixed at issuance</span>}>
      <dl className="divide-y divide-foreground/5 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-6">
            <dt className="text-foreground/70"><TermsText>{k}</TermsText></dt>
            <dd className="min-w-0 break-words font-mono text-xs tabular sm:text-right sm:text-sm"><TermsText>{v}</TermsText></dd>
          </div>
        ))}
      </dl>
      {b.triggerWindowDays > 0 && <p className="mt-4 text-xs text-foreground/70"><TermsText>{`Trigger checks start after ${b.triggerWindowDays} complete UTC days following activation. The activation day and current day are excluded; issuer self-payments count. Payments use the last checked share until another check.`}</TermsText></p>}
    </Panel>
  );
}

function Back() {
  return (
    <Link href="/markets" className="inline-flex items-center gap-1.5 text-sm text-foreground/70 hover:text-foreground">
      <ArrowLeft className="size-4" /> Markets
    </Link>
  );
}

export function BondPage({ address }: { address: string }) {
  const { data, loading, error, configured, refetch } = useProtocol();
  const b = data?.bonds.find(x => x.address.toLowerCase() === address.toLowerCase());
  if (!b) return <div className="space-y-6"><Back /><BondPlaceholders
    error={!configured ? 'No indexer configured.' : loading ? undefined : error ? 'The bond data could not be reached.' : 'No bond is indexed at this address yet.'}
    retry={() => void refetch()} /></div>;
  const a = data?.accounts.find(x => x.address.toLowerCase() === b.account.toLowerCase());
  return <BondDetailView key={b.address} b={b} a={a} refreshError={!!error} />;
}

/** Shared by the live route and development-only deterministic review fixtures. */
export function BondDetailView({ b, a, now = Date.now() / 1000, refreshError = false }: { b: BondView; a?: AccountView; now?: number; refreshError?: boolean }) {
  const [intent, setIntent] = useState<BondIntent | null>(null);
  function select(value: BondIntent) {
    setIntent(value);
    requestAnimationFrame(() => document.getElementById('bond-actions')?.scrollIntoView({ block: 'start' }));
  }
  return <div className="space-y-6" data-testid="bond-page">
    <Back />
    {refreshError && <p role="alert" className="text-sm">Refresh failed. Showing the last successful bond snapshot; reload before making a decision.</p>}
    <BondSection title="Bond summary"><BondSummary b={b} account={a} now={now} actions={<DecisionLinks b={b} now={now} onSelect={select} />} /></BondSection>
    <BondSection title="How this bond works"><BondTimeline b={b} now={now} /></BondSection>
    <BondSection title="What you get"><WhatYouGet b={b} account={a} now={now} /></BondSection>
    <section aria-labelledby="bond-evidence" className="space-y-4">
      <h2 id="bond-evidence" className="text-xl font-semibold">Evidence</h2>
      <BondSection title="Revenue history">{a ? <History a={a} /> : <Panel title="Revenue history" className="min-h-80"><p>Revenue history is unavailable. It shows how much the business has earned from counted payers.</p></Panel>}</BondSection>
      <BondSection title="Payers">{a ? <Payers a={a} /> : <Panel title="Payers"><p>Payer data is unavailable. This table helps you see whether revenue comes from a few addresses.</p></Panel>}</BondSection>
      <BondSection title="Source"><Health b={b} a={a} /></BondSection>
      <BondSection title="Credit profile"><RegistryCreditProfile account={b.account} compact estimate={a} /></BondSection>
    </section>
    <BondSection title="How you could lose money"><Panel title="How you could lose money" className="min-h-[22rem]">
      <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed">{bondRisks(b, now).map(risk => <li key={risk}><TermsText>{risk}</TermsText></li>)}</ul>
    </Panel></BondSection>
    <BondSection title="What you can do now"><DecisionPanel b={b} account={a} now={now} intent={intent} onSelect={select} /></BondSection>
    <BondSection title="Maintenance"><BondActions b={b} account={a} mode="maintenance" onDone={() => undefined} /></BondSection>
    <BondSection title="Full terms & technical details"><details className="rounded-xl border border-foreground/10 p-4 sm:p-6">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">Full terms &amp; technical details</summary>
      <div className="mt-5 space-y-6">
        <Terms b={b} />
        <Panel title="Investor metrics">
          <dl className="grid gap-5 sm:grid-cols-3">
            <Figure label={<Term term="coverage">Coverage</Term>} value={b.coverage === null ? 'Unavailable' : `${b.coverage.toFixed(2)}×`} hint="projected repayment ÷ remaining cap" />
            <Figure label="Principal at risk" value={`${b.atRiskPct.toFixed(0)}%`} hint={b.phase === 'Funding' ? 'initial release if activated' : 'released to the business'} />
            <Figure label={<Term term="backing">Backing per claim</Term>} value={fmt(b.backingPerToken, b.asset, 4)} hint="current repayment pool ÷ supply" />
          </dl>
          <div className="mt-5"><Ribbon b={b} /></div>
          {b.flags.length > 0 && <p className="mt-4 text-sm"><TermsText>{b.flags.join(' · ')}</TermsText></p>}
        </Panel>
        <ImpliedYieldPanel b={b} account={a} />
        <Panel title="Addresses & policy">
          <dl className="space-y-3 text-sm">{[
            ['Bond / claim', b.address], ['Business account', b.account], ['Issuer', a?.issuer], ['Asset', b.asset.address],
            ['Project', a?.project], ['Source', b.source], ['Kuru market', b.kuru?.market], ['Kuru vault', b.kuru?.vault],
          ].map(([label, address]) => <div key={label}><dt className="text-foreground/70"><TermsText>{label!}</TermsText></dt><dd className="break-all font-mono text-xs">{address ? <a href={explorer('address', address)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center underline underline-offset-4">{address}</a> : 'Unavailable / not configured'}</dd></div>)}
            <div><dt className="text-foreground/70">Policy hash</dt><dd className="break-all font-mono text-xs">{b.policyHash ?? 'Unavailable'}</dd></div>
          </dl>
        </Panel>
        <Panel title={<><Term term="covenant">Covenant</Term> checks</>}>
          {b.tier === 'Watched' && <p className="mb-4 text-sm text-foreground/70"><TermsText>Two qualifying violations in adjacent 30-second report epochs can record default. Qualifying Unknown reports pause deposits after one hour and can default an active bond after 24 hours; a monitor outage alone does not. Closing allows 120 seconds for late evidence, then anyone must finalize settlement.</TermsText></p>}
          {b.checks.length ? <ul className="space-y-3 text-sm">{b.checks.map(c => <li key={c.txHash + c.at}>{bondDate(c.at)} · {c.result === 1 ? 'compliant' : c.result === 2 ? 'violation' : 'unknown'} · <a href={explorer('tx', c.txHash)} target="_blank" rel="noreferrer" className="font-mono underline">{short(c.txHash)}</a></li>)}</ul> : <p className="text-sm">{b.tier === 'Native' ? 'Native bonds use reviewed contract routing rather than API observations.' : 'No observations yet. Checks provide evidence of payment routing at the time observed.'}</p>}
        </Panel>
      </div>
    </details></BondSection>
  </div>;
}

/** What this history supports: the largest raise at standard terms, priced only on attributed revenue. */
function CreditLinePanel({ a }: { a: AccountView }) {
  const t = defaultCreditTerms;
  const c = creditLine({ revenuePerDay: a.verifiedDaily, ageDays: a.ageDays, uniquePayers: a.uniquePayers, topPayerShare: a.topPayerShare });
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return (
    <Panel title="Credit line">
      <p className="font-mono text-2xl tabular">[{fmt(c.maxRaise, a.asset)}]</p>
      <p className="mt-1 text-xs text-foreground/70">
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
            <dt className="text-foreground/70"><TermsText>{k}</TermsText></dt>
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
          {a.tier === 'Native' && <Badge tone={a.reviewed ? 'neutral' : 'warn'}>{nativeReviewLabel[a.nativeReview]}</Badge>}
          <Badge>earns in {a.asset.symbol}</Badge>
        </div>
        <h1 className="text-4xl font-semibold">Credit profile</h1>
        <p className="break-all font-mono text-xs text-foreground/70">
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
          <Panel title="Bonds" aside={<span className="font-mono text-xs text-foreground/70">[{bonds.length}]</span>}>
            {bonds.length === 0 ? (
              <p className="text-sm text-foreground/70">No bonds yet. This account is building history.</p>
            ) : (
              <ul className="space-y-3">
                {bonds.map((b) => (
                  <li key={b.address}>
                    <Link href={`/bonds/${b.address}`} className="block rounded-lg border border-foreground/10 p-3 hover:border-foreground/25">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{b.symbol}</span>
                        <PhaseBadge phase={b.phase} defaulted={b.defaulted} />
                      </div>
                      <p className="mt-1 text-xs text-foreground/70">
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
            <p className="mt-1 text-xs text-foreground/70">Revenue sent to bond pools across all bonds. Native fees and Bondrail-facilitated account settlements split immediately; plain transfers split when swept. This is not the amount redeemed by holders.</p>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
