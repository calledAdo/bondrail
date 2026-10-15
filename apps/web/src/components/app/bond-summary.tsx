'use client';
import { bondSummary, bondTimeline, phaseLabel } from '@/lib/bond-decision';
import { fmt, type AccountView, type BondView } from '@/lib/protocol';
import type { ReactNode } from 'react';
import { Badge, Panel } from './ui';
import { Term, TermsText } from './term';

export function BondSummary({ b, account, actions, now }: { b: BondView; account?: AccountView; actions: ReactNode; now: number }) {
  const review = account?.nativeReview;
  const tier = b.tier === 'Watched' ? 'Paid API · watched by Chainlink' : review === 'template' ? 'Native · reviewed template' : review === 'individual' ? 'Native · reviewed contract' : 'Native · review not verified';
  return <Panel className="min-h-[30rem] p-4 sm:min-h-[24rem] sm:p-6">
    <h1 className="text-2xl font-semibold leading-tight sm:text-4xl">{b.name}</h1>
    {account?.profile?.profile.description && <p className="mt-2 truncate text-sm text-foreground/70" title={account.profile.profile.description}>{account.profile.profile.description}</p>}
    <div className="my-3 flex flex-wrap gap-1.5">
      <Badge><TermsText>{phaseLabel(b, now)}</TermsText></Badge>
      <Badge>{b.tier === 'Watched' ? <Term term="watched">{tier}</Term> : <TermsText>{tier}</TermsText>}</Badge>
      <Badge>{b.asset.symbol}</Badge>
    </div>
    <p className="max-w-4xl text-sm leading-relaxed sm:text-base" data-testid="bond-sentence"><TermsText>{bondSummary(b)}</TermsText></p>
    <div className="my-4">{actions}</div>
    <dl className="grid grid-cols-1 gap-3 border-t border-foreground/10 pt-4 sm:grid-cols-3 sm:gap-6">
      <div><dt className="text-xs text-foreground/70">Repaid</dt><dd className="font-mono text-lg tabular">{fmt(b.collected, b.asset)} <span className="text-sm text-foreground/70">of {fmt(b.effectiveCap, b.asset)}</span></dd></div>
      <div><dt className="text-xs text-foreground/70">Each <Term term="claim">claim</Term> redeems for</dt><dd className="font-mono text-lg tabular">{fmt(b.backingPerToken, b.asset, 4)} <span className="text-sm text-foreground/70">now</span></dd></div>
      <div><dt className="text-xs text-foreground/70">Revenue per day</dt><dd className="font-mono text-lg tabular">{account ? fmt(account.verifiedDaily, b.asset) : 'Unavailable'}</dd><p className="text-xs text-foreground/70"><Term term="attributed">Attributed</Term> · trailing 7d</p></div>
    </dl>
    <p className="mt-3 text-xs text-foreground/70"><Term term="cap">The current repayment cap</Term> scales with capital released. “Repaid” means collected for holders, before they redeem.{b.phase === 'Funding' && ' Deposits are refundable before the deadline; repayment begins after activation.'}</p>
  </Panel>;
}
export function BondTimeline({ b, now }: { b: BondView; now: number }) {
  const steps = bondTimeline(b, now);
  return <Panel title="How this bond works" className="min-h-[30rem]">
    <ol className="grid gap-5 lg:grid-cols-6" aria-label="Bond lifecycle">
      {steps.map((s, i) => <li key={s.title} aria-current={s.state === 'current' ? 'step' : undefined}
        className="min-w-0 border-l border-foreground/20 pl-4 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-4">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm font-semibold"><span className="font-mono text-xs text-foreground/70">{i + 1}</span><TermsText>{s.title}</TermsText></div>
        <p className="mb-2 min-h-5 text-xs font-medium">{s.state === 'current' ? 'You are here' : s.state === 'complete' ? 'Complete' : s.state === 'skipped' ? 'Window ended' : 'Ahead / conditional'}</p>
        <p className="mb-2 text-xs text-foreground/70">{s.date}</p>
        <p className="text-sm leading-relaxed text-foreground/80"><TermsText>{s.text}</TermsText></p>
      </li>)}
    </ol>
  </Panel>;
}
