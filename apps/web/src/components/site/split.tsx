'use client';
// The brand visual: payments arrive at a BondrailAccount and a slice peels off to investors.
import { useRef, type ReactNode, type RefObject } from 'react';
import { ArrowDownLeft, ArrowUpRight, Bot, Building2, Landmark } from 'lucide-react';
import { LogoMark } from '@/components/logo';
import { cn } from '@/lib/cn';
import { Beam } from './beam';

function Node({
  nodeRef,
  children,
  className,
}: {
  nodeRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      ref={nodeRef}
      className={cn(
        'relative z-10 flex items-center gap-1.5 rounded-lg border border-foreground/10 bg-background/80 px-2 py-1.5 text-xs backdrop-blur-sm sm:gap-2 sm:px-3 sm:py-2 sm:text-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Split() {
  const box = useRef<HTMLDivElement>(null);
  const buy = useRef<HTMLDivElement>(null);
  const sell = useRef<HTMLDivElement>(null);
  const agent = useRef<HTMLDivElement>(null);
  const account = useRef<HTMLDivElement>(null);
  const business = useRef<HTMLDivElement>(null);
  const bond = useRef<HTMLDivElement>(null);
  const bondrail = 'var(--color-emerald-500)';
  return (
    <figure className="w-full">
      <div ref={box} className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3 py-6 sm:gap-16">
        <div className="flex flex-col items-start gap-4">
          <Node nodeRef={buy}>
            <ArrowDownLeft className="size-3.5 text-foreground/60" /> Buy <span className="hidden font-mono text-foreground/60 sm:inline">[120]</span>
          </Node>
          <Node nodeRef={agent}>
            <Bot className="size-3.5 text-foreground/60" /> x402<span className="hidden sm:inline"> call</span> <span className="hidden font-mono text-foreground/60 sm:inline">[0.01]</span>
          </Node>
          <Node nodeRef={sell}>
            <ArrowUpRight className="size-3.5 text-foreground/60" /> Sell <span className="hidden font-mono text-foreground/60 sm:inline">[80]</span>
          </Node>
        </div>
        <Node nodeRef={account} className="flex-col gap-1 rounded-xl px-3 py-3 text-center sm:px-5 sm:py-4">
          <LogoMark className="size-7" />
          <span className="font-medium">Revenue account</span>
          <span className="hidden font-mono text-[11px] text-foreground/60 sm:block">history · split</span>
        </Node>
        <div className="flex flex-col items-end gap-10">
          <Node nodeRef={business}>
            <Building2 className="size-3.5 text-foreground/70" /> <span className="hidden sm:inline">Business</span> <span className="font-mono text-foreground/60">75%</span>
          </Node>
          <Node nodeRef={bond} className="border-emerald-500/30">
            <Landmark className="size-3.5 text-bondrail" /> <span className="hidden sm:inline">Investors</span> <span className="font-mono text-bondrail">25%</span>
          </Node>
        </div>
        <Beam container={box} from={buy} to={account} curvature={-20} delay={0} />
        <Beam container={box} from={agent} to={account} delay={0.9} />
        <Beam container={box} from={sell} to={account} curvature={20} delay={1.8} />
        <Beam container={box} from={account} to={business} curvature={-10} delay={0.6} />
        <Beam container={box} from={account} to={bond} curvature={10} delay={0.6} color={bondrail} width={3} />
      </div>
      <figcaption className="mx-auto max-w-xl text-center text-sm text-foreground/60">
        Revenue is recorded onchain. Native payments route the bond’s share in the same transaction;
        paid API receipts use a separate collection transaction.
      </figcaption>
    </figure>
  );
}
