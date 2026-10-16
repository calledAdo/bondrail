import test from 'node:test';
import assert from 'node:assert/strict';
import { accountQuery, accountBondsQuery, bondQuery, checksQuery, indexedBacking, assembleAccounts, assembleBond, emptyIndex, type IndexedBond, type BondMetadata } from './protocol-data';
import { fixtureAccount } from './bond-fixtures';

const row: IndexedBond = {
  id: '0x5555555555555555555555555555555555555555', account: fixtureAccount.address, adapter: 0,
  phase: 1, raised: '1000000000', released: '500000000', undrawn: '500000000', principalRecovery: '0',
  revenueCollected: '200000000', stakeRecovery: '0', pool: '200000001', totalSupply: '300000000',
  effectiveCap: '0', defaulted: false, triggered: false, createdAt: '100',
};

test('backing uses indexed base units with contract precision, including zero supply and burned claims', () => {
  assert.equal(indexedBacking(row), 0.666666);
  assert.equal(indexedBacking({ pool: '1234567890000000000000', totalSupply: '1000000000000000000000' }), 1.234567);
  assert.equal(indexedBacking({ pool: '10', totalSupply: '0' }), 0);
});
test('scoped queries apply filters to every entity, including account evidence and covenant checks', () => {
  for (const [query, entities] of [[bondQuery, ['Bond', 'Issuer']], [accountQuery, ['Issuer','DailyRevenue','PayerTotal']], [accountBondsQuery, ['Bond']], [checksQuery, ['CovenantCheck']]] as const) {
    for (const entity of entities) assert.match(query, new RegExp(`${entity}\\(where:.*_eq: \\$address`));
  }
  assert.ok(!accountQuery.includes('Bond(')); // Opening one bond must not load that account's other bonds.
});
test('unknown asset metadata never silently uses six-decimal USD; accounts assemble without RPC reviews', () => {
  const data = { ...emptyIndex, Issuer: [{ id: row.account, issuer: fixtureAccount.issuer, asset: fixtureAccount.asset.address, grossRevenue: '1000000', toInvestors: '0', payments: 1 }] };
  assert.deepEqual(assembleAccounts(data, new Map()), []);
  const [account] = assembleAccounts(data, new Map([[fixtureAccount.asset.address, fixtureAccount.asset]]));
  assert.equal(account.revenue, 1);
  assert.equal(account.nativeReview, 'unknown');
});
test('zero effective cap is not replaced with the full cap, and optional RPC failures retain the bond', () => {
  const metadata: BondMetadata = { name: 'Studio Revenue Claim', symbol: 'FIX', terms: {
    raiseAmount: 1000000000n, repayCap: 1500000000n, stake: 0n, minRevenue: 1000000000n,
    fundingDeadline: 200n, maturity: 500n, secondReleaseNotBefore: 300n, secondReleaseDeadline: 400n,
    minOperatingPeriod: 0, revenueBps: 2500, firstReleaseBps: 5000, milestoneMode: 0, minFeeBps: 0,
    triggerWindowDays: 0, stepUpBps: 0, triggerRevenue: 0n,
  } };
  const b = assembleBond(row, fixtureAccount, metadata);
  assert.equal(b.cap, 1500);
  assert.equal(b.effectiveCap, 0);
  assert.equal(b.backingPerToken, 0.666666);
  assert.equal(b.depositAllowed, undefined);
  assert.equal(b.activationTime, undefined);
  const withoutEvidence = assembleBond({ ...row, effectiveCap: '750000000' }, { ...fixtureAccount, uniquePayers: 0 }, metadata, {}, [], undefined, 100, false);
  assert.equal(withoutEvidence.raise, 1000);
  assert.equal(withoutEvidence.coverage, null);
  assert.equal(withoutEvidence.paybackDays, null);
  assert.ok(!withoutEvidence.flags.includes('Fewer than two attributed payers'));
});
