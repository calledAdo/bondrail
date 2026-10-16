'use client';
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { erc20Abi, zeroAddress, type Address } from 'viem';
import { getVault, listVaults } from '@bondrail/sdk/vault';
import { bondAbi, vaultAbi, vaultFactoryAbi } from './abi';
import { chain, deployment, safeNetwork } from './wallet';
import { INDEXER_URL } from './protocol-indexer';
import type { IndexedVaultPosition, VaultSnapshot } from './vault-data';
const FRESH = 15_000;

export function useVaultDirectory() {
  const client = usePublicClient({ chainId: chain.id });
  return useInfiniteQuery({ queryKey: ['vault-directory', chain.id, deployment.vaultFactory, deployment.vault],
    initialPageParam: 0n, enabled: !!client && safeNetwork, staleTime: FRESH,
    queryFn: async ({ pageParam }) => {
      if (!deployment.vaultFactory) return { addresses: deployment.vault ? [deployment.vault] : [], next: undefined };
      const blockNumber = await client!.getBlockNumber();
      const [addresses, count] = await Promise.all([
        listVaults(client!, deployment.vaultFactory, { offset: pageParam, limit: 25, blockNumber }),
        client!.readContract({ address: deployment.vaultFactory, abi: vaultFactoryAbi, functionName: 'vaultCount', blockNumber }),
      ]);
      return { addresses, next: pageParam + BigInt(addresses.length) < count ? pageParam + BigInt(addresses.length) : undefined };
    }, getNextPageParam: page => page.next,
  });
}
export function useVault(address: Address) {
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({ queryKey: ['vault', chain.id, deployment.vaultFactory, address.toLowerCase()], enabled: !!client && safeNetwork,
    staleTime: FRESH, refetchInterval: FRESH, retry: 1,
    queryFn: async () => {
      if (deployment.vaultFactory) {
        const registered = await client!.readContract({ address: deployment.vaultFactory, abi: vaultFactoryAbi, functionName: 'isVault', args: [address] });
        if (!registered) throw new Error('This address is not a registered vault.');
      } else if (address.toLowerCase() !== deployment.vault?.toLowerCase()) throw new Error('This address is not the configured vault.');
      return getVault(client!, address, { registry: deployment.vaultFactory });
    },
  });
}
export function useVaultCards(addresses: Address[]) {
  const client = usePublicClient({ chainId: chain.id });
  return useQueries({ queries: addresses.map(address => ({
    queryKey: ['vault', chain.id, deployment.vaultFactory, address.toLowerCase()], enabled: !!client && safeNetwork,
    staleTime: FRESH, refetchInterval: FRESH, retry: 1,
    queryFn: () => getVault(client!, address, { registry: deployment.vaultFactory }),
  })) });
}
export function useVaultHoldingsDetail(address: Address, held: readonly Address[] = []) {
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({ queryKey: ['vault-detail-holdings', chain.id, address, held], enabled: !!client, staleTime: FRESH, refetchInterval: FRESH,
    queryFn: async () => {
      const blockNumber = await client!.getBlockNumber();
      return Promise.all(held.map(async bond => {
        const b = { address: bond, abi: bondAbi, blockNumber } as const;
        const v = { address, abi: vaultAbi, blockNumber } as const;
        const [name, phase, claims, value, cost, triggered, defaultedAt] = await Promise.all([
          client!.readContract({ ...b, functionName: 'name' }), client!.readContract({ ...b, functionName: 'phase' }),
          client!.readContract({ ...b, functionName: 'balanceOf', args: [address] }),
          client!.readContract({ ...v, functionName: 'holdingValue', args: [bond] }),
          client!.readContract({ ...v, functionName: 'costBasis', args: [bond] }),
          client!.readContract({ ...b, functionName: 'triggered' }), client!.readContract({ ...b, functionName: 'defaultedAt' }),
        ]);
        return { bond, name, phase, claims, value, cost, triggered, defaulted: defaultedAt > 0n };
      }));
    },
  });
}
export function useVaultBalance(vault: Address, asset: Address, holder?: Address) {
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({ queryKey: ['vault-balance', chain.id, vault, holder], enabled: !!client && !!holder, staleTime: 5000, refetchInterval: 5000,
    queryFn: async () => {
      const blockNumber = await client!.getBlockNumber();
      const base = { address: vault, abi: vaultAbi, blockNumber } as const;
      const who = holder ?? zeroAddress;
      const [cash, allowance, shares, maxWithdraw, maxRedeem, maxDeposit] = await Promise.all([
        client!.readContract({ address: asset, abi: erc20Abi, functionName: 'balanceOf', args: [who], blockNumber }),
        client!.readContract({ address: asset, abi: erc20Abi, functionName: 'allowance', args: [who, vault], blockNumber }),
        client!.readContract({ ...base, functionName: 'balanceOf', args: [who] }),
        client!.readContract({ ...base, functionName: 'maxWithdraw', args: [who] }),
        client!.readContract({ ...base, functionName: 'maxRedeem', args: [who] }),
        client!.readContract({ ...base, functionName: 'maxDeposit', args: [who] }),
      ]);
      const value = await client!.readContract({ ...base, functionName: 'previewRedeem', args: [shares] });
      return { cash, allowance, shares, maxWithdraw, maxRedeem, maxDeposit, value, blockNumber };
    },
  });
}
export async function vaultIndex<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(INDEXER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(8000) });
  const result = await response.json();
  if (!response.ok || result.errors || !result.data) throw new Error('Vault history could not be loaded.');
  return result.data;
}
export function useVaultHistory(addresses: readonly string[]) {
  return useQuery({ queryKey: ['vault-history', chain.id, INDEXER_URL, addresses], enabled: !!INDEXER_URL && addresses.length > 0, staleTime: 60_000,
    queryFn: () => vaultIndex<{ VaultDailySnapshot: VaultSnapshot[] }>(`query VaultHistory($vaults: [String!]!, $day: Int!) {
      VaultDailySnapshot(where: {vault: {_in: $vaults}, day: {_gte: $day}}, order_by: {day: asc}) {
        id vault day timestamp block entryPrice exitPrice nav entryNav idle totalSupply
      }
    }`, { vaults: addresses.map(a => a.toLowerCase()), day: Math.floor(Date.now() / 86400000) - 29 }),
  });
}
export function useIndexedVaultPositions(holder?: Address) {
  return useQuery({ queryKey: ['vault-position-history', chain.id, INDEXER_URL, holder], enabled: !!holder && !!INDEXER_URL, staleTime: FRESH, refetchInterval: FRESH,
    queryFn: () => vaultIndex<{ VaultPosition: IndexedVaultPosition[] }>(`query VaultPositions($holder: String!) {
      VaultPosition(where: {holder: {_eq: $holder}}) { id vault holder shares costBasis deposited withdrawn }
    }`, { holder: holder!.toLowerCase() }),
  });
}
