import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexer, createTestIndexer, type TestIndexerProcessConfig } from 'envio';
import { decodeFunctionData, encodeFunctionResult, getContractAddress, parseAbi } from 'viem';
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
const abi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function asset() view returns (address)', 'function owner() view returns (address)', 'function curator() view returns (address)',
  'function decimals() view returns (uint8)', 'function totalAssets() view returns (uint256)',
  'function entryAssets() view returns (uint256)', 'function idleAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)', 'function previewRedeem(uint256) view returns (uint256)',
  'function previewMint(uint256) view returns (uint256)',
]);

test('vault discovery, deposits, transferred cost basis, burn, curator events and block-pinned daily history', async () => {
  const original = globalThis.fetch;
  const blocks: string[] = [];
  process.env.VAULT_SNAPSHOT_RPC_URL = 'http://127.0.0.1:1';
  globalThis.fetch = async (url, options) => {
    // Every call in this test is served locally, including historical samples.
    assert.match(String(url), /127\.0\.0\.1:1/);
    const req = JSON.parse(String(options?.body));
    const answer = (r: any) => {
      if (r.method === 'eth_getBlockByNumber') return { jsonrpc: '2.0', id: r.id, result: { number: r.params[0], timestamp: `0x${(1_800_000_000n + (BigInt(r.params[0]) > BigInt(startBlock) ? 86400n : 0n)).toString(16)}`, hash, transactions: [] } };
      assert.equal(r.method, 'eth_call');
      blocks.push(r.params[1]);
      const { functionName } = decodeFunctionData({ abi, data: r.params[0].data });
      const value = functionName === 'name' || functionName === 'symbol' ? 'Credit'
        : functionName === 'asset' ? INDEXED_ASSET : ['owner', 'curator'].includes(functionName) ? alice
        : functionName === 'decimals' ? 12 : functionName === 'idleAssets' ? 500n
        : functionName === 'entryAssets' ? 1100n : 1000n;
      return { jsonrpc: '2.0', id: r.id, result: encodeFunctionResult({ abi, functionName, result: value } as never) };
    };
    return Response.json(Array.isArray(req) ? req.map(answer) : answer(req));
  };
  try {
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
    assert.equal((await db.VaultActivity.getAll()).length, 8);
    const snapshots = await db.VaultDailySnapshot.getAll();
    assert.equal(snapshots.length, 1); assert.equal(snapshots[0].idle, 500n); assert.equal(snapshots[0].entryNav, 1100n);
    assert(blocks.length > 0 && blocks.every(b => b === `0x${startBlock.toString(16)}`));
    const before = blocks.length;
    // A self-transfer has no valuation handler: the 300-block sampler must create the quiet-day row.
    // Envio anchors _every to the chain start, not the later vault-factory deployment block.
    const nextSample = START_BLOCK + (Math.floor((startBlock - START_BLOCK) / 300) + 1) * 300;
    for (const number of [nextSample, nextSample + 300]) {
      await db.process({ chains: { 10143: { startBlock: number, endBlock: number,
        simulate: [{ contract: 'BondrailVault', event: 'Transfer', srcAddress: vault,
          params: { from: bob, to: bob, value: 1n }, transaction: { hash },
          block: { number, timestamp: 1_800_086_400, hash } }] } } });
      assert.equal((await db.VaultDailySnapshot.getAll()).length, 2);
    }
    assert.equal(blocks.length - before, 12, 'one pinned valuation on a quiet day; subsequent samples skip it');
    assert(blocks.slice(before).every(b => b === `0x${nextSample.toString(16)}`));

  } finally { globalThis.fetch = original; delete process.env.VAULT_SNAPSHOT_RPC_URL; }
});
