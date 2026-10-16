import { createEffect, S } from 'envio';
import { createPublicClient, http, parseAbi, type Address } from 'viem';

const abi = parseAbi([
  'function name() view returns (string)', 'function symbol() view returns (string)',
  'function asset() view returns (address)', 'function owner() view returns (address)',
  'function curator() view returns (address)', 'function decimals() view returns (uint8)',
  'function totalAssets() view returns (uint256)', 'function entryAssets() view returns (uint256)',
  'function idleAssets() view returns (uint256)', 'function totalSupply() view returns (uint256)',
  'function previewRedeem(uint256) view returns (uint256)', 'function previewMint(uint256) view returns (uint256)',
]);
function client(chainId: number) {
  const url = process.env.VAULT_SNAPSHOT_RPC_URL ?? process.env.MONAD_RPC ?? (chainId === 31337 ? process.env.BONDRAIL_RPC_URL : 'https://testnet-rpc.monad.xyz');
  if (!url) throw new Error('Set VAULT_SNAPSHOT_RPC_URL for historical vault snapshots');
  return createPublicClient({ transport: http(url, { batch: true }) });
}

export const vaultState = createEffect({
  name: 'vaultStateAtBlock', input: { chainId: S.number, vault: S.string, block: S.number },
  output: { asset: S.string, owner: S.string, curator: S.string, name: S.string, symbol: S.string,
    nav: S.bigint, entryNav: S.bigint, idle: S.bigint, totalSupply: S.bigint, entryPrice: S.bigint, exitPrice: S.bigint },
  rateLimit: { calls: 4, per: 'second' }, cache: true,
}, async ({ input }) => {
  const c = client(input.chainId);
  const base = { address: input.vault as Address, abi, blockNumber: BigInt(input.block) } as const;
  const [asset, owner, curator, name, symbol, decimals, nav, entryNav, idle, totalSupply] = await Promise.all([
    c.readContract({ ...base, functionName: 'asset' }), c.readContract({ ...base, functionName: 'owner' }),
    c.readContract({ ...base, functionName: 'curator' }), c.readContract({ ...base, functionName: 'name' }),
    c.readContract({ ...base, functionName: 'symbol' }), c.readContract({ ...base, functionName: 'decimals' }),
    c.readContract({ ...base, functionName: 'totalAssets' }), c.readContract({ ...base, functionName: 'entryAssets' }),
    c.readContract({ ...base, functionName: 'idleAssets' }), c.readContract({ ...base, functionName: 'totalSupply' }),
  ]);
  const [entryPrice, exitPrice] = await Promise.all([
    c.readContract({ ...base, functionName: 'previewMint', args: [10n ** BigInt(decimals)] }),
    c.readContract({ ...base, functionName: 'previewRedeem', args: [10n ** BigInt(decimals)] }),
  ]);
  return { asset, owner, curator, name, symbol, nav, entryNav, idle, totalSupply, entryPrice, exitPrice };
});

export const blockTime = createEffect({
  name: 'vaultSnapshotBlockTime', input: { chainId: S.number, block: S.number }, output: S.bigint,
  rateLimit: { calls: 4, per: 'second' }, cache: true,
}, async ({ input }) => (await client(input.chainId).getBlock({ blockNumber: BigInt(input.block) })).timestamp);
