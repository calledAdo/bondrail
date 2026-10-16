'use client';
// Live protocol numbers for the landing page, read from the public Envio indexer (no wallet).
// Amounts are summed only for accounts in the default USD asset; other assets are counted, not added.
import { useEffect, useState } from 'react';
import { aggregateLiveStats, liveStatsQuery, type LiveIndexerData, type LiveStats } from '@/lib/live-stats';

const INDEXER = process.env.NEXT_PUBLIC_INDEXER_URL || '';
const USD_ASSET = (process.env.NEXT_PUBLIC_USDC_ADDRESS || '').toLowerCase();

async function load(): Promise<LiveStats> {
  const r = await fetch(INDEXER, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: liveStatsQuery }), cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok || j.errors || !j.data) throw new Error('Indexer unavailable');
  return aggregateLiveStats(j.data as LiveIndexerData, USD_ASSET);
}

/** Polls the indexer every 15 s. `null` until loaded or when no indexer is configured. */
export function useLiveStats() {
  const [stats, setStats] = useState<LiveStats | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!INDEXER) return;
    let stop = false;
    const tick = () =>
      load()
        .then((s) => !stop && (setStats(s), setError(false)))
        .catch(() => !stop && setError(true));
    tick();
    const t = setInterval(tick, 15_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);
  return { stats, error, configured: !!INDEXER };
}
