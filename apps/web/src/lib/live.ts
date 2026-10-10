'use client';
// Live market data: Envio HyperIndex for revenue, payers, covenant checks and bond state, plus on-chain
// reads for bond terms. When no indexer or bond addresses are configured, the app falls back to the
// labelled synthetic fixtures in data.ts; live and synthetic values are never mixed.
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { accountAbi, bondAbi, covenantAbi } from './abi';
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
          { name: 'milestoneMode', type: 'uint8' },
          { name: 'minFeeBps', type: 'uint16' },
        ],
      },
    ],
  },
] as const;

const PHASES: Phase[] = ['Funding', 'Active', 'Closing', 'Closed', 'Cancelled'];

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
  // Amounts are in the bond's asset (its account's token): read its decimals and symbol.
  const asset = (await client.readContract({ address: bond, abi: bondAbi, functionName: 'asset' })) as Address;
  const [decimals, unit] = await Promise.all([
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'decimals' }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'symbol' }),
  ]);
  const amt = (v: string | bigint | number | null | undefined) => Number(formatUnits(BigInt(v ?? 0), decimals));
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
    row.amount += amt(p.amount);
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
  const daily = d.DailyRevenue.map((x) => ({ day: x.day, raw: amt(x.gross), verified: amt(x.verified) }));

  // Watched: the covenant's dark-period and deposit state, and a revenue-drop alert. A business could show
  // the monitor its account and unguarded customers another wallet: the monitor stays green while
  // verified x402 revenue falls. Compare the last 24 h with the prior 7-day daily average.
  const watched = Number(adapter) === 1;
  let darkFor = 0,
    depositsPaused = false,
    revenueDrop: { last24h: number; dailyAverage: number } | null = null;
  if (watched) {
    const covenant = (await client.readContract({ address: bond, abi: bondAbi, functionName: 'covenant' })) as Address;
    const [dark, paused] = await Promise.all([
      client.readContract({ address: covenant, abi: covenantAbi, functionName: 'darkFor', args: [bond] }),
      client.readContract({ address: covenant, abi: covenantAbi, functionName: 'inViolation', args: [bond] }),
    ]);
    darkFor = Number(dark);
    depositsPaused = Boolean(paused);
    const now = Date.now() / 1000;
    const x402 = d.Payment.filter((p) => p.source === 'x402' && !p.related);
    const sum = (from: number, to: number) =>
      x402.filter((p) => Number(p.timestamp) >= from && Number(p.timestamp) < to).reduce((s, p) => s + amt(p.amount), 0);
    const dailyAverage = sum(now - 8 * 86_400, now - 86_400) / 7;
    if (dailyAverage > 0) revenueDrop = { last24h: sum(now - 86_400, now + 1), dailyAverage };
  }
  const peak = Math.max(1e-9, ...daily.map((x) => x.raw));

  return {
    ...base,
    live: true,
    bond,
    account,
    nativeApproved: !!issuer?.projectApproved,
    adapter: (['Native', 'Watched'] as const)[Number(adapter)] ?? base.adapter,
    unit,
    minFeeBps: Number(terms.minFeeBps),
    history: daily.length ? daily.map((x) => (x.raw / peak) * 100) : [0],
    credit: {
      cumulative: amt(cumulative as bigint),
      payments: Number(paymentCount),
      uniquePayers: Number(uniquePayers),
      since: Number(firstRevenueAt),
    },
    name: base.name,
    symbol: String(symbol),
    claimName: String(name),
    phase: PHASES[b?.phase ?? 0] ?? 'Funding',
    raised: amt(b?.raised),
    target: amt(terms.raiseAmount),
    released: amt(b?.released),
    undrawn: amt(b?.undrawn),
    recovery: amt(b?.principalRecovery),
    revenue: amt(b?.revenueCollected),
    stake: amt(terms.stake),
    share: terms.revenueBps / 100,
    cap: amt(terms.repayCap),
    firstRelease: terms.firstReleaseBps === 2500 ? 25 : 50,
    term: Math.round(Number(terms.maturity - terms.fundingDeadline) / 86_400),
    observed,
    eligible,
    adjusted,
    days: daily.length,
    daily,
    payers,
    payments: issuer?.payments ?? 0,
    backingPerToken: amt(backing as bigint),
    pool: amt(b?.pool),
    supply: amt(b?.totalSupply),
    checks: d.CovenantCheck.map((c) => ({ result: c.result, at: Number(c.observedAt), txHash: c.txHash })),
    darkFor,
    depositsPaused,
    revenueDrop,
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
