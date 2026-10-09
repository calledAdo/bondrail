// Nansen address labels for payer screening, Monad MAINNET (Nansen does not cover Monad testnet).
// Server-side only: the API key never reaches the browser. Empty results cost Nansen 0 credits; a
// labelled address costs 100, so requests are capped and cached per server instance.
import { NextResponse } from 'next/server';
import { isAddress } from 'viem';

type Label = { label: string; category?: string; kind?: string };
const cache = new Map<string, { at: number; labels: Label[] | null; error?: string }>();
const TTL = 6 * 3600_000;
const MAX = 10;

async function labels(address: string, key: string) {
  const hit = cache.get(address);
  if (hit && Date.now() - hit.at < TTL) return hit;
  const r = await fetch('https://api.nansen.ai/api/v1/profiler/address/labels', {
    method: 'POST',
    headers: { apikey: key, 'content-type': 'application/json' },
    body: JSON.stringify({ address, chain: 'monad', pagination: { page: 1, per_page: 20 } }),
    signal: AbortSignal.timeout(10_000),
  });
  const entry = r.ok
    ? { at: Date.now(), labels: (((await r.json()) as { data?: Label[] }).data ?? []) as Label[] }
    : { at: Date.now(), labels: null, error: `Nansen HTTP ${r.status}` };
  cache.set(address, entry);
  return entry;
}

export async function POST(req: Request) {
  const key = process.env.NANSEN_API_KEY;
  if (!key) return NextResponse.json({ error: 'Nansen is not configured' }, { status: 503 });
  const { addresses } = (await req.json().catch(() => ({}))) as { addresses?: unknown };
  if (!Array.isArray(addresses)) return NextResponse.json({ error: 'addresses[] required' }, { status: 400 });
  const list = [...new Set(addresses.filter((a): a is string => typeof a === 'string' && isAddress(a)))]
    .map((a) => a.toLowerCase())
    .slice(0, MAX);
  const results = await Promise.all(
    list.map(async (a) => {
      try {
        const e = await labels(a, key);
        return { address: a, labels: e.labels, error: e.error };
      } catch {
        return { address: a, labels: null, error: 'Nansen request failed' };
      }
    }),
  );
  return NextResponse.json({ network: 'monad-mainnet', source: 'Nansen profiler/address/labels', results });
}
