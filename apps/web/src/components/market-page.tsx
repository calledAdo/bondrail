'use client';
import { notFound } from 'next/navigation';
import { useMarkets } from '@/lib/live';
import { Details } from './details';

/** Resolves a market by id from live data (or the labelled fixtures) and renders its detail view. */
export function MarketPage({ id, issuer = false }: { id: string; issuer?: boolean }) {
  const { markets, loading, error } = useMarkets();
  if (loading) return <p role="status">Reading the chain and indexer…</p>;
  if (error) return <p className="notice danger">Live data unavailable: {error.message}</p>;
  const m = markets.find((x) => x.id === id);
  if (!m) notFound();
  return <Details market={m} issuer={issuer} />;
}
