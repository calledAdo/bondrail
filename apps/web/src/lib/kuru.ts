'use client';
import { useReadContract } from 'wagmi';
import { maxUint256, type Address } from 'viem';
import { chain } from './wallet';

const priceAbi = [
  { type: 'function', name: 'bestBidAsk', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
] as const;

/** Shared by bond details, Trading cards and the trade panel; wagmi caches by market address. */
export function useKuruPrice(market?: Address) {
  const read = useReadContract({
    address: market,
    abi: priceAbi,
    functionName: 'bestBidAsk',
    chainId: chain.id,
    query: { enabled: !!market, refetchInterval: 10_000 },
  });
  // Kuru prices are 1e18 fixed point, in asset per claim; an empty ask can be max uint256.
  const price = (value?: bigint) => value !== undefined && value > 0n && value < maxUint256 ? Number(value) / 1e18 : null;
  const quotes = market && !read.isError ? read.data : undefined;
  const bid = price(quotes?.[0]);
  const ask = price(quotes?.[1]);
  // A one-sided/empty/crossed book has no usable midpoint. Never substitute par for a missing quote.
  const mid = bid !== null && ask !== null && bid <= ask ? (bid + ask) / 2 : null;
  return { bid, ask, mid, loading: read.isLoading, error: read.isError, refetch: read.refetch };
}
