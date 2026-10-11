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
