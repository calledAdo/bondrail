import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexer, createTestIndexer, type TestIndexerProcessConfig } from 'envio';
import { getContractAddress } from 'viem';
import { FACTORY, INDEXED_ASSET, START_BLOCK, VAULT_FACTORY, VAULT_FACTORY_START_BLOCK } from '../src/deployment';
import '../src/handlers/bondrail';

type Event = Extract<NonNullable<NonNullable<TestIndexerProcessConfig['chains'][10143]>['simulate']>[number], { contract: 'BondrailVault' | 'BondrailVaultFactory' }>;
const registry = VAULT_FACTORY ?? getContractAddress({ from: FACTORY, nonce: 2n }).toLowerCase() as `0x${string}`;
// Use a new vault so VaultCreated must discover it even when a legacy vault is configured.
const vault = getContractAddress({ from: registry, nonce: 1n }).toLowerCase() as `0x${string}`;
const startBlock = Math.max(START_BLOCK, VAULT_FACTORY_START_BLOCK);
const alice = '0x3333333333333333333333333333333333333333';
const bob = '0x4444444444444444444444444444444444444444';
const zero = '0x0000000000000000000000000000000000000000';
const hash = `0x${'ab'.repeat(32)}`;
// Older configs have no deployed vault factory. Only those need test-only discovery;
// a configured factory must pass Envio's normal address and start-block filters.
if (!VAULT_FACTORY) {
  indexer.contractRegister({ contract: 'BondrailVaultFactory', event: 'VaultCreated', wildcard: true }, async ({ event, context }) => {
    context.chain.BondrailVaultFactory.add(event.srcAddress);
  });
}
test('all vault events index offline with realized daily prices, holdings and transferred cost basis', async () => {
    const db = createTestIndexer();
    const events: Event[] = [
      { contract: 'BondrailVaultFactory', event: 'VaultCreated', srcAddress: registry,
        params: { vault, asset: INDEXED_ASSET, curator: alice, owner: alice, name: 'Credit', symbol: 'CR', strategy: { description: 'Revenue', metadataHash: hash } } },
      { contract: 'BondrailVault', event: 'Transfer', srcAddress: vault, params: { from: zero, to: alice, value: 1000n } },
      { contract: 'BondrailVault', event: 'Deposit', srcAddress: vault, params: { sender: alice, owner: alice, assets: 200n, shares: 1000n } },
      { contract: 'BondrailVault', event: 'Transfer', srcAddress: vault, params: { from: alice, to: bob, value: 400n } },
      { contract: 'BondrailVault', event: 'Transfer', srcAddress: vault, params: { from: bob, to: bob, value: 100n } },
      { contract: 'BondrailVault', event: 'Transfer', srcAddress: vault, params: { from: alice, to: zero, value: 200n } },
      { contract: 'BondrailVault', event: 'Withdraw', srcAddress: vault, params: { sender: alice, owner: alice, receiver: bob, assets: 30n, shares: 200n } },
      { contract: 'BondrailVault', event: 'Allocated', srcAddress: vault, params: { bond: bob, assets: 20n } },
      { contract: 'BondrailVault', event: 'RaiseWithdrawn', srcAddress: vault, params: { bond: bob, assets: 5n } },
      { contract: 'BondrailVault', event: 'Collected', srcAddress: vault, params: { bond: bob, assets: 16n, claims: 15n } },
      { contract: 'BondrailVault', event: 'IncomeCheckpointed', srcAddress: vault, params: { newIncome: 1n, lockedIncome: 1n } },
      { contract: 'BondrailVault', event: 'CuratorProposed', srcAddress: vault, params: { curator: bob, executableAt: 1_800_172_800n } },
      { contract: 'BondrailVault', event: 'CuratorChanged', srcAddress: vault, params: { previousCurator: alice, curator: bob } },
    ];
    await db.process({ chains: { 10143: { startBlock, endBlock: startBlock,
      simulate: events.map((e, logIndex) => ({ ...e, block: { number: startBlock, timestamp: 1_800_000_000, hash }, transaction: { hash }, logIndex })) } } });
    const a = await db.VaultPosition.getOrThrow(`${vault}-${alice}`), b = await db.VaultPosition.getOrThrow(`${vault}-${bob}`);
    assert.equal(a.shares, 400n); assert.equal(a.costBasis, 80n); assert.equal(a.deposited, 200n); assert.equal(a.withdrawn, 30n);
    assert.equal(b.shares, 400n); assert.equal(b.costBasis, 80n);
    const v = await db.Vault.getOrThrow(vault);
    assert.equal(v.registry, registry); assert.equal(v.asset, INDEXED_ASSET);
    assert.equal(v.strategy, 'Revenue'); assert.equal(v.curator, bob); assert.equal(v.pendingCurator, undefined);
    assert.equal(v.totalSupply, 800n);
    assert.equal(v.deposited, 200n); assert.equal(v.withdrawn, 30n);
    assert.equal(v.allocated, 20n); assert.equal(v.raiseWithdrawn, 5n); assert.equal(v.collected, 16n);
    assert.equal(v.income, 1n); assert.equal(v.lockedIncome, 1n);
    assert.deepEqual(v.holdings, []);
    const holding = await db.VaultHolding.getOrThrow(`${vault}-${bob}`);
    assert.equal(holding.active, false); assert.equal(holding.costBasis, 0n); assert.equal(holding.claims, 0n);
    assert.equal(holding.allocated, 20n); assert.equal(holding.collected, 16n); assert.equal(holding.raiseWithdrawn, 5n);
    const activities = await db.VaultActivity.getAll();
    assert.equal(activities.length, 12);
    assert.equal(activities.find(a => a.kind === 'Deposit')!.realizedPrice, 200_000_000_000_000_000n);
    assert.equal(activities.find(a => a.kind === 'Withdraw')!.realizedPrice, 150_000_000_000_000_000n);
    assert.equal(activities.find(a => a.kind === 'IncomeCheckpointed')!.lockedIncome, 1n);
    const [daily] = await db.VaultDailySnapshot.getAll();
    assert.equal(daily.eventCount, 12);
    assert.equal(daily.deposited, 200n); assert.equal(daily.withdrawn, 30n);
    assert.equal(daily.depositedShares, 1000n); assert.equal(daily.withdrawnShares, 200n);
    assert.equal(daily.totalSupply, 800n); assert.equal(daily.allocated, 20n);
    assert.equal(daily.realizedPrice, 150_000_000_000_000_000n);
    assert.equal(daily.realizedPriceKind, 'Withdraw');
    assert.equal(daily.realizedPriceTimestamp, 1_800_000_000n);
    assert.equal(daily.timestamp, 1_800_000_000n);
    const process = async (offset: number, timestamp: number, events: Event[]) => db.process({ chains: { 10143: {
      startBlock: startBlock + offset, endBlock: startBlock + offset,
      simulate: events.map((e, logIndex) => ({ ...e, block: { number: startBlock + offset, timestamp, hash }, transaction: { hash }, logIndex })),
    } } });
    // Two days later: a checkpoint/transfer day has aggregates but no invented price or quiet-day row.
    await process(600, 1_800_172_800, [
      { contract: 'BondrailVault', event: 'IncomeCheckpointed', srcAddress: vault, params: { newIncome: 0n, lockedIncome: 0n } },
      { contract: 'BondrailVault', event: 'Transfer', srcAddress: vault, params: { from: bob, to: bob, value: 1n } },
    ]);
    const days = (await db.VaultDailySnapshot.getAll()).sort((a, b) => a.day - b.day);
    assert.equal(days.length, 2); assert.equal(days[1].day - days[0].day, 2);
    assert.equal(days[1].realizedPrice, undefined); assert.equal(days[1].realizedPriceTimestamp, undefined);
    assert.equal(days[1].deposited, 0n); assert.equal(days[1].withdrawn, 0n);
    assert.equal(days[1].totalSupply, 800n); assert.equal(days[1].lockedIncome, 0n);
    // Re-allocation after collection, repeated allocation, partial and full raise withdrawals.
    await process(601, 1_800_172_801, [
      { contract: 'BondrailVault', event: 'Allocated', srcAddress: vault, params: { bond: bob, assets: 9n } },
      { contract: 'BondrailVault', event: 'Allocated', srcAddress: vault, params: { bond: bob, assets: 6n } },
      { contract: 'BondrailVault', event: 'RaiseWithdrawn', srcAddress: vault, params: { bond: bob, assets: 4n } },
    ]);
    assert.equal((await db.VaultHolding.getOrThrow(`${vault}-${bob}`)).costBasis, 11n);
    assert.deepEqual((await db.Vault.getOrThrow(vault)).holdings, [bob]);
    await process(602, 1_800_172_802, [
      { contract: 'BondrailVault', event: 'RaiseWithdrawn', srcAddress: vault, params: { bond: bob, assets: 11n } },
      // Zero-share malformed events must not divide by zero or overwrite a valid price.
      { contract: 'BondrailVault', event: 'Deposit', srcAddress: vault, params: { sender: alice, owner: alice, assets: 0n, shares: 0n } },
    ]);
    assert.equal((await db.VaultHolding.getOrThrow(`${vault}-${bob}`)).costBasis, 0n);
    assert.deepEqual((await db.Vault.getOrThrow(vault)).holdings, []);
    assert.equal((await db.Vault.getOrThrow(vault)).realizedPrice, daily.realizedPrice);
});

// The statically configured legacy vault emits events before factory registration.
test('legacy events retain basis and totals when registration arrives later', async () => {
  const config = await import('node:fs/promises');
  const yaml = await config.readFile(new URL('../config.yaml', import.meta.url), 'utf8');
  const legacy = yaml.match(/- name: BondrailVault\n\s+address: "(0x[0-9a-fA-F]+)"/)?.[1];
  assert(legacy, 'fixture needs the configured legacy vault');
  const db = createTestIndexer();
  await db.process({ chains: { 10143: { startBlock, endBlock: startBlock, simulate: [
    { contract: 'BondrailVault', event: 'Transfer', srcAddress: legacy, params: { from: zero, to: alice, value: 3n } },
    { contract: 'BondrailVault', event: 'Deposit', srcAddress: legacy, params: { sender: alice, owner: alice, assets: 10n, shares: 3n } },
  ].map((e, logIndex) => ({ ...e, block: { number: startBlock, timestamp: 1_800_000_000, hash }, transaction: { hash }, logIndex })) as Event[] } } });
  const before = await db.Vault.getOrThrow(legacy);
  assert.equal(before.asset, undefined); assert.equal(before.name, undefined); assert.equal(before.registry, '');
  assert.equal(before.realizedPrice, 3_333_333_333_333_333_333n);
  await db.process({ chains: { 10143: { startBlock: startBlock + 1, endBlock: startBlock + 1, simulate: [
    { contract: 'BondrailVaultFactory', event: 'VaultCreated', srcAddress: registry,
      params: { vault: legacy as `0x${string}`, asset: INDEXED_ASSET, curator: bob, owner: alice, name: 'Legacy', symbol: 'LEG', strategy: { description: 'Revenue', metadataHash: hash } },
      block: { number: startBlock + 1, timestamp: 1_800_086_400, hash }, transaction: { hash }, logIndex: 0 },
  ] } } });
  const after = await db.Vault.getOrThrow(legacy);
  assert.equal(after.createdAt, before.createdAt); assert.equal(after.deposited, 10n); assert.equal(after.totalSupply, 3n);
  assert.equal(after.registry, registry); assert.equal(after.curator, bob); assert.equal(after.name, 'Legacy');
  assert.equal((await db.VaultPosition.getOrThrow(`${legacy}-${alice}`)).costBasis, 10n);
  assert.equal((await db.VaultDailySnapshot.getAll()).length, 1, 'registration does not invent a price observation');
});
