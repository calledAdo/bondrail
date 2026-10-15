'use client';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { glossary, glossaryAliases, type GlossaryKey } from '@/lib/glossary';

/** Nonmodal definition: pointer, focus and tap; Escape dismisses without moving the page. */
export function Term({ term, children }: { term: GlossaryKey; children?: ReactNode }) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 16 });
  const entry = glossary[term];
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event.type === 'scroll' && root.current?.contains(document.activeElement)) { show(); return; }
      if (event.type === 'pointerdown' && root.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', dismiss);
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('keydown', dismiss);
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [open]);
  function show() {
    clearTimeout(leaveTimer.current);
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(12, Math.min(rect.left, innerWidth - 308)), top: Math.max(12, Math.min(rect.bottom + 6, innerHeight - 210)) });
    setOpen(true);
  }
  return <span ref={root} className="inline" onMouseEnter={show}
    onMouseLeave={() => { leaveTimer.current = setTimeout(() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }, 180); }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}
    onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); trigger.current?.focus(); setOpen(false); } }}>
    <button ref={trigger} type="button" aria-describedby={id} aria-expanded={open} aria-controls={`${id}-popover`}
      onFocus={show} onClick={show}
      className="cursor-help rounded-sm underline decoration-foreground/40 decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
      {children ?? entry.aliases[0]}
    </button>
    <span id={id} hidden>{entry.definition}</span>
    {open && <span id={`${id}-popover`} role="dialog" aria-label={`${entry.aliases[0]} definition`}
      className="fixed z-[80] block w-[284px] max-w-[calc(100vw-24px)] rounded-lg border border-foreground/25 bg-background p-4 text-left font-sans text-sm font-normal leading-relaxed text-foreground shadow-lg"
      style={position}>
      {entry.definition}
      <span className="mt-2 flex items-center justify-between gap-3">
        <a href={entry.href} className="inline-flex min-h-11 items-center underline underline-offset-4">Learn more<span className="sr-only"> about {entry.aliases[0]}</span></a>
        <button type="button" className="min-h-11 px-2 underline underline-offset-4" onClick={() => { trigger.current?.focus(); setOpen(false); }}>Close</button>
      </span>
    </span>}
  </span>;
}
const pattern = new RegExp(`\\b(${glossaryAliases.map(x => x.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
/** Use on prose/metric labels, never inside another interactive element. */
export function TermsText({ children }: { children: string }) {
  return <>{children.split(pattern).map((text, i) => {
    const match = i % 2 ? glossaryAliases.find(x => x.alias.toLowerCase() === text.toLowerCase()) : undefined;
    return match ? <Term key={i} term={match.key}>{text}</Term> : text;
  })}</>;
}
