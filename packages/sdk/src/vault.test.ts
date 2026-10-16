import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PublicClient } from 'viem';
import { getVault, listVaults, previewDeposit, previewWithdraw, previewRedeem } from './vault';
const vault = '0x1111111111111111111111111111111111111111';
const registry = '0x2222222222222222222222222222222222222222';
const asset = '0x3333333333333333333333333333333333333333';

test('previews use ERC-4626 entry/exit methods and preserve integer rounding from chain', async () => {
  const calls: any[] = [];
  const client = { readContract: async (call: any) => { calls.push(call); return call.functionName === 'previewDeposit' ? 999n : call.functionName === 'previewWithdraw' ? 1001n : 500n; } } as unknown as PublicClient;
  assert.equal(await previewDeposit(client, vault, 1000n, 90n), 999n);
  assert.equal(await previewWithdraw(client, vault, 1000n, 90n), 1001n);
  assert.equal(await previewRedeem(client, vault, 1000n, 90n), 500n);
  assert.deepEqual(calls.map(c => [c.functionName, c.args, c.blockNumber]), [
    ['previewDeposit', [1000n], 90n], ['previewWithdraw', [1000n], 90n], ['previewRedeem', [1000n], 90n],
  ]);
});
test('listVaults bounds a page before issuing a read', async () => {
  const calls: any[] = [];
  const client = { readContract: async (c: any) => { calls.push(c); return [vault]; } } as unknown as PublicClient;
  for (const limit of [0, 101, 1.5, NaN]) await assert.rejects(listVaults(client, registry, { limit }), RangeError);
  await assert.rejects(listVaults(client, registry, { offset: -1n }), RangeError);
  assert.equal(calls.length, 0);
  assert.deepEqual(await listVaults(client, registry, { offset: 100n, limit: 20 }), [vault]);
  assert.deepEqual(calls[0].args, [100n, 20n]);
});
test('getVault pins every NAV/metadata/price read and uses whole share decimals', async () => {
  const calls: any[] = [];
  const client = { getBlockNumber: async () => 77n, readContract: async (c: any) => {
    calls.push(c);
    if (c.functionName === 'asset') return asset;
    if (c.functionName === 'holdings') return [];
    if (c.functionName === 'decimals') return c.address === asset ? 6 : 12;
    if (c.functionName === 'strategy') return { description: 'Revenue', metadataHash: `0x${'0'.repeat(64)}` };
    if (['name', 'symbol'].includes(c.functionName)) return 'Credit';
    if (['curator', 'owner', 'pendingCurator'].includes(c.functionName)) return vault;
    return 100n;
  } } as unknown as PublicClient;
  const data = await getVault(client, vault, { registry });
  assert.equal(data.blockNumber, 77n);
  assert.equal(data.assetDecimals, 6);
  assert.equal(data.decimals, 12);
  assert(calls.every(c => c.blockNumber === 77n));
  assert.deepEqual(calls.filter(c => ['previewMint', 'previewRedeem'].includes(c.functionName)).map(c => c.args), [[10n ** 12n], [10n ** 12n]]);
});
