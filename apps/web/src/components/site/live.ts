'use client';
// Live protocol numbers for the landing page, read from the public Envio indexer (no wallet).
// Amounts are summed only for accounts in the default USD asset; other assets are counted, not added.
import { useEffect, useState } from 'react';

const INDEXER = process.env.NEXT_PUBLIC_INDEXER_URL || '';
const USD_ASSET = (process.env.NEXT_PUBLIC_USDC_ADDRESS || '').toLowerCase();

export type LivePayment = { payer: string; amount: number; source: string; timestamp: number; txHash: string };
export type LiveStats = {
  revenue: number;
  payments: number;
  accounts: number;
  activeBonds: number;
  toInvestors: number;
  recent: LivePayment[];
};

const query = (withAsset: boolean) => `{
  Issuer { grossRevenue toInvestors payments ${withAsset ? 'asset' : ''} }
  Bond { phase }
  Payment(order_by: { timestamp: desc }, limit: 24, where: { related: { _eq: false } }) { payer amount source timestamp txHash }
}`;

async function load(): Promise<LiveStats> {
  let data: any;
  for (const withAsset of [true, false]) {
    const r = await fetch(INDEXER, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: query(withAsset) }),
    });
    const j = await r.json();
    if (!j.errors) {
      data = j.data;
      break;
    }
  }
  if (!data) throw new Error('indexer unavailable');
  const usd = (v: string) => Number(BigInt(v)) / 1e6;
  const inUsd = (i: { asset?: string }) => !i.asset || !USD_ASSET || i.asset === USD_ASSET;
  const issuers = data.Issuer as { grossRevenue: string; toInvestors: string; payments: number; asset?: string }[];
  return {
    revenue: issuers.filter(inUsd).reduce((s, i) => s + usd(i.grossRevenue), 0),
    toInvestors: issuers.filter(inUsd).reduce((s, i) => s + usd(i.toInvestors), 0),
    payments: issuers.reduce((s, i) => s + i.payments, 0),
    accounts: issuers.length,
    activeBonds: (data.Bond as { phase: number }[]).filter((b) => b.phase === 1 || b.phase === 2).length,
    recent: (data.Payment as any[]).map((p) => ({
      payer: p.payer,
      amount: usd(p.amount),
      source: p.source,
      timestamp: Number(p.timestamp),
      txHash: p.txHash,
    })),
  };
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
