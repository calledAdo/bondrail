// Small shared pieces for the app pages (DESIGN.md: hairlines, alpha steps, mono figures, few colours).
import type { ReactNode } from 'react';
import { Radio, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { BondView, Phase, Tier } from '@/lib/protocol';

export function Panel({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-foreground/10 p-6', className)}>
      {(title || aside) && (
        <div className="mb-5 flex items-center justify-between gap-4">
          {title && <h2 className="text-lg font-semibold">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'slice' | 'warn' | 'danger'; className?: string }) {
  const tones = {
    neutral: 'border-foreground/15 text-foreground/70',
    slice: 'border-emerald-500/30 text-emerald-500',
    warn: 'border-orange-500/30 text-orange-500',
    danger: 'border-red-500/30 text-red-500',
  };
  return <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <Badge>
      {tier === 'Native' ? <ShieldCheck className="size-3" /> : <Radio className="size-3" />} {tier}
    </Badge>
  );
}

export function PhaseBadge({ phase, defaulted }: { phase: Phase; defaulted?: boolean }) {
  if (defaulted) return <Badge tone="danger">Defaulted</Badge>;
  return <Badge tone={phase === 'Closed' ? 'slice' : 'neutral'}>{phase === 'Active' ? 'Live' : phase}</Badge>;
}

/** A labelled figure: mono, bracketed for live on-chain numbers. */
export function Figure({ label, value, hint, bracket = true }: { label: string; value: ReactNode; hint?: string; bracket?: boolean }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-foreground/60">{label}</dt>
      <dd className="font-mono text-lg tabular">{bracket ? <>[{value}]</> : value}</dd>
      {hint && <p className="text-xs text-foreground/60">{hint}</p>}
    </div>
  );
}

/** The capital ribbon: released to the business, still in the bond, returned to investors. */
export function Ribbon({ b, compact }: { b: BondView; compact?: boolean }) {
  const total = Math.max(b.raise, 1e-9);
  const parts =
    b.phase === 'Funding'
      ? [
          { label: 'Funded', value: b.raised, cls: 'bg-foreground/70' },
          { label: 'To raise', value: Math.max(0, b.raise - b.raised), cls: 'bg-foreground/10' },
        ]
      : [
          { label: 'Released to business', value: b.released, cls: 'bg-foreground/70' },
          { label: 'Held in bond', value: b.undrawn, cls: 'bg-foreground/25' },
          { label: 'Returned to investors', value: Math.min(b.recovery, total), cls: 'bg-emerald-500' },
        ];
  return (
    <div className="space-y-2">
      <div className="flex h-2 overflow-hidden rounded-full bg-foreground/5" role="img" aria-label={parts.map((p) => `${p.label} ${p.value.toFixed(2)}`).join(', ')}>
        {parts.map((p) => (
          <span key={p.label} className={p.cls} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/60">
          {parts.map((p) => (
            <span key={p.label} className="inline-flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', p.cls)} /> {p.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Daily revenue, raw (outline) vs verified (filled), with a text summary for screen readers. */
export function RevenueBars({ daily, label }: { daily: { day: number; raw: number; verified: number }[]; label: string }) {
  if (!daily.length) return <p className="text-sm text-foreground/60">No revenue indexed yet.</p>;
  // A fixed 30-day axis ending today, so a young account shows thin bars, not one wide block.
  const today = Math.floor(Date.now() / 86_400_000);
  const byDay = new Map(daily.map((d) => [d.day, d]));
  const rows = Array.from({ length: 30 }, (_, i) => byDay.get(today - 29 + i) ?? { day: today - 29 + i, raw: 0, verified: 0 });
  const peak = Math.max(1e-9, ...rows.map((d) => d.raw));
  return (
    <figure>
      <div className="flex h-36 items-end gap-1" aria-hidden>
        {rows.map((d) => (
          <div key={d.day} className="relative flex-1" style={{ height: `${(d.raw / peak) * 100}%` }} title={`${new Date(d.day * 86_400_000).toISOString().slice(0, 10)}: raw ${d.raw}, verified ${d.verified}`}>
            <div className="absolute inset-0 rounded-sm border border-foreground/20" />
            <div className="absolute inset-x-0 bottom-0 rounded-sm bg-foreground/70" style={{ height: `${d.raw ? (d.verified / d.raw) * 100 : 0}%` }} />
          </div>
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-foreground/60">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-foreground/70" /> Attributed</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm border border-foreground/30" /> Raw</span>
        <span className="sr-only">{label}</span>
      </figcaption>
    </figure>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-foreground/15 p-10 text-center">
      <h2 className="font-semibold">{title}</h2>
      {children && <div className="mt-2 text-sm text-foreground/60">{children}</div>}
    </div>
  );
}
