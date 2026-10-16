'use client';
import { bondSummary, bondTimeline, phaseLabel } from '@/lib/bond-decision';
import { fmt, type AccountView, type BondView } from '@/lib/protocol';
import { useState, type ReactNode } from 'react';
import { Badge, Panel } from './ui';
import { Term, TermsText } from './term';

export function BondSummary({ b, account, actions, now }: { b: BondView; account?: AccountView; actions: ReactNode; now: number }) {
  const review = account?.nativeReview;
  const tier = b.tier === 'Watched' ? 'Paid API · watched by Chainlink' : review === 'template' ? 'Native · reviewed template' : review === 'individual' ? 'Native · reviewed contract' : 'Native · review not verified';
  return <Panel className="p-4 sm:p-6">
    <h1 className="text-2xl font-semibold leading-tight sm:text-4xl">{b.name}</h1>
    {account?.profile?.profile.description && <p className="mt-2 truncate text-sm text-foreground/70" title={account.profile.profile.description}><TermsText>{account.profile.profile.description}</TermsText></p>}
    <div className="my-3 flex flex-wrap gap-1.5">
      <Badge><TermsText>{phaseLabel(b, now)}</TermsText></Badge>
      <Badge>{b.tier === 'Watched' ? <Term term="watched">{tier}</Term> : <TermsText>{tier}</TermsText>}</Badge>
      <Badge>{b.asset.symbol}</Badge>
    </div>
    <p className="max-w-4xl text-sm leading-relaxed sm:text-base" data-testid="bond-sentence"><TermsText>{bondSummary(b)}</TermsText></p>
    <div className="my-4">{actions}</div>
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5.5rem),1fr))] gap-2 border-t border-foreground/10 pt-4 sm:grid-cols-3 sm:gap-6">
      <div><dt className="text-xs text-foreground/70">Repaid</dt><dd className="font-mono text-base tabular sm:text-lg">{fmt(b.collected, b.asset)} <span className="text-sm text-foreground/70">of {fmt(b.effectiveCap, b.asset)}</span></dd></div>
      <div><dt className="text-xs text-foreground/70">Each <Term term="claim">claim</Term> redeems for</dt><dd className="font-mono text-base tabular sm:text-lg">{fmt(b.backingPerToken, b.asset, 4)} <span className="text-sm text-foreground/70">now</span></dd></div>
      {account && <div><dt className="text-xs text-foreground/70">Revenue per day</dt><dd className="font-mono text-base tabular sm:text-lg">{fmt(account.verifiedDaily, b.asset)}</dd><p className="text-xs text-foreground/70"><Term term="attributed">Attributed</Term> · trailing 7d</p></div>}
    </dl>
    {!account && <p className="mt-3 text-sm">The revenue history could not be read, so the daily rate is omitted.</p>}
    <p className="mt-3 text-xs text-foreground/70"><Term term="cap">Current cap</Term> scales with released capital. “Repaid” is collected for holders before redemption.{b.phase === 'Funding' && ' Deposits are refundable before the deadline; repayment begins after activation.'}</p>
  </Panel>;
}
export function BondTimeline({ b, now }: { b: BondView; now: number }) {
  const steps = bondTimeline(b, now);
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  return <Panel compact title="How this bond works" className="p-4 sm:p-6">
    <ol className="grid gap-1 lg:grid-cols-6 lg:gap-5" aria-label="Bond lifecycle">
      {steps.map((s, i) => {
        const open = expanded[s.title] ?? s.state === 'current';
        const status = s.state === 'current' ? b.phase === 'Closing' ? 'You are here · settling' : 'You are here' : s.state === 'complete' ? 'Complete' : s.state === 'skipped' ? s.title === 'Maturity' ? 'Cap reached early' : 'Window ended' : 'Ahead / conditional';
        const title = <><span className="font-mono text-xs text-foreground/70">{i + 1}</span><TermsText>{s.title}</TermsText></>;
        return <li key={s.title} aria-current={s.state === 'current' ? 'step' : undefined} className={`${!showAll && s.state !== 'current' ? 'hidden lg:block' : ''} min-w-0 border-l border-foreground/20 pl-3 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-4`}>
          <div className="flex min-h-11 items-center gap-2 text-sm font-semibold lg:hidden">
            {title}<button type="button" aria-expanded={open} aria-controls={`lifecycle-${i}`} onClick={() => setExpanded(previous => ({ ...previous, [s.title]: !open }))} className="ml-auto flex min-h-11 min-w-11 items-center justify-end gap-2 text-xs font-normal" aria-label={`${open ? 'Collapse' : 'Expand'} ${s.title}`}>
              {s.state === 'current' ? 'You are here' : ''}<span aria-hidden="true">{open ? '−' : '+'}</span>
            </button>
          </div>
          <div className="mb-2 hidden flex-wrap items-center gap-2 text-sm font-semibold lg:flex">{title}</div>
          <div id={`lifecycle-${i}`} className={`${open ? 'block' : 'hidden'} pb-3 lg:block lg:pb-0`}>
            <p className="mb-2 hidden text-xs font-medium lg:block">{status}</p>
            <p className="mb-2 text-xs text-foreground/70">{s.date}</p>
            <p className="text-sm leading-relaxed text-foreground/80"><TermsText>{s.text}</TermsText></p>
          </div>
        </li>;
      })}
    </ol>
    <button type="button" onClick={() => setShowAll(!showAll)} aria-expanded={showAll} className="mt-1 min-h-11 text-sm underline underline-offset-4 lg:hidden">{showAll ? 'Show current step' : `Show all ${steps.length} steps`}</button>
  </Panel>;
}
