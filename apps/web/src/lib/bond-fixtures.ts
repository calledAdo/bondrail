// Deterministic, synthetic review data; never used by the live protocol loader.
import type { AccountView, BondView } from './protocol';
export const FIXTURE_NOW = Date.UTC(2026, 9, 16, 12) / 1000;
const DAY = 86400;
const asset = { address: '0x1111111111111111111111111111111111111111', symbol: 'USDC', decimals: 6, known: true } as const;
export const fixtureAccount: AccountView = {
  address: '0x2222222222222222222222222222222222222222', issuer: '0x3333333333333333333333333333333333333333',
  tier: 'Native', project: '0x4444444444444444444444444444444444444444', reviewed: true, nativeReview: 'template', asset,
  revenue: 1000, verified: 840, payments: 80, uniquePayers: 8, topPayerShare: 0.2, ageDays: 28,
  firstRevenueAt: FIXTURE_NOW - 28 * DAY, verifiedDaily: 40, toInvestors: 200, bonds: [], revenueDrop: null,
  payers: Array.from({ length: 8 }, (_, i) => ({ payer: `0x${String(i + 10).padStart(40, '0')}`, amount: 120 - i * 5, payments: 10, related: i === 7, reasons: i === 7 ? ['issuer_wallet'] : [], source: 'native' })),
  daily: Array.from({ length: 28 }, (_, i) => ({ day: Math.floor(FIXTURE_NOW / DAY) - 27 + i, raw: 30 + i, verified: 20 + i })),
  profile: { profile: { account: '0x2222222222222222222222222222222222222222', name: 'Fixture Studio', description: 'A small business selling paid data tools.', website: '', x: '', useOfFunds: 'Improve the service.', updatedAt: String(FIXTURE_NOW) }, signature: '0x00', signer: '0x3333333333333333333333333333333333333333', domainVerified: false, checkedAt: FIXTURE_NOW },
};
const base: BondView = {
  address: '0x5555555555555555555555555555555555555555', account: fixtureAccount.address, name: 'Fixture Studio', symbol: 'FIX',
  tier: 'Native', phase: 'Active', defaulted: false, asset, raise: 1000, raised: 1000, cap: 1500, effectiveCap: 750,
  released: 500, undrawn: 500, recovery: 0, collected: 200, pool: 200, supply: 1000, stake: 100, backingPerToken: 0.2,
  revenueShare: 25, baseRevenueShare: 25, triggerRevenue: 100, triggerWindowDays: 7, stepUpShare: 50, triggered: false,
  firstReleasePct: 50, minFeeBps: 100, milestoneMode: 'Onchain', minRevenue: 1000, minOperatingPeriod: 7 * DAY,
  fundingDeadline: FIXTURE_NOW + DAY, secondReleaseNotBefore: FIXTURE_NOW + 7 * DAY, secondReleaseDeadline: FIXTURE_NOW + 14 * DAY,
  maturity: FIXTURE_NOW + 90 * DAY, createdAt: FIXTURE_NOW - 10 * DAY, activationTime: FIXTURE_NOW - 7 * DAY,
  depositAllowed: true, multiple: 1.5, coverage: 1.64, paybackDays: 55, atRiskPct: 50, flags: [], checks: [],
  policyHash: `0x${'a'.repeat(64)}`, source: fixtureAccount.project,
};
export const bondFixtures = {
  Funding: { ...base, phase: 'Funding', raised: 400, released: 0, undrawn: 0, collected: 0, pool: 0, supply: 400, backingPerToken: 0, activationTime: 0 } as BondView,
  'Funding-paused': { ...base, phase: 'Funding', raised: 400, released: 0, undrawn: 0, collected: 0, pool: 0, supply: 400, backingPerToken: 0, activationTime: 0, depositAllowed: false } as BondView,
  Active: base,
  'Active-triggered': { ...base, triggered: true, revenueShare: 50 },
  'Active-defaulted': { ...base, tier: 'Watched', defaulted: true, defaultedAt: FIXTURE_NOW - DAY, undrawn: 0, recovery: 600, pool: 800, backingPerToken: 0.8 } as BondView,
  Closing: { ...base, tier: 'Watched', phase: 'Closing', collected: 750, pool: 1250, undrawn: 0, recovery: 500, backingPerToken: 1.25, collectionClosedAt: FIXTURE_NOW - 30, settleAfter: FIXTURE_NOW + 90 } as BondView,
  Closed: { ...base, phase: 'Closed', collected: 750, pool: 1250, undrawn: 0, recovery: 500, backingPerToken: 1.25, collectionClosedAt: FIXTURE_NOW - DAY } as BondView,
  Cancelled: { ...base, phase: 'Cancelled', raised: 400, released: 0, undrawn: 0, collected: 0, pool: 0, supply: 400, backingPerToken: 0, activationTime: 0 } as BondView,
} satisfies Record<string, BondView>;
export type FixturePhase = keyof typeof bondFixtures;
export const marketFixture: BondView = { ...base, kuru: { bond: base.address, market: '0x6666666666666666666666666666666666666666', vault: '0x7777777777777777777777777777777777777777', tx: `0x${'b'.repeat(64)}` } };
