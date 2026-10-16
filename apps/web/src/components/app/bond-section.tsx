'use client';
import { Component, type ReactNode } from 'react';
import { Panel } from './ui';
export const bondSections = [
  ['Bond summary', 'min-h-[30rem] sm:min-h-[24rem]'],
  ['How this bond works', 'min-h-[30rem]'],
  ['What you get', 'min-h-[26rem]'],
  ['Evidence', 'min-h-[38rem]'],
  ['How you could lose money', 'min-h-[22rem]'],
  ['What you can do now', 'min-h-40'],
] as const;
export function BondPlaceholders({ error, retry, omitSummary = false, evidence }: { error?: string; retry?: () => void; omitSummary?: boolean; evidence?: ReactNode }) {
  return <div className="space-y-6" aria-busy={!error}>
    {bondSections.filter(([title]) => !omitSummary || title !== 'Bond summary').map(([title, height]) => title === 'Evidence' && evidence ? <div key={title}>{evidence}</div> : <Panel key={title} title={title} className={height}>
      {error ? <div role="alert"><p className="text-sm">{error}</p><p className="mt-2 text-sm text-foreground/70">This section needs the bond’s verified terms and indexed history before it can show a decision.</p>{retry && <button type="button" onClick={retry} className="mt-3 min-h-11 underline">Retry data</button>}</div>
        : <div role="status" aria-label={`Loading ${title}`} className="space-y-4 motion-safe:animate-pulse"><div className="h-5 w-3/4 rounded bg-foreground/10" /><div className="h-5 w-full rounded bg-foreground/10" /><div className="h-5 w-2/3 rounded bg-foreground/10" /><div className="h-11 w-36 rounded bg-foreground/10" /></div>}
    </Panel>)}
    <div className="min-h-20 rounded-xl border border-foreground/10 p-6">Full terms &amp; technical details</div>
  </div>;
}
export class BondSection extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <Panel title={this.props.title}><p role="alert" className="text-sm">This section could not load. Other bond information is still available.</p><button type="button" className="min-h-11 underline" onClick={() => this.setState({ failed: false })}>Retry section</button></Panel> : this.props.children;
  }
}
