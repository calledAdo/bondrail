import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTestIndexer, type Address, type TestIndexerProcessConfig } from 'envio';
import { COVENANT, FACTORY, INDEXED_ASSET, START_BLOCK } from '../src/deployment';
import '../src/handlers/bondrail';

type Event = NonNullable<NonNullable<TestIndexerProcessConfig['chains'][10143]>['simulate']>[number];
const account = '0x1111111111111111111111111111111111111111';
const payer = '0x2222222222222222222222222222222222222222';
const issuer = '0x3333333333333333333333333333333333333333';
const project = '0x4444444444444444444444444444444444444444';
const otherAccount = '0x5555555555555555555555555555555555555555';
const otherAsset = '0x6666666666666666666666666666666666666666';
const zero = `0x${'00'.repeat(20)}` as const;
const nonce = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
const transaction = { hash: `0x${'ab'.repeat(32)}` };
const block = { number: START_BLOCK, timestamp: 1_800_000_000, hash: `0x${'cd'.repeat(32)}` };
const created = (a: Address = account, asset: Address = INDEXED_ASSET): Event => ({ contract: 'BondrailFactory', event: 'AccountCreated', srcAddress: FACTORY,
  params: { issuer, account: a, asset } });
const revenue = (collected = true, amount = 10n, a: Address = account): Event => ({ contract: 'BondrailAccount', event: 'Revenue', srcAddress: a,
  params: { bond: zero, payer: collected ? payer : zero, amount, toBond: 2n, toIssuer: amount - 2n, collected }, transaction });
const transfer = (amount = 10n, a: Address = account): Event => ({ contract: 'USDC', event: 'Transfer', srcAddress: INDEXED_ASSET,
  params: { from: payer, to: a, value: amount }, transaction: { ...transaction, to: account } });
const authorized = (n = 1): Event => ({ contract: 'USDC', event: 'AuthorizationUsed', srcAddress: INDEXED_ASSET,
  params: { authorizer: payer, nonce: nonce(n) }, transaction });
const settled = (n = 1, amount = 10n, a: Address = account): Event => ({ contract: 'BondrailAccount', event: 'Settled', srcAddress: a,
  params: { payer, value: amount, nonce: nonce(n) }, transaction });

async function run(events: Event[]) {
  const db = createTestIndexer();
  await db.process({ chains: { 10143: { startBlock: block.number, endBlock: block.number,
    simulate: events.map((event, logIndex) => ({ ...event, block, logIndex })) } } });
  return db;
}

test('account settlement counts Transfer + Settled + collected Revenue exactly once', async () => {
  const db = await run([created(), authorized(), transfer(), settled(), revenue()]);
  const payments = await db.Payment.getAll();
  assert.equal(payments.length, 1);
  assert.equal(payments[0].source, 'x402');
  assert.equal(payments[0].payer, payer);
  assert.equal(payments[0].amount, 10n);
  assert.equal((await db.Receipt.getAll()).length, 1);
  assert.equal((await db.Split.getAll()).length, 1);
  const i = await db.Issuer.getOrThrow(account);
  assert.deepEqual([i.grossRevenue, i.payments, i.volume, i.toInvestors, i.toIssuer], [10n, 1, 10n, 2n, 8n]);
  const daily = (await db.DailyRevenue.getAll())[0];
  assert.deepEqual([daily.gross, daily.verified, daily.x402, daily.payments], [10n, 10n, 10n, 1]);
  assert.equal((await db.PayerTotal.getAll())[0].payments, 1);
  assert.equal((await db.AccountSettlement.getAll()).length, 0);
});

test('batched identical payments with distinct nonces each count once', async () => {
  const db = await run([created(), authorized(1), transfer(), settled(1), revenue(), authorized(2), transfer(), settled(2), revenue()]);
  assert.equal((await db.Payment.getAll()).length, 2);
  assert.equal((await db.Issuer.getOrThrow(account)).grossRevenue, 20n);
  assert.equal((await db.Issuer.getOrThrow(account)).volume, 20n);
});

test('settlement marker does not swallow a subsequent Native payment in the same transaction', async () => {
  const db = await run([created(), { contract: 'BondrailAccount', event: 'ProjectBound', srcAddress: account, params: { project } },
    authorized(), transfer(), settled(), revenue(),
    { contract: 'BondrailAccount', event: 'Collected', srcAddress: account, params: { payer, gross: 100n, fee: 10n, outgoing: false } }, revenue()]);
  const payments = await db.Payment.getAll();
  assert.deepEqual(payments.map(p => p.source).sort(), ['native', 'x402']);
  const i = await db.Issuer.getOrThrow(account);
  assert.deepEqual([i.grossRevenue, i.volume, i.payments], [20n, 110n, 2]);
});

test('direct token authorization remains counted once when later swept; later ordinary transfer stays unclassified', async () => {
  const db = await run([created(), authorized(), transfer(), transfer(20n), revenue(false, 30n)]);
  const payments = await db.Payment.getAll();
  assert.deepEqual(payments.map(p => p.source).sort(), ['transfer', 'x402']);
  assert.equal((await db.Issuer.getOrThrow(account)).grossRevenue, 30n);
  const daily = (await db.DailyRevenue.getAll())[0];
  assert.deepEqual([daily.verified, daily.x402], [10n, 10n]);
});

test('multiple accounts and indirect transaction entrypoints correlate by account and nonce', async () => {
  const events = [created(), created(otherAccount), authorized(1), transfer(), settled(1), revenue(),
    authorized(2), transfer(10n, otherAccount), settled(2, 10n, otherAccount), revenue(true, 10n, otherAccount)];
  const db = await run(events.map(e => e.contract === 'USDC' && e.event === 'Transfer' ? { ...e, transaction: { ...transaction, to: project } } : e));
  assert.equal((await db.Payment.getAll()).length, 2);
  assert.equal((await db.Issuer.getOrThrow(account)).payments, 1);
  assert.equal((await db.Issuer.getOrThrow(otherAccount)).payments, 1);
});

test('unindexed account asset uses Settled as evidence and ignores unrelated USDC transfers', async () => {
  const db = await run([created(account, otherAsset), authorized(), transfer(), settled(), revenue()]);
  const payments = await db.Payment.getAll();
  assert.equal(payments.length, 1);
  assert.equal(payments[0].source, 'x402');
  assert.equal((await db.Issuer.getOrThrow(account)).grossRevenue, 10n);
});

test('issuer-funded payer is counted once but excluded from attributed revenue', async () => {
  const db = await run([created(), { contract: 'USDC', event: 'Transfer', srcAddress: INDEXED_ASSET,
    params: { from: issuer, to: payer, value: 100n }, transaction }, authorized(), transfer(), settled(), revenue()]);
  const payment = (await db.Payment.getAll())[0];
  assert.equal(payment.related, true);
  assert.deepEqual(payment.reasons, ['funded_by_issuer_treasury']);
  const daily = (await db.DailyRevenue.getAll())[0];
  assert.deepEqual([daily.gross, daily.verified, daily.x402, daily.payments], [10n, 0n, 0n, 1]);
});

test('bond trigger flag starts false, steps up, and clears on recovery without changing its pool', async () => {
  const bond = '0x7777777777777777777777777777777777777777' as const;
  const bondCreated: Event = { contract: 'BondrailFactory', event: 'BondCreated', srcAddress: FACTORY,
    params: { issuer, account, bond, adapter: 0n, policyHash: nonce(1), termsHash: nonce(2) }, transaction };
  const changed = (triggered: boolean): Event => ({ contract: 'BondrailBond', event: 'TriggerChanged', srcAddress: bond,
    params: { triggered }, transaction });
  for (const states of [[], [true], [true, false], [true, false, true]]) {
    const db = await run([created(), bondCreated, ...states.map(changed)]);
    const b = await db.Bond.getOrThrow(bond);
    assert.equal(b.triggered, states.at(-1) ?? false);
    assert.equal(b.pool, 0n);
    assert.equal(b.defaulted, false);
    const events = await db.ChainEvent.getAll();
    assert.deepEqual(events.map(e => e.kind), ['Created', ...states.map(s => s ? 'Triggered' : 'TriggerRecovered')]);
  }
});

test('configured covenant records observations and default history', async () => {
  const bond = '0x7777777777777777777777777777777777777777' as const;
  const db = await run([
    { contract: 'BondrailCovenant', event: 'ObservationAccepted', srcAddress: COVENANT,
      params: { bond, epoch: 1n, result: 2n, observedAt: BigInt(block.timestamp), evidenceHash: nonce(1), digest: nonce(2) }, transaction },
    { contract: 'BondrailCovenant', event: 'CovenantDefault', srcAddress: COVENANT,
      params: { bond, firstEpoch: 1n, secondEpoch: 2n, evidenceHash: nonce(1) }, transaction },
  ]);
  const observations = await db.CovenantCheck.getAll();
  assert.equal(observations.length, 1);
  assert.equal(observations[0].bond, bond);
  assert.equal(observations[0].result, 2);
  assert.equal(observations[0].epoch, 1n);
  assert.deepEqual((await db.ChainEvent.getAll()).map(e => e.kind), ['CovenantDefault']);
});
