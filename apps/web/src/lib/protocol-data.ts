// Pure indexer queries and view assembly. No network reads gate the indexed summary.
import { indexedCreditMetrics } from '@bondrail/sdk/credit';
import type { readBondTerms } from '@bondrail/sdk/client';
import type { Address } from 'viem';
import type { KuruRecord, ProfileRecord } from './profile';
import type { NativeReview } from './native-review';
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
  nativeReview: NativeReview;
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
  baseRevenueShare: number;
  triggerRevenue: number;
  triggerWindowDays: number;
  stepUpShare: number;
  triggered: boolean;
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
  activationTime?: number;
  collectionClosedAt?: number;
  settleAfter?: number;
  defaultedAt?: number;
  policyHash?: `0x${string}`;
  source?: Address;
  minOperatingPeriod?: number;
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


export type IndexedBond = {
  id: Address; account: Address; adapter: number; policyHash?: string; phase: number;
  raised: string; released: string; undrawn: string; principalRecovery: string; revenueCollected: string;
  stakeRecovery: string; pool: string; totalSupply: string; effectiveCap: string;
  defaulted: boolean; triggered: boolean; createdAt: string;
};
export type IndexedIssuer = {
  id: Address; issuer: Address; tier?: number; project?: Address; projectApproved?: boolean; activeBond?: Address;
  grossRevenue: string; toInvestors: string; payments: number; firstRevenueAt?: string; asset: Address; volume?: string;
};
export type IndexerData = {
  Issuer: IndexedIssuer[]; Bond: IndexedBond[];
  DailyRevenue: { account: Address; day: number; gross: string; verified: string; x402: string }[];
  PayerTotal: { account: Address; payer: string; amount: string; payments: number; related: boolean; reasons: string[]; source: string }[];
  CovenantCheck: { bond: Address; result: number; observedAt: string; txHash: string }[];
};
export const emptyIndex: IndexerData = { Issuer: [], Bond: [], DailyRevenue: [], PayerTotal: [], CovenantCheck: [] };
export type Registry = { profiles?: Record<string, ProfileRecord | null>; kuru?: Record<string, KuruRecord | null> };
export type BondMetadata = { terms: Awaited<ReturnType<typeof readBondTerms>>; name: string; symbol: string };
const issuerFields = 'id issuer tier project projectApproved activeBond grossRevenue toInvestors payments firstRevenueAt asset volume';
const bondFields = 'id account adapter policyHash phase raised released undrawn principalRecovery revenueCollected stakeRecovery pool totalSupply effectiveCap defaulted triggered createdAt';
export const listQuery = `{
  Issuer { ${issuerFields} }
  Bond(order_by: { createdAt: desc }) { ${bondFields} }
  DailyRevenue(order_by: { day: asc }) { account day gross verified x402 }
  PayerTotal(order_by: { amount: desc }) { account payer amount payments related reasons source }
}`;
// Variables avoid interpolating route input into GraphQL. Indexer addresses are canonical lowercase.
export const bondQuery = `query BondPage($address: String!) {
  Bond(where: { id: { _eq: $address } }) { ${bondFields} }
  Issuer(where: { activeBond: { _eq: $address } }) { ${issuerFields} }
}`;
export const checksQuery = `query BondChecks($address: String!) {
  CovenantCheck(where: { bond: { _eq: $address } }, order_by: { observedAt: desc }, limit: 200) { bond result observedAt txHash }
}`;
export const accountQuery = `query AccountEvidence($address: String!) {
  Issuer(where: { id: { _eq: $address } }) { ${issuerFields} }
  DailyRevenue(where: { account: { _eq: $address } }, order_by: { day: asc }) { account day gross verified x402 }
  PayerTotal(where: { account: { _eq: $address } }, order_by: { amount: desc }) { account payer amount payments related reasons source }
}`;
export const accountBondsQuery = `query AccountBonds($address: String!) {
  Bond(where: { account: { _eq: $address } }, order_by: { createdAt: desc }) { ${bondFields} }
}`;
export const unit = (v: unknown, a: Asset) => Number(BigInt((v as string) ?? 0)) / 10 ** a.decimals;
/** Match the contract's fixed 1e6 precision and integer rounding, without another RPC. */
export const indexedBacking = (b: Pick<IndexedBond, 'pool' | 'totalSupply'>) => BigInt(b.totalSupply) > 0n
  ? Number(BigInt(b.pool) * 1_000_000n / BigInt(b.totalSupply)) / 1e6 : 0;
export const indexedPhase = (b: IndexedBond) => PHASES[b.phase] ?? 'Funding';
export function assembleAccounts(d: IndexerData, assets: Map<string, Asset>, registry: Registry = {}, reviews = new Map<string, NativeReview>(), now = Date.now() / 1000): AccountView[] {
  const issuers = d.Issuer.filter(i => assets.has(i.asset.toLowerCase()));
  const assetFor = (id: string) => assets.get(issuers.find(i => i.id === id)!.asset.toLowerCase())!;
  const accounts: AccountView[] = issuers.map((i) => {
    const asset = assetFor(i.id);
    const payers: Payer[] = d.PayerTotal
      .filter((p) => p.account === i.id)
      .map((p) => ({ payer: p.payer, amount: unit(p.amount, asset), payments: p.payments, related: p.related, reasons: p.reasons, source: p.source }))
      .sort((a, b) => b.amount - a.amount);
    const daily = d.DailyRevenue
      .filter((x) => x.account === i.id)
      .map((x) => ({ day: Number(x.day), raw: unit(x.gross, asset), verified: unit(x.verified, asset) }));
    const today = Math.floor(now / DAY);
    // A business could show the monitor its account and unguarded customers another wallet: the monitor
    // stays green while attributed x402 revenue falls. Compare yesterday with the 7 days before it.
    const x402Day = (day: number) => unit(d.DailyRevenue.find((x) => x.account === i.id && Number(x.day) === day)?.x402 ?? '0', asset);
    const dailyAverage = Array.from({ length: 7 }, (_, k) => x402Day(today - 2 - k)).reduce((s, v) => s + v, 0) / 7;
    const revenueDrop = dailyAverage > 0 ? { last24h: x402Day(today - 1), dailyAverage } : null;
    const first = i.firstRevenueAt ? Number(i.firstRevenueAt) : undefined;
    const credit = indexedCreditMetrics({ now, firstRevenueAt: first,
      payers: d.PayerTotal.filter(p => p.account === i.id).map(p => ({ amount: BigInt(p.amount), related: p.related })),
      daily: d.DailyRevenue.filter(r => r.account === i.id).map(r => ({ day: Number(r.day), verified: BigInt(r.verified) })),
    });
    return {
      address: i.id,
      issuer: i.issuer,
      tier: i.tier === 0 ? 'Native' : i.tier == null ? undefined : 'Watched',
      project: i.project ?? undefined,
      reviewed: reviews.get(i.id) === 'template' || reviews.get(i.id) === 'individual',
      nativeReview: reviews.get(i.id) ?? 'unknown',
      asset,
      revenue: unit(i.grossRevenue, asset),
      verified: unit(credit.attributedRevenue, asset),
      volume: i.volume != null ? unit(i.volume, asset) : undefined,
      payments: i.payments,
      payers,
      uniquePayers: credit.distinctPayers,
      topPayerShare: credit.topPayerShare,
      firstRevenueAt: first,
      ageDays: credit.ageDays,
      verifiedDaily: unit(credit.recentRevenue, asset) / credit.rateDays,
      daily,
      toInvestors: unit(i.toInvestors, asset),
      bonds: d.Bond.filter((b) => b.account === i.id).map((b) => b.id),
      activeBond: i.activeBond ?? undefined,
      revenueDrop,
      profile: registry.profiles?.[i.id] ?? undefined,
    };
  });
  return accounts;
}

export function assembleBond(b: IndexedBond, acct: AccountView, metadata: BondMetadata, registry: Registry = {}, checks: IndexerData['CovenantCheck'] = [], live?: { allowed?: boolean; extra: { result?: unknown }[] }, now = Date.now() / 1000, evidenceKnown = true): BondView {
  const address = b.id;
  const { terms, name, symbol } = metadata;
  const allowed = live?.allowed;
  const extra = live?.extra ?? [];
  const d = { CovenantCheck: checks };

  const asset = acct.asset;
  const u = (v: unknown) => unit(v, asset);
  const phase = PHASES[b.phase] ?? 'Funding';
  const raise = u(terms.raiseAmount);
  const cap = u(terms.repayCap);
  const effectiveCap = u(b.effectiveCap);
  const collected = u(b.revenueCollected);
  const baseShare = Number(terms.revenueBps) / 10_000;
  const share = b.triggered ? Number(terms.stepUpBps) / 10_000 : baseShare;
  const maturity = Number(terms.maturity);
  // Coverage horizon: from the funding deadline (still raising) or from now, to maturity.
  const start = phase === 'Funding' ? Number(terms.fundingDeadline) : now;
  const daysLeft = Math.max(0, (maturity - start) / DAY);
  const remaining = Math.max(0, (phase === 'Funding' ? cap : effectiveCap) - collected);
  const perDay = (acct?.verifiedDaily ?? 0) * share;
  const coverage = evidenceKnown && remaining > 0 ? (perDay * daysLeft) / remaining : null;
  const flags: string[] = [];
  if (!acct?.profile) flags.push('No signed profile');
  if (allowed === false) flags.push('Source unhealthy');
  if (!asset.known) flags.push('Unrecognised asset');
  if (evidenceKnown && (acct?.uniquePayers ?? 0) < 2) flags.push('Fewer than two attributed payers');
  if (evidenceKnown && (acct?.topPayerShare ?? 0) > 0.5) flags.push('One payer is over half of revenue');
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
    backingPerToken: indexedBacking(b),
    revenueShare: share * 100,
    baseRevenueShare: baseShare * 100,
    triggerRevenue: u(terms.triggerRevenue),
    triggerWindowDays: Number(terms.triggerWindowDays),
    stepUpShare: Number(terms.stepUpBps) / 100,
    triggered: !!b.triggered,
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
    activationTime: extra[0]?.result === undefined ? undefined : Number(extra[0].result),
    collectionClosedAt: extra[1]?.result === undefined ? undefined : Number(extra[1].result),
    settleAfter: extra[2]?.result === undefined ? undefined : Number(extra[2].result),
    defaultedAt: extra[3]?.result === undefined ? undefined : Number(extra[3].result),
    policyHash: b.policyHash as `0x${string}` | undefined,
    source: extra[4]?.result as Address | undefined,
    minOperatingPeriod: Number(terms.minOperatingPeriod),
    multiple: raise > 0 ? cap / raise : 0,
    coverage,
    paybackDays: evidenceKnown && perDay > 0 ? remaining / perDay : null,
    atRiskPct: phase === 'Funding' ? (Number(terms.firstReleaseBps) / 100) : raise > 0 ? (released / raise) * 100 : 0,
    flags,
    checks: d.CovenantCheck
      .filter((c) => c.bond === address)
      .map((c) => ({ result: c.result, at: Number(c.observedAt), txHash: c.txHash })),
    kuru: registry.kuru?.[address.toLowerCase()] ?? undefined,
  };
}
