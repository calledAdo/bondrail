import { notFound } from 'next/navigation';
import { BondDetailView } from '@/components/app/details';
import { bondFixtures, fixtureAccount, FIXTURE_NOW, marketFixture, type FixturePhase } from '@/lib/bond-fixtures';
export const dynamic = 'force-dynamic';

/** Local visual acceptance only. The deployed app always responds with 404. */
export default async function FixturePage({ params }: { params: Promise<{ phase: string }> }) {
  if (process.env.NODE_ENV !== 'development' || process.env.BONDRAIL_UI_FIXTURES !== '1') notFound();
  const { phase } = await params;
  const bond = phase === 'Active-market' ? marketFixture : bondFixtures[phase as FixturePhase];
  if (!bond) notFound();
  return <><p className="mb-4 text-xs text-foreground/70">Synthetic review fixture · {phase} · 16 Oct 2026</p><BondDetailView b={bond} a={{ ...fixtureAccount, tier: bond.tier }} now={FIXTURE_NOW} /></>;
}
