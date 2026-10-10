'use client';
import Link from 'next/link';
import { motion } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { ArrowRight, Minus, Plus, Radio, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Ticker } from './ticker';
import { useLiveStats } from './live';

const EXPLORER = 'https://testnet.monadexplorer.com';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** Reveal once on scroll (DESIGN.md motion: y 24 → 0, 0.5 s). */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export function SectionHead({ index, eyebrow, title, lead }: { index: string; eyebrow: string; title: ReactNode; lead?: string }) {
  return (
    <div className="mb-16 max-w-2xl space-y-4">
      <p className="font-mono text-xs text-foreground/60">
        ({index}) {eyebrow}
      </p>
      <h2 className="text-4xl font-semibold sm:text-5xl">{title}</h2>
      {lead && <p className="text-lg text-foreground/60">{lead}</p>}
    </div>
  );
}

/** Primary CTA with the label roll (Kokonut DS) and arrow nudge. */
export function CTA({ href, children, outline }: { href: string; children: string; outline?: boolean }) {
  return (
    <Link
      href={href}
      className={cn(
        'group inline-flex h-11 items-center gap-2 overflow-hidden rounded-lg px-5 text-sm font-medium transition-colors duration-300',
        outline
          ? 'border border-foreground/20 text-foreground hover:bg-foreground/5'
          : 'bg-primary text-primary-foreground hover:bg-primary/90',
      )}
    >
      <span className="relative block h-5 overflow-hidden">
        <span className="block transition-transform duration-300 ease-in-out group-hover:-translate-y-full">{children}</span>
        <span className="absolute inset-0 block translate-y-full transition-transform duration-300 ease-in-out group-hover:translate-y-0">
          {children}
        </span>
      </span>
      <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
    </Link>
  );
}

export function LiveStrip() {
  const { stats, error, configured } = useLiveStats();
  const items: [string, number | undefined, number, string][] = [
    ['Revenue routed', stats?.revenue, 2, '$'],
    ['Payments booked', stats?.payments, 0, ''],
    ['Paid to investors', stats?.toInvestors, 2, '$'],
    ['Live bonds', stats?.activeBonds, 0, ''],
  ];
  return (
    <section aria-label="Live protocol numbers" className="border-y border-foreground/10">
      <div className="mx-auto grid max-w-6xl grid-cols-2 divide-foreground/10 px-6 sm:grid-cols-4 sm:divide-x">
        {items.map(([label, v, d, prefix]) => (
          <div key={label} className="space-y-1 py-8 sm:px-6 first:sm:pl-0">
            <p className="font-mono text-3xl font-medium sm:text-4xl">
              [{v === undefined ? '–' : <Ticker value={v} decimals={d} prefix={prefix} />}]
            </p>
            <p className="text-sm text-foreground/60">{label}</p>
          </div>
        ))}
      </div>
      <p className="mx-auto max-w-6xl px-6 pb-4 font-mono text-[11px] text-foreground/60">
        {!configured
          ? 'Indexer not configured: numbers appear on the deployed site.'
          : error
            ? 'Indexer unreachable right now.'
            : 'Live from Monad testnet via Envio. Demo businesses and their traffic are run by the Slice team.'}
      </p>
    </section>
  );
}

export function PaymentMarquee() {
  const { stats } = useLiveStats();
  const rows = stats?.recent ?? [];
  if (rows.length === 0) return null;
  const label = (s: string) => (s === 'x402' ? 'x402 call' : s === 'native' ? 'fee' : 'transfer');
  const item = (p: (typeof rows)[number], k: string) => (
    <a
      key={k}
      href={`${EXPLORER}/tx/${p.txHash}`}
      className="flex shrink-0 items-center gap-2 rounded-full border border-foreground/10 px-3 py-1.5 font-mono text-xs text-foreground/70 transition-colors hover:border-foreground/20 hover:text-foreground"
    >
      <span className="size-1.5 rounded-full bg-foreground/40" />
      {short(p.payer)} · {label(p.source)} · ${p.amount.toFixed(p.amount < 1 ? 4 : 2)}
    </a>
  );
  return (
    <div className="relative flex overflow-hidden py-6 [--duration:60s] [--gap:0.75rem] [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      {[0, 1].map((copy) => (
        <div key={copy} className="flex shrink-0 animate-marquee gap-3 pr-3" aria-hidden={copy === 1}>
          {rows.map((p, i) => item(p, `${copy}-${i}`))}
        </div>
      ))}
    </div>
  );
}

const STEPS = [
  ['Open an account', 'Create a SliceAccount in the token you earn. It is your revenue address from day one.'],
  ['Build history', 'Every payment is booked on-chain with its payer: revenue, volume, fee rate, payers, age.'],
  ['Raise', 'Issue a bond against that history. Investors fund it; 25% or 50% is released, the rest at a milestone.'],
  ['Repay automatically', 'A fixed share of every payment goes to the bond until the cap. Then back to 100% yours.'],
];

export function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-6 py-32">
      <SectionHead index="01" eyebrow="How it works" title="Credit that builds itself." lead="No pitch deck. The record investors underwrite is the one your payments already wrote." />
      <ol className="grid gap-px overflow-hidden rounded-xl border border-foreground/10 bg-foreground/10 sm:grid-cols-4">
        {STEPS.map(([title, body], i) => (
          <Reveal key={title} delay={i * 0.15} className="bg-background">
            <li className="h-full space-y-3 p-6">
              <p className="font-mono text-xs text-foreground/60">({String(i + 1).padStart(2, '0')})</p>
              <h3 className="text-xl font-semibold">{title}</h3>
              <p className="text-sm text-foreground/60">{body}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </section>
  );
}

export function Tiers() {
  const card = (props: {
    icon: ReactNode;
    tone: string;
    tier: string;
    title: string;
    body: string;
    facts: string[];
    href: string;
  }) => (
    <div className="group relative flex flex-col gap-6 rounded-2xl border border-dashed border-foreground/15 p-8 transition-colors duration-300 hover:border-foreground/30">
      <div className="flex items-center justify-between">
        <span className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium', props.tone)}>
          {props.icon} {props.tier}
        </span>
      </div>
      <h3 className="text-2xl font-semibold">{props.title}</h3>
      <p className="text-foreground/60">{props.body}</p>
      <ul className="mt-auto space-y-2 font-mono text-xs text-foreground/70">
        {props.facts.map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
      <Link href={props.href} className="inline-flex items-center gap-1 text-sm text-foreground/70 transition-colors hover:text-foreground">
        Read the guide <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-1" />
      </Link>
    </div>
  );
  return (
    <section id="tiers" className="mx-auto max-w-6xl px-6 py-32">
      <SectionHead index="02" eyebrow="Two tiers" title={<>Impossible to divert, <span className="text-foreground/40">or expensive to.</span></>} />
      <div className="grid gap-4 md:grid-cols-2">
        <Reveal>
          {card({
            icon: <ShieldCheck className="size-3.5" />,
            tone: 'border-foreground/15 text-foreground/80',
            tier: 'Native',
            title: 'Built on Slice',
            body: 'Your contract inherits SliceEarner. Every fee moves through your account, which is fixed into the code. There is no other path.',
            facts: ['collect() for money in, settleOut() for money out', 'payer proven by the transfer itself', 'optional fee floor while a bond is live'],
            href: '/docs/guides/native',
          })}
        </Reveal>
        <Reveal delay={0.15}>
          {card({
            icon: <Radio className="size-3.5" />,
            tone: 'border-foreground/15 text-foreground/80',
            tier: 'Watched',
            title: 'Paid APIs over x402',
            body: 'Your API pays its account. Chainlink CRE checks every paid endpoint every 30 seconds; diverting payments defaults the bond and slashes your stake.',
            facts: ['/.well-known/slice.json manifest', 'every payment option must pay the account', 'guarded buyers verify payTo before paying'],
            href: '/docs/guides/x402',
          })}
        </Reveal>
      </div>
    </section>
  );
}

export function Audiences() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-32">
      <div className="grid gap-4 md:grid-cols-2">
        <Reveal className="grain overflow-hidden rounded-2xl bg-ink p-10 text-white">
          <p className="font-mono text-xs text-white/60">(03) For builders</p>
          <h3 className="mt-4 text-3xl font-semibold">Start the record today.</h3>
          <p className="mt-3 text-white/60">Route revenue through an account in an afternoon. Raise when the history speaks for itself.</p>
          <div className="mt-8">
            <Link href="/docs/guides/quickstart" className="group inline-flex h-11 items-center gap-2 rounded-lg bg-white px-5 text-sm font-medium text-black">
              Quickstart <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </Reveal>
        <Reveal delay={0.15} className="rounded-2xl border border-foreground/10 p-10">
          <p className="font-mono text-xs text-foreground/60">(04) For investors</p>
          <h3 className="mt-4 text-3xl font-semibold">Underwrite evidence, not promises.</h3>
          <p className="mt-3 text-foreground/60">Verified revenue, payer concentration and coverage for every bond. Redeem at any time or trade on Kuru.</p>
          <div className="mt-8">
            <CTA href="/markets" outline>
              Browse markets
            </CTA>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const FAQ: [string, string][] = [
  ['Who can stop the split?', 'Nobody. It happens inside each payment. The Native reviewer can revoke approval, which blocks new deposits and releases, but not repayment of a live bond.'],
  ['What do I rely on?', 'A disclosed Native reviewer (code approval), a milestone signer (only for bonds that choose signed milestones) and an observer whose reports arrive through Chainlink CRE. Everything else is enforced by contracts.'],
  ['What if the business stops?', 'Revenue stops too. Investors keep the pool collected so far, any capital not yet released, and for Watched bonds the slashed stake. Coverage and the Kuru price show that risk up front.'],
  ['Can revenue be faked?', 'Self-payments still pay investors their share once a bond is live. The indexer flags payers funded by the issuer and transfers that are not real payments; only verified revenue scores.'],
  ['Is this live?', 'On Monad testnet, with team-run demo businesses. All demo activity is labelled.'],
];

export function TrustFAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="trust" className="mx-auto grid max-w-6xl gap-12 px-6 py-32 md:grid-cols-[1fr_1.4fr]">
      <SectionHead index="05" eyebrow="Trust" title="Every assumption, disclosed." lead="Read the full trust model in the docs." />
      <div className="divide-y divide-foreground/10 border-y border-foreground/10">
        {FAQ.map(([q, a], i) => (
          <div key={q}>
            <button
              type="button"
              aria-expanded={open === i}
              onClick={() => setOpen(open === i ? null : i)}
              className="flex w-full items-center gap-4 py-5 text-left"
            >
              <span className="font-mono text-xs text-foreground/60">({String(i + 1).padStart(2, '0')})</span>
              <span className="flex-1 font-medium">{q}</span>
              {open === i ? <Minus className="size-4 text-foreground/60" /> : <Plus className="size-4 text-foreground/60" />}
            </button>
            <motion.div
              initial={false}
              animate={{ height: open === i ? 'auto' : 0, opacity: open === i ? 1 : 0 }}
              transition={{ duration: 0.3 }}
              className="overflow-hidden"
            >
              <p className="pb-5 pl-10 text-foreground/60">{a}</p>
            </motion.div>
          </div>
        ))}
      </div>
    </section>
  );
}

const STACK = ['Monad', 'Chainlink CRE', 'Envio HyperIndex', 'Kuru', 'x402', 'Nansen', 'ERC-8004'];

export function Stack() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <p className="mb-6 text-center text-xs font-medium uppercase tracking-wider text-foreground/60">Built with</p>
      <div className="flex flex-wrap justify-center gap-x-10 gap-y-4 text-lg font-semibold text-foreground/40">
        {STACK.map((s) => (
          <span key={s} className="transition-colors duration-300 hover:text-foreground">
            {s}
          </span>
        ))}
      </div>
    </section>
  );
}
