import { erc20Abi, zeroAddress, type Address, type PublicClient } from 'viem';
import { bondrailVaultAbi as vaultAbi, bondrailVaultFactoryAbi as factoryAbi } from './abis';

type Reader = Pick<PublicClient, 'readContract' | 'getBlockNumber'>;

/** One bounded registry page. Use vaultCount and successive offsets for larger directories. */
export async function listVaults(client: Reader, registry: Address, options: { offset?: bigint; limit?: number; blockNumber?: bigint } = {}) {
  const { offset = 0n, limit = 100, blockNumber } = options;
  if (offset < 0n || !Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Vault page requires offset >= 0 and limit 1..100');
  return client.readContract({ address: registry, abi: factoryAbi, functionName: 'vaults', args: [offset, BigInt(limit)], blockNumber });
}

/** All NAV/price/holding reads share one block. Prices are asset base units per whole share. */
export async function getVault(client: Reader, address: Address, options: { registry?: Address; holder?: Address; blockNumber?: bigint } = {}) {
  const blockNumber = options.blockNumber ?? await client.getBlockNumber();
  const base = { address, abi: vaultAbi, blockNumber } as const;
  const [asset, name, symbol, decimals, nav, entryNav, idle, supply, curator, owner, holdings, cap, maxBonds, buffer, unvested, pending, changeAfter, delay, maxDeposit] = await Promise.all([
    client.readContract({ ...base, functionName: 'asset' }),
    client.readContract({ ...base, functionName: 'name' }),
    client.readContract({ ...base, functionName: 'symbol' }),
    client.readContract({ ...base, functionName: 'decimals' }),
    client.readContract({ ...base, functionName: 'totalAssets' }),
    client.readContract({ ...base, functionName: 'entryAssets' }),
    client.readContract({ ...base, functionName: 'idleAssets' }),
    client.readContract({ ...base, functionName: 'totalSupply' }),
    client.readContract({ ...base, functionName: 'curator' }),
    client.readContract({ ...base, functionName: 'owner' }),
    client.readContract({ ...base, functionName: 'holdings' }),
    client.readContract({ ...base, functionName: 'MAX_BOND_BPS' }),
    client.readContract({ ...base, functionName: 'MAX_BONDS' }),
    client.readContract({ ...base, functionName: 'MIN_IDLE_BPS' }),
    client.readContract({ ...base, functionName: 'unvestedIncome' }),
    client.readContract({ ...base, functionName: 'pendingCurator' }),
    client.readContract({ ...base, functionName: 'curatorChangeAfter' }),
    client.readContract({ ...base, functionName: 'CURATOR_DELAY' }),
    client.readContract({ ...base, functionName: 'maxDeposit', args: [options.holder ?? zeroAddress] }),
  ]);
  if (holdings.length > 16) throw new Error('Unexpected vault holdings limit');
  const [assetSymbol, assetDecimals, exitPrice, entryPrice, strategy] = await Promise.all([
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'symbol', blockNumber }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'decimals', blockNumber }),
    client.readContract({ ...base, functionName: 'previewRedeem', args: [10n ** BigInt(decimals)] }),
    client.readContract({ ...base, functionName: 'previewMint', args: [10n ** BigInt(decimals)] }),
    options.registry ? client.readContract({ address: options.registry, abi: factoryAbi, functionName: 'strategy', args: [address], blockNumber }) : undefined,
  ]);
  return { address, blockNumber, asset, name, symbol, decimals, assetSymbol, assetDecimals, nav, entryNav, idle, supply,
    curator, owner, holdings, cap, maxBonds, buffer, unvested, pending, changeAfter, delay, maxDeposit, exitPrice, entryPrice, strategy };
}
export type VaultView = Awaited<ReturnType<typeof getVault>>;

/** Deposit previews use entry NAV; never substitute convertToShares (which uses exit NAV). */
export const previewDeposit = (client: Reader, vault: Address, assets: bigint, blockNumber?: bigint) =>
  client.readContract({ address: vault, abi: vaultAbi, functionName: 'previewDeposit', args: [assets], blockNumber });
/** Shares to burn, rounded up at exit NAV. This preview does not enforce idle liquidity. */
export const previewWithdraw = (client: Reader, vault: Address, assets: bigint, blockNumber?: bigint) =>
  client.readContract({ address: vault, abi: vaultAbi, functionName: 'previewWithdraw', args: [assets], blockNumber });
export const previewRedeem = (client: Reader, vault: Address, shares: bigint, blockNumber?: bigint) =>
  client.readContract({ address: vault, abi: vaultAbi, functionName: 'previewRedeem', args: [shares], blockNumber });
