import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexer, createTestIndexer, type TestIndexerProcessConfig } from 'envio';
import { getContractAddress } from 'viem';
import { CREDIT_REGISTRY, FACTORY, START_BLOCK } from '../src/deployment';
import '../src/handlers/bondrail';

type Event = NonNullable<NonNullable<TestIndexerProcessConfig['chains'][10143]>['simulate']>[number];
const registry = CREDIT_REGISTRY ?? getContractAddress({ from: FACTORY, nonce: 1n }).toLowerCase() as `0x${string}`;
const other = getContractAddress({ from: registry, nonce: 1n }).toLowerCase() as `0x${string}`;
// Only discover the extra registry used to test registry-qualified membership (or the
// primary fixture when no registry is configured). Configured addresses use normal routing.
indexer.contractRegister({ contract: 'BondrailCreditRegistry', event: 'BondRecorded', wildcard: true }, async ({ event, context }) => {
  if (event.srcAddress.toLowerCase() === other || !CREDIT_REGISTRY) {
    context.chain.BondrailCreditRegistry.add(event.srcAddress);
  }
});
const account = '0x3333333333333333333333333333333333333333';
const bond = '0x4444444444444444444444444444444444444444';
const signer = '0x5555555555555555555555555555555555555555';
const transaction = { hash: `0x${'ab'.repeat(32)}` };
const block = { number: START_BLOCK, timestamp: 1_800_000_000, hash: `0x${'cd'.repeat(32)}` };
function attested(nonce: bigint, srcAddress: `0x${string}` = registry): Event {
  return { contract: 'BondrailCreditRegistry', event: 'Attested', srcAddress, transaction,
    params: { account, signer, chainId: 10143n, periodStart: 1n, periodEnd: 100n + nonce,
      attributedRevenue: 800n, excludedRevenue: 200n, distinctPayers: 3n, topPayerShareBps: 3750n,
      creditLine: 300n, evidenceHash: `0x${'ef'.repeat(32)}`, issuedAt: 101n + nonce, expiresAt: 300n,
      nonce } };
}

test('registry events preserve history, latest signature and registry-qualified membership', async () => {
  const db = createTestIndexer();
  const events: Event[] = [
    { contract: 'BondrailCreditRegistry', event: 'BondRecorded', srcAddress: registry, params: { account, bond }, transaction },
    { contract: 'BondrailCreditRegistry', event: 'BondRecorded', srcAddress: other, params: { account, bond }, transaction },
    attested(1n), attested(2n), attested(1n, other),
  ];
  await db.process({ chains: { 10143: { startBlock: block.number, endBlock: block.number,
    simulate: events.map((e, logIndex) => ({ ...e, block, logIndex })) } } });
  assert.equal((await db.CreditBond.getAll()).length, 2);
  assert.equal((await db.CreditAttestation.getAll()).length, 3);
  const key = `10143:${registry}:${account}`;
  assert.equal((await db.LatestCreditAttestation.getOrThrow(key)).attestation_id, `${key}:2`);
  const latest = await db.CreditAttestation.getOrThrow(`${key}:2`);
  assert.equal(latest.signer, signer);
  assert.equal(latest.attributedRevenue, 800n);
  assert.equal(latest.expiresAt, 300n); // store expiry; do not persist a stale "valid" boolean
  assert.equal((await db.LatestCreditAttestation.getAll()).length, 2);
});
