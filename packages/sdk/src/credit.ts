import { zeroAddress, type Address, type ContractFunctionReturnType, type PublicClient } from 'viem';
import { bondrailCreditRegistryAbi } from './abis';

// Credit line: the largest raise an account's own history supports, priced on that history.
//
// Investors are repaid only from a share of future revenue, so the question is how much capital the
// expected repayment covers with a margin. Expected repayment over the term is the attributed revenue
// rate times the investor share times the term, discounted by how much the history can be trusted:
//   - stress:          revenue may fall (fixed haircut);
//   - history:         a short history says little (full weight after `fullHistoryDays`);
//   - diversification: one dominant payer can leave (discount grows with the top payer's share).
// The raise is then sized so expected repayment covers the repay cap `targetCoverage` times.
// Attributed revenue only: issuer-funded and unclassified inflows never count.

export interface CreditInput {
  /** Attributed (verified) revenue per day, in asset units. */
  revenuePerDay: number;
  /** Age of the history in days (since the first booked payment). */
  ageDays: number;
  uniquePayers: number;
  /** Share of attributed revenue from the largest payer, 0..1. */
  topPayerShare: number;
}

export interface CreditTerms {
  revenueBps: number;
  termDays: number;
  /** Repay cap as a multiple of the raise (e.g. 1.2). */
  capMultiple: number;
  targetCoverage: number;
  stressHaircut: number;
  fullHistoryDays: number;
  minPayers: number;
}

export const defaultCreditTerms: CreditTerms = {
  revenueBps: 2500,
  termDays: 30,
  capMultiple: 1.2,
  targetCoverage: 1.2,
  stressHaircut: 0.7,
  fullHistoryDays: 30,
  minPayers: 3,
};

export interface CreditLine {
  /** Largest raise the history supports under the terms (0 when not eligible). */
  maxRaise: number;
  /** Expected repayment to investors over the term, after all discounts. */
  expectedRepayment: number;
  factors: { stress: number; history: number; diversification: number };
  eligible: boolean;
  reason?: string;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function creditLine(input: CreditInput, terms: CreditTerms = defaultCreditTerms): CreditLine {
  const { revenueBps, termDays, capMultiple, targetCoverage, stressHaircut, fullHistoryDays, minPayers } = terms;
  if (revenueBps <= 0 || revenueBps > 5000 || termDays <= 0 || capMultiple < 1 || targetCoverage <= 0)
    throw new Error('Invalid credit terms');
  const factors = {
    stress: clamp01(stressHaircut),
    history: clamp01(input.ageDays / fullHistoryDays),
    // No discount up to a 25% top-payer share, falling linearly to zero at 100%.
    diversification: clamp01(1 - Math.max(0, input.topPayerShare - 0.25) / 0.75),
  };
  const expectedRepayment =
    Math.max(0, input.revenuePerDay) * (revenueBps / 10_000) * termDays * factors.stress * factors.history * factors.diversification;
  const reason =
    input.revenuePerDay <= 0
      ? 'No attributed revenue yet'
      : input.uniquePayers < minPayers
        ? `Needs at least ${minPayers} distinct payers`
        : undefined;
  const eligible = reason === undefined;
  return {
    maxRaise: eligible ? expectedRepayment / (capMultiple * targetCoverage) : 0,
    expectedRepayment,
    factors,
    eligible,
    reason,
  };
}

/** Shared with the web and attester: lifetime payer attribution, seven UTC buckets for rate. */
export function indexedCreditMetrics(input: {
  now: number;
  firstRevenueAt?: number;
  payers: readonly { amount: bigint; related: boolean }[];
  daily: readonly { day: number; verified: bigint }[];
}) {
  const eligible = input.payers.filter((p) => !p.related && p.amount > 0n);
  const attributedRevenue = eligible.reduce((sum, p) => sum + p.amount, 0n);
  const excludedRevenue = input.payers.filter((p) => p.related).reduce((sum, p) => sum + p.amount, 0n);
  const largest = eligible.reduce((max, p) => p.amount > max ? p.amount : max, 0n);
  const topPayerShare = attributedRevenue ? Number(largest) / Number(attributedRevenue) : 0;
  const topPayerShareBps = attributedRevenue ? Number((largest * 10_000n + attributedRevenue - 1n) / attributedRevenue) : 0;
  const ageDays = input.firstRevenueAt ? Math.max(0, (input.now - input.firstRevenueAt) / 86_400) : 0;
  const today = Math.floor(input.now / 86_400);
  const recentRevenue = input.daily.filter((d) => d.day > today - 7 && d.day <= today)
    .reduce((sum, d) => sum + d.verified, 0n);
  const rateDays = Math.min(7, Math.max(1, ageDays));
  // creditLine is linear in revenue. Compute its coefficient, then floor to 12 decimal places
  // before applying to bigint base units, avoiding a lossy conversion of large token amounts.
  const coefficient = creditLine({ revenuePerDay: 1 / rateDays, ageDays,
    uniquePayers: eligible.length, topPayerShare }).maxRaise;
  const creditLineAmount = recentRevenue * BigInt(Math.floor(coefficient * 1e12)) / 1_000_000_000_000n;
  return { attributedRevenue, excludedRevenue, distinctPayers: eligible.length, topPayerShare,
    topPayerShareBps, ageDays, recentRevenue, rateDays, creditLine: creditLineAmount };
}

export type OnchainCreditProfile = ContractFunctionReturnType<typeof bondrailCreditRegistryAbi, 'view', 'onchainProfile'>;
export type CreditAttestation = ContractFunctionReturnType<typeof bondrailCreditRegistryAbi, 'view', 'attestedProfile'>[0];
export interface CreditProfile {
  blockNumber: bigint;
  onchain: OnchainCreditProfile;
  /** valid requires the current attester and unexpired chain time; history remains readable. */
  attested: { attestation: CreditAttestation; signer: Address; valid: boolean };
  currentAttester: Address;
}

/** Label a stored assessment without presenting a previous signer as current or merely expired. */
export function creditAttestationLabel(profile: Pick<CreditProfile, 'attested' | 'currentAttester'>, now: bigint): string {
  const { attestation, signer, valid } = profile.attested;
  if (signer.toLowerCase() === zeroAddress) return 'No attestation';
  if (signer.toLowerCase() !== profile.currentAttester.toLowerCase()) return 'Signed by a previous attester — not valid';
  if (attestation.expiresAt <= now) return 'Expired';
  return valid ? 'Valid current attester signature' : 'Not valid';
}

export const creditAttestationTypes = {
  CreditAttestation: [
    { name: 'account', type: 'address' }, { name: 'chainId', type: 'uint256' },
    { name: 'periodStart', type: 'uint64' }, { name: 'periodEnd', type: 'uint64' },
    { name: 'attributedRevenue', type: 'uint256' }, { name: 'excludedRevenue', type: 'uint256' },
    { name: 'distinctPayers', type: 'uint256' }, { name: 'topPayerShareBps', type: 'uint16' },
    { name: 'creditLine', type: 'uint256' }, { name: 'evidenceHash', type: 'bytes32' },
    { name: 'issuedAt', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;
export const creditAttestationDomain = (chainId: number, registry: Address) =>
  ({ name: 'BondrailCreditRegistry', version: '1', chainId, verifyingContract: registry } as const);

/** Both layers and signer policy at the same block; RPC/contract failures are surfaced. */
export async function getCreditProfile(
  client: Pick<PublicClient, 'getBlockNumber' | 'readContract'>, registry: Address, account: Address,
): Promise<CreditProfile> {
  const blockNumber = await client.getBlockNumber();
  const base = { address: registry, abi: bondrailCreditRegistryAbi, blockNumber } as const;
  const [onchain, [attestation, signer, valid], currentAttester] = await Promise.all([
    client.readContract({ ...base, functionName: 'onchainProfile', args: [account] }),
    client.readContract({ ...base, functionName: 'attestedProfile', args: [account] }),
    client.readContract({ ...base, functionName: 'attester' }),
  ]);
  return { blockNumber, onchain, attested: { attestation, signer, valid }, currentAttester };
}
