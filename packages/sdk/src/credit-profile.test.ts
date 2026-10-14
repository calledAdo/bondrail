import assert from 'node:assert/strict';
import { test } from 'node:test';
import { creditAttestationLabel, getCreditProfile, indexedCreditMetrics, type CreditProfile } from './credit.ts';
import { zeroAddress } from 'viem';
const registry = '0x1111111111111111111111111111111111111111';
const account = '0x2222222222222222222222222222222222222222';

test('profile reader pins both layers and current attester to one block', async () => {
  const calls: { functionName: string; blockNumber: bigint; args?: readonly unknown[]; address: string }[] = [];
  const client = {
    getBlockNumber: async () => 42n,
    readContract: async (request: typeof calls[number]) => {
      calls.push(request);
      if (request.functionName === 'onchainProfile') return { issuer: account, bondsCreated: 2n, complete: false, repayment: { bondsIssued: 1n } };
      if (request.functionName === 'attestedProfile') return [{ evidenceHash: '0x01' }, registry, false];
      return account;
    },
  } as unknown as Parameters<typeof getCreditProfile>[0];
  const result = await getCreditProfile(client, registry, account);
  assert.equal(result.blockNumber, 42n);
  assert.equal(result.attested.valid, false);
  assert.equal(result.attested.signer, registry);
  assert.equal(result.currentAttester, account);
  assert.equal(result.onchain.bondsCreated, 2n);
  assert.equal(result.onchain.repayment.bondsIssued, 1n);
  assert.equal(result.onchain.complete, false);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => c.blockNumber === 42n && c.address === registry));
  assert.deepEqual(calls.filter(c => c.args).map(c => c.args), [[account], [account]]);
});

test('attestation labels distinguish previous signers, expiry, absent and valid current assessments', () => {
  const profile: Pick<CreditProfile, 'attested' | 'currentAttester'> = { currentAttester: registry,
    attested: { signer: registry, valid: true, attestation: { account, chainId: 31337n,
      periodStart: 1n, periodEnd: 2n, attributedRevenue: 0n, excludedRevenue: 0n,
      distinctPayers: 0n, topPayerShareBps: 0, creditLine: 0n, evidenceHash: `0x${'ab'.repeat(32)}`,
      issuedAt: 2n, expiresAt: 100n, nonce: 1n } } };
  assert.equal(creditAttestationLabel(profile, 99n), 'Valid current attester signature');
  assert.equal(creditAttestationLabel(profile, 100n), 'Expired');
  profile.currentAttester = account;
  profile.attested.valid = false;
  assert.equal(creditAttestationLabel(profile, 99n), 'Signed by a previous attester — not valid');
  assert.equal(creditAttestationLabel(profile, 100n), 'Signed by a previous attester — not valid');
  profile.attested.signer = account;
  assert.equal(creditAttestationLabel(profile, 99n), 'Not valid');
  profile.attested.valid = true;
  assert.equal(creditAttestationLabel(profile, 99n), 'Valid current attester signature');
  profile.attested.signer = zeroAddress;
  assert.equal(creditAttestationLabel(profile, 99n), 'No attestation');
});

test('profile read errors propagate instead of returning synthetic zero credit', async () => {
  const client = { getBlockNumber: async () => 42n, readContract: async () => { throw new Error('offline'); } } as unknown as Parameters<typeof getCreditProfile>[0];
  await assert.rejects(getCreditProfile(client, registry, account), /offline/);
});

test('shared metrics exclude related payers and future/old buckets, with conservative concentration rounding', () => {
  const result = indexedCreditMetrics({ now: 40 * 86400, firstRevenueAt: 86400,
    payers: [{ amount: 1n, related: false }, { amount: 1n, related: false }, { amount: 1n, related: false }, { amount: 20n, related: true }],
    daily: [{ day: 33, verified: 999n }, { day: 34, verified: 3n }, { day: 40, verified: 4n }, { day: 41, verified: 999n }] });
  assert.equal(result.attributedRevenue, 3n); assert.equal(result.excludedRevenue, 20n);
  assert.equal(result.distinctPayers, 3); assert.equal(result.topPayerShareBps, 3334);
  assert.equal(result.recentRevenue, 7n); assert.equal(result.rateDays, 7);
});
