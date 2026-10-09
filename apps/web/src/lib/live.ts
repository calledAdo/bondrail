'use client';
// Live market data: Envio HyperIndex for revenue, payers, covenant checks and bond state, plus on-chain
// reads for bond terms. When no indexer or bond addresses are configured, the app falls back to the
// labelled synthetic fixtures in data.ts; live and synthetic values are never mixed.
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { accountAbi, bondAbi } from './abi';
import { markets as fixtures, type Market, type PayerRow, type Phase } from './data';
import { deployment } from './wallet';

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || '';
export const liveConfigured = !!INDEXER_URL && Object.values(deployment.bonds).some(Boolean);

const termsAbi = [
  {
    type: 'function',
    name: 'terms',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'raiseAmount', type: 'uint256' },
          { name: 'repayCap', type: 'uint256' },
          { name: 'stake', type: 'uint256' },
          { name: 'minRevenue', type: 'uint256' },
          { name: 'fundingDeadline', type: 'uint64' },
          { name: 'maturity', type: 'uint64' },
          { name: 'secondReleaseNotBefore', type: 'uint64' },
          { name: 'secondReleaseDeadline', type: 'uint64' },
          { name: 'minOperatingPeriod', type: 'uint32' },
          { name: 'revenueBps', type: 'uint16' },
          { name: 'firstReleaseBps', type: 'uint16' },
        ],
      },
    ],
  },
] as const;

const PHASES: Phase[] = ['Funding', 'Active', 'Closing', 'Closed', 'Cancelled'];
const usd = (v: string | bigint | number | null | undefined) => Number(formatUnits(BigInt(v ?? 0), 6));

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error('Indexer query failed');
  return j.data as T;
}

const QUERY = `
query Market($bond: String!, $account: String!) {
  Bond(where: { id: { _eq: $bond } }) {
    id account phase raised released undrawn principalRecovery revenueCollected stakeRecovery pool
    totalSupply effectiveCap defaulted
  }
  Issuer(where: { id: { _eq: $account } }) { grossRevenue toInvestors payments issuer tier projectApproved }
  DailyRevenue(where: { account: { _eq: $account } }, order_by: { day: asc }) { day gross verified payments }
  Payment(where: { account: { _eq: $account } }, order_by: { timestamp: desc }, limit: 1000) {
    payer amount related reasons source timestamp
  }
  CovenantCheck(where: { bond: { _eq: $bond } }, order_by: { observedAt: desc }, limit: 20) {
    result observedAt epoch txHash
  }
}`;

type Row = {
  Bond: Array<Record<string, any>>;
  Issuer: Array<Record<string, any>>;
  DailyRevenue: Array<{ day: number; gross: string; verified: string; payments: number }>;
  Payment: Array<{ payer: string; amount: string; related: boolean; reasons: string[]; source: string; timestamp: string }>;
  CovenantCheck: Array<{ result: number; observedAt: string; epoch: string; txHash: string }>;
};

async function loadMarket(
  client: NonNullable<ReturnType<typeof usePublicClient>>,
  base: Market,
  bond: Address,
): Promise<Market> {
  const [terms, name, symbol, backing] = await Promise.all([
    client.readContract({ address: bond, abi: termsAbi, functionName: 'terms' }),
    client.readContract({ address: bond, abi: bondAbi, functionName: 'name' }),
    client.readContract({ address: bond, abi: bondAbi, functionName: 'symbol' }),
    client.readContract({ address: bond, abi: bondAbi, functionName: 'backingPerToken' }),
  ]);
  const account = (await client.readContract({ address: bond, abi: bondAbi, functionName: 'account' })) as Address;
  const read = (functionName: 'cumulativeRevenue' | 'paymentCount' | 'uniquePayers' | 'firstRevenueAt') =>
    client.readContract({ address: account, abi: accountAbi, functionName });
  const [cumulative, paymentCount, uniquePayers, firstRevenueAt, adapter] = await Promise.all([
    read('cumulativeRevenue'),
    read('paymentCount'),
    read('uniquePayers'),
    read('firstRevenueAt'),
    client.readContract({ address: bond, abi: bondAbi, functionName: 'adapter' }),
  ]);
  const d = await gql<Row>(QUERY, { bond: bond.toLowerCase(), account: account.toLowerCase() });
  const b = d.Bond[0];
  const issuer = d.Issuer[0];

  // Payer table: one row per payer, with the reasons the indexer attached.
  const byPayer = new Map<string, PayerRow>();
  for (const p of d.Payment) {
    const row = byPayer.get(p.payer) ?? { payer: p.payer, amount: 0, payments: 0, related: false, reasons: [], source: p.source };
    row.amount += usd(p.amount);
    row.payments += 1;
    row.related ||= p.related;
    for (const r of p.reasons) if (!row.reasons.includes(r)) row.reasons.push(r);
    byPayer.set(p.payer, row);
  }
  const payers = [...byPayer.values()].sort((a, b) => b.amount - a.amount);
  const observed = payers.reduce((s, p) => s + p.amount, 0);
  const eligible = payers.filter((p) => !p.related).reduce((s, p) => s + p.amount, 0);
  // Concentration haircut: no single verified payer counts for more than 10% of verified revenue.
  const capPer = eligible / 10;
  const adjusted = payers.filter((p) => !p.related).reduce((s, p) => s + Math.min(p.amount, capPer), 0);
  const daily = d.DailyRevenue.map((x) => ({ day: x.day, raw: usd(x.gross), verified: usd(x.verified) }));
  const peak = Math.max(1e-9, ...daily.map((x) => x.raw));

  return {
    ...base,
    live: true,
    bond,
    account,
    nativeApproved: !!issuer?.projectApproved,
    adapter: (['Native', 'Locked', 'Watched'] as const)[Number(adapter)] ?? base.adapter,
    history: daily.length ? daily.map((x) => (x.raw / peak) * 100) : [0],
    credit: {
      cumulative: usd(cumulative as bigint),
      payments: Number(paymentCount),
      uniquePayers: Number(uniquePayers),
      since: Number(firstRevenueAt),
    },
    name: base.name,
    symbol: String(symbol),
    claimName: String(name),
    phase: PHASES[b?.phase ?? 0] ?? 'Funding',
    raised: usd(b?.raised),
    target: usd(terms.raiseAmount),
    released: usd(b?.released),
    undrawn: usd(b?.undrawn),
    recovery: usd(b?.principalRecovery),
    revenue: usd(b?.revenueCollected),
    stake: usd(terms.stake),
    share: terms.revenueBps / 100,
    cap: usd(terms.repayCap),
    firstRelease: terms.firstReleaseBps === 2500 ? 25 : 50,
    term: Math.round(Number(terms.maturity - terms.fundingDeadline) / 86_400),
    observed,
    eligible,
    adjusted,
    days: daily.length,
    daily,
    payers,
    payments: issuer?.payments ?? 0,
    backingPerToken: usd(backing as bigint),
    pool: usd(b?.pool),
    supply: usd(b?.totalSupply),
    checks: d.CovenantCheck.map((c) => ({ result: c.result, at: Number(c.observedAt), txHash: c.txHash })),
    defaulted: !!b?.defaulted,
  };
}

/** All markets: live when configured, otherwise the labelled synthetic fixtures. */
export function useMarkets() {
  const client = usePublicClient();
  const q = useQuery({
    queryKey: ['markets', liveConfigured],
    enabled: liveConfigured && !!client,
    refetchInterval: 10_000,
    // Each market loads independently: one failed read doesn't hide the others.
    queryFn: async () => {
      const results = await Promise.allSettled(
        fixtures
          .filter((m) => deployment.bonds[m.id])
          .map((m) => loadMarket(client!, m, deployment.bonds[m.id]!)),
      );
      const ok = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      if (!ok.length && results.length) throw (results[0] as PromiseRejectedResult).reason;
      return ok;
    },
  });
  if (!liveConfigured) return { markets: fixtures, live: false, loading: false, error: null as Error | null };
  return { markets: q.data ?? [], live: true, loading: q.isLoading, error: q.error as Error | null };
}
