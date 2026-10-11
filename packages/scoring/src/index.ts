export type Exclusion = 'synthetic' | 'related' | 'incomplete';
export interface RevenuePayment {
  id: string;
  chainId: number;
  account: string;
  payer: string;
  amount: string;
  timestamp: number;
  source: 'native' | 'x402' | 'transfer';
  /** Shared-control evidence is required before assigning a shared cluster. */
  controlCluster?: string;
  synthetic: boolean;
  related: boolean;
  evidenceComplete: boolean;
  reasons: string[];
}
export interface RevenueWindow {
  chainId: number;
  account: string;
  from: number;
  to: number;
  coverageComplete: boolean;
  block: string;
  blockHash: string;
  payments: RevenuePayment[];
}
export interface ScorePolicy {
  version: string;
  minPayerAmount: bigint;
  minDayAmount: bigint;
}
export const scorePolicy: ScorePolicy = {
  version: 'slice-v1',
  minPayerAmount: 10_000n,
  minDayAmount: 10_000n,
};
const DAY = 86_400;
const RATIO = 1_000_000_000n;
const normalize = (value: string) => value.toLowerCase();
const ratio = (n: bigint, d: bigint) => (d === 0n ? 0 : Number((n * RATIO) / d) / Number(RATIO));

export function calculateScore(window: RevenueWindow, policy = scorePolicy) {
  if (!Number.isSafeInteger(window.from) || !Number.isSafeInteger(window.to) || window.to <= window.from)
    throw new Error('Invalid observation window');
  const seen = new Set<string>();
  const payerTotals = new Map<string, bigint>();
  const daily = new Map<number, { raw: bigint; eligible: bigint }>();
  let raw = 0n,
    eligible = 0n,
    related = 0n,
    synthetic = 0n,
    incomplete = 0n;
  const assessments: Array<{ id: string; exclusion: Exclusion | null; reasons: string[] }> = [];
  for (const payment of window.payments) {
    if (payment.chainId !== window.chainId || normalize(payment.account) !== normalize(window.account))
      throw new Error('Payment belongs to another stream or network');
    if (seen.has(payment.id)) continue;
    seen.add(payment.id);
    if (payment.timestamp < window.from || payment.timestamp >= window.to) continue;
    if (!/^\d+$/.test(payment.amount)) throw new Error('Amount must be an unsigned integer string');
    const amount = BigInt(payment.amount);
    if (amount === 0n) continue;
    raw += amount;
    const day = Math.floor(payment.timestamp / DAY);
    const entry = daily.get(day) ?? { raw: 0n, eligible: 0n };
    entry.raw += amount;
    let exclusion: Exclusion | null = null;
    // Mutually exclusive waterfall; preserve every underlying reason separately.
    if (payment.synthetic) {
      synthetic += amount;
      exclusion = 'synthetic';
    } else if (payment.related) {
      related += amount;
      exclusion = 'related';
    } else if (!payment.evidenceComplete) {
      incomplete += amount;
      exclusion = 'incomplete';
    } else {
      eligible += amount;
      entry.eligible += amount;
      const payer = normalize(payment.controlCluster ?? payment.payer);
      payerTotals.set(payer, (payerTotals.get(payer) ?? 0n) + amount);
    }
    daily.set(day, entry);
    assessments.push({ id: payment.id, exclusion, reasons: payment.reasons });
  }
  const payerCap = eligible / 10n;
  let adjusted = 0n,
    sumSquares = 0n;
  for (const amount of payerTotals.values()) {
    adjusted += amount < payerCap ? amount : payerCap;
    sumSquares += amount * amount;
  }
  const hhi = eligible === 0n ? null : ratio(sumSquares, eligible * eligible);
  const distinctPayers = [...payerTotals.values()].filter((a) => a >= policy.minPayerAmount).length;
  const daysActive = [...daily.values()].filter((d) => d.eligible >= policy.minDayAmount).length;
  const reasons: string[] = [];
  if (!window.coverageComplete) reasons.push('incomplete_chain_history');
  if (window.to - window.from < 30 * DAY) reasons.push('less_than_30_days');
  if (incomplete > 0n) reasons.push('incomplete_required_screening');
  if (eligible === 0n) reasons.push('no_eligible_revenue');
  const previewScore =
    eligible === 0n
      ? 0
      : Math.round(
          40 * Math.min(1, ratio(adjusted, 100_000_000n)) +
            20 * (1 - (hhi ?? 1)) +
            20 * Math.min(1, distinctPayers / 25) +
            20 * Math.min(1, daysActive / 14),
        );
  return {
    policyVersion: policy.version,
    chainId: window.chainId,
    account: window.account,
    asOfBlock: window.block,
    asOfBlockHash: window.blockHash,
    from: window.from,
    to: window.to,
    coverageComplete: window.coverageComplete,
    rawRevenue: raw.toString(),
    eligibleRevenue: eligible.toString(),
    concentrationAdjustedRevenue: adjusted.toString(),
    relatedExcluded: related.toString(),
    syntheticExcluded: synthetic.toString(),
    incompleteExcluded: incomplete.toString(),
    concentrationHaircut: (eligible - adjusted).toString(),
    hhi,
    relatedShare: raw === 0n ? null : ratio(related, raw),
    distinctPayers,
    daysActive,
    score: reasons.length ? null : previewScore,
    previewScore,
    recommendationReady: reasons.length === 0,
    unavailableReasons: reasons,
    assessments,
    daily: [...daily.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([day, v]) => ({ day, raw: v.raw.toString(), eligible: v.eligible.toString() })),
  };
}

/** Advisory only. Uses a complete trailing 30-day input, never extrapolates short samples. */
export function suggestRaise(
  score: ReturnType<typeof calculateScore>,
  revenueBps: number,
  termSeconds: number,
  capMultipleBps: number,
): string | null {
  if (
    !Number.isInteger(revenueBps) ||
    revenueBps <= 0 ||
    revenueBps > 5000 ||
    !Number.isSafeInteger(termSeconds) ||
    termSeconds <= 0 ||
    !Number.isInteger(capMultipleBps) ||
    capMultipleBps < 10000
  )
    throw new Error('Invalid financing terms');
  if (!score.recommendationReady || score.to - score.from !== 30 * DAY) return null;
  return (
    (BigInt(score.concentrationAdjustedRevenue) * BigInt(revenueBps) * BigInt(termSeconds) * 7000n) /
    (BigInt(30 * DAY) * BigInt(capMultipleBps) * 10000n)
  ).toString();
}

export interface Receipt {
  id: string;
  chainId: number;
  account: string;
  from: string;
  amount: string;
  txHash: string;
  blockHash: string;
  logIndex: number;
}
export interface Attribution {
  receiptId: string;
  source: 'native' | 'x402' | 'transfer';
  payer: string;
  amount: string;
  evidenceId: string;
}
/** One physical receipt may have multiple explicit allocations but never be counted twice. */
export function reconcileReceipts(receipts: Receipt[], attributions: Attribution[]) {
  const ledger = new Map<string, { amount: bigint; attributed: bigint }>();
  for (const receipt of receipts) {
    if (!/^\d+$/.test(receipt.amount)) throw new Error('Invalid receipt amount');
    const old = ledger.get(receipt.id);
    if (old && old.amount !== BigInt(receipt.amount)) throw new Error('Conflicting duplicate receipt');
    if (!old) ledger.set(receipt.id, { amount: BigInt(receipt.amount), attributed: 0n });
  }
  const usedEvidence = new Set<string>();
  for (const a of attributions) {
    if (usedEvidence.has(a.evidenceId)) continue;
    usedEvidence.add(a.evidenceId);
    if (!/^\d+$/.test(a.amount)) throw new Error('Invalid attribution amount');
    const record = ledger.get(a.receiptId);
    if (!record) throw new Error('Attribution has no physical receipt');
    record.attributed += BigInt(a.amount);
    if (record.attributed > record.amount) throw new Error('Source attribution exceeds receipt');
  }
  let inbound = 0n,
    recognized = 0n;
  for (const r of ledger.values()) {
    inbound += r.amount;
    recognized += r.attributed;
  }
  return {
    inbound: inbound.toString(),
    recognized: recognized.toString(),
    unattributed: (inbound - recognized).toString(),
  };
}
