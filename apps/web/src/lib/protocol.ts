'use client';
// The app's data layer. Every account and bond comes from the Envio indexer (so the market lists every
// indexed bond, not a configured few); terms, the asset and source health come from the chain. Evidence
// metrics (verified revenue, payer concentration, coverage) and listing flags are computed here once.
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { accountAbi, bondAbi, factoryAbi } from './abi';
import { deployment } from './wallet';
import type { KuruRecord, ProfileRecord } from './profile';

export const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL || '';
export const KNOWN_ASSETS = new Set([deployment.token?.toLowerCase()].filter(Boolean) as string[]);
const DAY = 86_400;

export type Phase = 'Funding' | 'Active' | 'Closing' | 'Closed' | 'Cancelled';
const PHASES: Phase[] = ['Funding', 'Active', 'Closing', 'Closed', 'Cancelled'];
export type Tier = 'Native' | 'Watched';

export type Payer = { payer: string; amount: number; payments: number; related: boolean; reasons: string[]; source: string };
export type Asset = { address: Address; symbol: string; decimals: number; known: boolean };

export type AccountView = {
  address: Address;
  issuer: Address;
  tier?: Tier;
  project?: Address;
  reviewed: boolean;
  asset: Asset;
  revenue: number;
  verified: number;
  volume?: number;
  payments: number;
  payers: Payer[];
  uniquePayers: number;
  topPayerShare: number;
  firstRevenueAt?: number;
  ageDays: number;
  verifiedDaily: number;
  daily: { day: number; raw: number; verified: number }[];
  toInvestors: number;
  bonds: Address[];
  activeBond?: Address;
  /** Verified x402 revenue in the last 24 h vs the prior 7-day daily average (null without a baseline). */
  revenueDrop: { last24h: number; dailyAverage: number } | null;
  /** The issuer-signed profile, if any (name, links, use of funds; domain proof checked by the server). */
  profile?: ProfileRecord;
};

export type BondView = {
  address: Address;
  account: Address;
  name: string;
  symbol: string;
  tier: Tier;
  phase: Phase;
  defaulted: boolean;
  asset: Asset;
  raise: number;
  raised: number;
  cap: number;
  effectiveCap: number;
  released: number;
  undrawn: number;
  recovery: number;
  collected: number;
  pool: number;
  supply: number;
  stake: number;
  backingPerToken: number;
  revenueShare: number;
  firstReleasePct: 25 | 50;
  minFeeBps: number;
  milestoneMode: 'Onchain' | 'Signed';
  minRevenue: number;
  fundingDeadline: number;
  secondReleaseNotBefore: number;
  secondReleaseDeadline: number;
  maturity: number;
  createdAt: number;
  depositAllowed?: boolean;
  /** Evidence and investor metrics, computed from the account's verified revenue. */
  multiple: number;
  coverage: number | null;
  paybackDays: number | null;
  atRiskPct: number;
  flags: string[];
  checks: { result: number; at: number; txHash: string }[];
  kuru?: KuruRecord;
};

export type Protocol = { accounts: AccountView[]; bonds: BondView[]; indexedAt: number };

async function gql(query: string) {
  const r = await fetch(INDEXER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
    cache: 'no-store',
  });
  const j = await r.json();
  if (!r.ok || j.errors) throw new Error(j.errors?.[0]?.message ?? 'Indexer query failed');
  return j.data;
}

const query = `{
  Issuer { id issuer tier project projectApproved activeBond grossRevenue toInvestors payments firstRevenueAt asset volume }
  Bond(order_by: { createdAt: desc }) { id account adapter phase raised released undrawn principalRecovery revenueCollected stakeRecovery pool totalSupply effectiveCap defaulted createdAt }
  DailyRevenue(order_by: { day: asc }) { account day gross verified x402 }
  PayerTotal(order_by: { amount: desc }) { account payer amount payments related reasons source }
  CovenantCheck(order_by: { observedAt: desc }, limit: 200) { bond result observedAt txHash }
}`;

/** Load and assemble everything: per-payer and per-day aggregates come from the indexer, so nothing is truncated. */
async function load(client: NonNullable<ReturnType<typeof usePublicClient>>): Promise<Protocol> {
  const d: any = await gql(query);
  const now = Date.now() / 1000;
  const issuers = d.Issuer as any[];
  // Signed profiles and Kuru listings (off-chain records, each verified by the registry).
  const registry = (await fetch(
    `/api/registry?accounts=${issuers.map((i) => i.id).join(',')}&bonds=${(d.Bond as any[]).map((b) => b.id).join(',')}`,
    { cache: 'no-store' },
  )
    .then((r) => r.json())
    .catch(() => ({}))) as { profiles?: Record<string, ProfileRecord | null>; kuru?: Record<string, KuruRecord | null> };

  // On-chain: each account's asset (decimals, symbol), each bond's terms, names, backing and health.
  const assetOf = new Map<string, Address>();
  await Promise.all(
    issuers.map(async (i) => {
      const a = (i.asset as Address | undefined) ??
        ((await client.readContract({ address: i.id, abi: accountAbi, functionName: 'asset' }).catch(() => undefined)) as
          | Address
          | undefined);
      if (a) assetOf.set(i.id, a.toLowerCase() as Address);
    }),
  );
  const assets = new Map<string, Asset>();
  await Promise.all(
    [...new Set(assetOf.values())].map(async (a) => {
      const [decimals, symbol] = await Promise.all([
        client.readContract({ address: a, abi: erc20Abi, functionName: 'decimals' }).catch(() => 6),
        client.readContract({ address: a, abi: erc20Abi, functionName: 'symbol' }).catch(() => 'tokens'),
      ]);
      assets.set(a, { address: a, decimals: Number(decimals), symbol: String(symbol), known: KNOWN_ASSETS.has(a) });
    }),
  );
  const fallback: Asset = { address: '0x0000000000000000000000000000000000000000', decimals: 6, symbol: 'USDC', known: true };
  const assetFor = (account: string) => assets.get(assetOf.get(account) ?? '') ?? fallback;
  const unit = (v: unknown, a: Asset) => Number(BigInt((v as string) ?? 0)) / 10 ** a.decimals;

  const accounts: AccountView[] = issuers.map((i) => {
    const asset = assetFor(i.id);
    const payers: Payer[] = (d.PayerTotal as any[])
      .filter((p) => p.account === i.id)
      .map((p) => ({ payer: p.payer, amount: unit(p.amount, asset), payments: p.payments, related: p.related, reasons: p.reasons, source: p.source }))
      .sort((a, b) => b.amount - a.amount);
    const verifiedPayers = payers.filter((p) => !p.related);
    const verified = verifiedPayers.reduce((s, p) => s + p.amount, 0);
    const daily = (d.DailyRevenue as any[])
      .filter((x) => x.account === i.id)
      .map((x) => ({ day: Number(x.day), raw: unit(x.gross, asset), verified: unit(x.verified, asset) }));
    const today = Math.floor(now / DAY);
    const verified7 = daily.filter((x) => x.day > today - 7).reduce((s, x) => s + x.verified, 0);
    // A business could show the monitor its account and unguarded customers another wallet: the monitor
    // stays green while attributed x402 revenue falls. Compare yesterday with the 7 days before it.
    const x402Day = (day: number) => unit((d.DailyRevenue as any[]).find((x) => x.account === i.id && Number(x.day) === day)?.x402 ?? '0', asset);
    const dailyAverage = Array.from({ length: 7 }, (_, k) => x402Day(today - 2 - k)).reduce((s, v) => s + v, 0) / 7;
    const revenueDrop = dailyAverage > 0 ? { last24h: x402Day(today - 1), dailyAverage } : null;
    const first = i.firstRevenueAt ? Number(i.firstRevenueAt) : undefined;
    return {
      address: i.id,
      issuer: i.issuer,
      tier: i.tier === 0 ? 'Native' : i.tier == null ? undefined : 'Watched',
      project: i.project ?? undefined,
      reviewed: !!i.projectApproved,
      asset,
      revenue: unit(i.grossRevenue, asset),
      verified,
      volume: i.volume != null ? unit(i.volume, asset) : undefined,
      payments: i.payments,
      payers,
      uniquePayers: verifiedPayers.length,
      topPayerShare: verified > 0 ? verifiedPayers[0]!.amount / verified : 0,
      firstRevenueAt: first,
      ageDays: first ? (now - first) / DAY : 0,
      verifiedDaily: verified7 / Math.min(7, Math.max(1, first ? (now - first) / DAY : 1)),
      daily,
      toInvestors: unit(i.toInvestors, asset),
      bonds: (d.Bond as any[]).filter((b) => b.account === i.id).map((b) => b.id),
      activeBond: i.activeBond ?? undefined,
      revenueDrop,
      profile: registry.profiles?.[i.id] ?? undefined,
    };
  });
  const accountMap = new Map(accounts.map((a) => [a.address, a]));

  const bonds = (
    await Promise.allSettled(
      (d.Bond as any[]).map(async (b): Promise<BondView> => {
        const address = b.id as Address;
        const [terms, name, symbol, backing, allowed] = await Promise.all([
          client.readContract({ address, abi: bondAbi, functionName: 'terms' }) as Promise<any>,
          client.readContract({ address, abi: bondAbi, functionName: 'name' }),
          client.readContract({ address, abi: bondAbi, functionName: 'symbol' }),
          client.readContract({ address, abi: bondAbi, functionName: 'backingPerToken' }),
          deployment.factory
            ? client
                .readContract({ address: deployment.factory, abi: factoryAbi, functionName: 'depositAllowed', args: [address] })
                .catch(() => undefined)
            : Promise.resolve(undefined),
        ]);
        const acct = accountMap.get(b.account);
        const asset = acct?.asset ?? fallback;
        const u = (v: unknown) => unit(v, asset);
        const phase = PHASES[b.phase] ?? 'Funding';
        const raise = u(terms.raiseAmount);
        const cap = u(terms.repayCap);
        const effectiveCap = u(b.effectiveCap) || cap;
        const collected = u(b.revenueCollected);
        const share = Number(terms.revenueBps) / 10_000;
        const maturity = Number(terms.maturity);
        // Coverage horizon: from the funding deadline (still raising) or from now, to maturity.
        const start = phase === 'Funding' ? Number(terms.fundingDeadline) : now;
        const daysLeft = Math.max(0, (maturity - start) / DAY);
        const remaining = Math.max(0, (phase === 'Funding' ? cap : effectiveCap) - collected);
        const perDay = (acct?.verifiedDaily ?? 0) * share;
        const coverage = remaining > 0 ? (perDay * daysLeft) / remaining : null;
        const flags: string[] = [];
        if (!acct?.profile) flags.push('No signed profile');
        if (allowed === false) flags.push('Source unhealthy');
        if (!asset.known) flags.push('Unrecognised asset');
        if ((acct?.uniquePayers ?? 0) < 2) flags.push('Fewer than two attributed payers');
        if ((acct?.topPayerShare ?? 0) > 0.5) flags.push('One payer is over half of revenue');
        if (coverage !== null && coverage < 1.2 && (phase === 'Funding' || phase === 'Active')) flags.push('Coverage below 1.2×');
        const released = u(b.released);
        return {
          address,
          account: b.account,
          name: acct?.profile?.profile.name || String(name).replace(/ Revenue Claim$/, ''),
          symbol: String(symbol),
          tier: Number(b.adapter) === 0 ? 'Native' : 'Watched',
          phase,
          defaulted: !!b.defaulted,
          asset,
          raise,
          raised: u(b.raised),
          cap,
          effectiveCap,
          released,
          undrawn: u(b.undrawn),
          recovery: u(b.principalRecovery) + u(b.stakeRecovery),
          collected,
          pool: u(b.pool),
          supply: u(b.totalSupply),
          stake: u(terms.stake),
          // backingPerToken() is pool × 1e6 / supply: a ratio at fixed 1e6 precision whatever the asset's decimals.
          backingPerToken: Number(backing) / 1e6,
          revenueShare: share * 100,
          firstReleasePct: Number(terms.firstReleaseBps) === 2500 ? 25 : 50,
          minFeeBps: Number(terms.minFeeBps ?? 0),
          milestoneMode: Number(terms.milestoneMode) === 0 ? 'Onchain' : 'Signed',
          minRevenue: u(terms.minRevenue),
          fundingDeadline: Number(terms.fundingDeadline),
          secondReleaseNotBefore: Number(terms.secondReleaseNotBefore),
          secondReleaseDeadline: Number(terms.secondReleaseDeadline),
          maturity,
          createdAt: Number(b.createdAt),
          depositAllowed: allowed as boolean | undefined,
          multiple: raise > 0 ? cap / raise : 0,
          coverage,
          paybackDays: perDay > 0 ? remaining / perDay : null,
          atRiskPct: phase === 'Funding' ? (Number(terms.firstReleaseBps) / 100) : raise > 0 ? (released / raise) * 100 : 0,
          flags,
          checks: (d.CovenantCheck as any[])
            .filter((c) => c.bond === address)
            .map((c) => ({ result: c.result, at: Number(c.observedAt), txHash: c.txHash })),
          kuru: registry.kuru?.[address.toLowerCase()] ?? undefined,
        };
      }),
    )
  ).flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));

  return { accounts, bonds, indexedAt: now };
}

/** Everything the app shows, refreshed every 10 s. */
export function useProtocol() {
  const client = usePublicClient();
  const q = useQuery({
    queryKey: ['protocol'],
    enabled: !!INDEXER_URL && !!client,
    refetchInterval: 10_000,
    queryFn: () => load(client!),
  });
  return { data: q.data, loading: q.isLoading, error: q.error as Error | null, configured: !!INDEXER_URL };
}

/** Market tabs: primary (raising), secondary (trading), and the pipeline / history. */
export function marketTab(b: BondView): 'raising' | 'trading' | 'record' {
  if (b.phase === 'Funding') return 'raising';
  if (b.phase === 'Active' || b.phase === 'Closing') return 'trading';
  return 'record';
}

/** Default view hides listings with evidence problems; "show all" reveals them. */
export const HIDING_FLAGS = ['No signed profile', 'Source unhealthy', 'Unrecognised asset', 'Fewer than two attributed payers'];
export const listed = (b: BondView) => !b.flags.some((f) => HIDING_FLAGS.includes(f));

export const fmt = (n: number, a: Asset, digits = 2) =>
  /USD/i.test(a.symbol)
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : digits }).format(n)
    : `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(n)} ${a.symbol}`;
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const days = (d: number) => (d >= 1 ? `${Math.round(d)}d` : `${Math.max(1, Math.round(d * 24))}h`);
