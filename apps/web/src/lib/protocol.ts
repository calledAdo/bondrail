'use client';
// Route-scoped indexer snapshots render first. Immutable metadata and live sections enrich independently.
import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { decodeFunctionResult, encodeFunctionData, erc20Abi, isAddress, multicall3Abi, type Address } from 'viem';
import { bondAbi, factoryAbi, vaultAbi } from './abi';
import { chain, deployment } from './wallet';
import { readBondTerms } from '@bondrail/sdk/client';
import { nativeReviewStatus } from './native-review';
import {
  accountBondsQuery, accountQuery, assembleAccounts, assembleBond, bondQuery, checksQuery, emptyIndex, listQuery,
  type Asset, type BondMetadata, type BondView, type IndexerData, type Registry,
} from './protocol-data';
export type * from './protocol-data';
export { indexedBacking, indexedPhase, unit } from './protocol-data';
import { fetchIndex as gql, INDEXER_URL } from './protocol-indexer';
export { INDEXER_URL } from './protocol-indexer';
export const KNOWN_ASSETS = new Set([deployment.token?.toLowerCase()].filter(Boolean) as string[]);
const FRESH = 30_000;
const IMMUTABLE = Infinity;
const key = (kind: string, address = '') => [kind, chain.id, INDEXER_URL, address.toLowerCase()] as const;
type Client = NonNullable<ReturnType<typeof usePublicClient>>;

function seedIndex(cache: QueryClient, d: IndexerData) {
  for (const b of d.Bond) cache.setQueryData(key('indexed-bond', b.id), { ...emptyIndex, Bond: [b] });
  for (const i of d.Issuer) cache.setQueryData(key('account-evidence', i.id), {
    ...emptyIndex, Issuer: [i], DailyRevenue: d.DailyRevenue.filter(x => x.account === i.id),
    PayerTotal: d.PayerTotal.filter(x => x.account === i.id),
  });
  for (const i of d.Issuer) cache.setQueryData(key('account-bonds', i.id), { ...emptyIndex, Bond: d.Bond.filter(b => b.account === i.id) });
}

/** Terms/name/symbol are absent from the indexer. One aggregate, with legacy terms decoded by the SDK. */
async function metadata(client: Client, address: Address): Promise<BondMetadata> {
  const calls = (['terms', 'name', 'symbol'] as const).map(functionName => ({
    target: address, allowFailure: true, callData: encodeFunctionData({ abi: bondAbi, functionName }),
  }));
  const multicall = chain.contracts?.multicall3.address;
  if (!multicall) {
    const [terms, name, symbol] = await Promise.all([
      readBondTerms(client, address), client.readContract({ address, abi: bondAbi, functionName: 'name' }),
      client.readContract({ address, abi: bondAbi, functionName: 'symbol' }),
    ]);
    return { terms, name, symbol };
  }
  const results = await client.readContract({ address: multicall, abi: multicall3Abi, functionName: 'aggregate3', args: [calls] });
  if (!results.every(r => r.success)) throw new Error('Bond terms could not be read');
  const terms = await readBondTerms({ call: async () => ({ data: results[0].returnData }) }, address);
  return {
    terms,
    name: decodeFunctionResult({ abi: bondAbi, functionName: 'name', data: results[1].returnData }),
    symbol: decodeFunctionResult({ abi: bondAbi, functionName: 'symbol', data: results[2].returnData }),
  };
}

/** Shared record keys let a list response satisfy a later detail/profile request without another fetch. */
async function registryRecords(cache: QueryClient, accounts: string[], bonds: string[]): Promise<Registry> {
  const fresh = (kind: string, a: string) => {
    const state = cache.getQueryState(key(kind, a));
    return !!state && Date.now() - state.dataUpdatedAt < 60_000;
  };
  const missingAccounts = accounts.filter(a => !fresh('profile', a));
  const missingBonds = bonds.filter(b => !fresh('kuru-record', b));
  if (missingAccounts.length || missingBonds.length) {
    const response = await fetch(`/api/registry?accounts=${missingAccounts.join(',')}&bonds=${missingBonds.join(',')}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Profile registry unavailable');
    const data: Registry = await response.json();
    for (const a of missingAccounts) cache.setQueryData(key('profile', a), data.profiles?.[a] ?? null);
    for (const b of missingBonds) cache.setQueryData(key('kuru-record', b), data.kuru?.[b] ?? null);
  }
  return {
    profiles: Object.fromEntries(accounts.map(a => [a, cache.getQueryData(key('profile', a)) ?? null])),
    kuru: Object.fromEntries(bonds.map(b => [b, cache.getQueryData(key('kuru-record', b)) ?? null])),
  } as Registry;
}

function useViews(d: IndexerData | undefined, withMetadata = true) {
  const client = usePublicClient({ chainId: chain.id });
  const cache = useQueryClient();
  const accounts = (d?.Issuer ?? []).map(i => i.id.toLowerCase()).sort();
  const bonds = (d?.Bond ?? []).map(b => b.id.toLowerCase()).sort();
  const registry = useQuery({
    queryKey: ['registry-records', chain.id, accounts, bonds], enabled: !!d?.Issuer.length,
    staleTime: 60_000, retry: 1,
    queryFn: () => registryRecords(cache, accounts, bonds),
  });
  const addresses = [...new Set((d?.Issuer ?? []).map(i => i.asset.toLowerCase() as Address))];
  const assetQueries = useQueries({ queries: addresses.map(address => ({
    queryKey: ['asset-metadata', chain.id, address], enabled: !!client, staleTime: IMMUTABLE,
    // This deployment's USD token is documented as six-decimal USDC. Never assume that for other assets.
    initialData: KNOWN_ASSETS.has(address) ? { address, decimals: 6, symbol: 'USDC', known: true } : undefined,
    queryFn: async (): Promise<Asset> => {
      const [decimals, symbol] = await client!.multicall({ allowFailure: false, contracts: [
        { address, abi: erc20Abi, functionName: 'decimals' }, { address, abi: erc20Abi, functionName: 'symbol' },
      ] });
      return { address, decimals, symbol, known: KNOWN_ASSETS.has(address) };
    },
  })) });
  const assets = new Map(assetQueries.flatMap((q, i) => q.data ? [[addresses[i], q.data] as const] : []));
  const metas = useQueries({ queries: (withMetadata ? d?.Bond ?? [] : []).map(b => ({
    queryKey: key('bond-metadata', b.id), enabled: !!client, staleTime: IMMUTABLE, retry: 1,
    queryFn: () => metadata(client!, b.id),
  })) });
  const health = useQueries({ queries: (withMetadata ? d?.Bond ?? [] : []).map(b => ({
    queryKey: ['bond-health', chain.id, deployment.factory, b.id.toLowerCase()],
    enabled: !!client && !!deployment.factory, staleTime: FRESH, refetchInterval: FRESH,
    queryFn: () => client!.readContract({ address: deployment.factory!, abi: factoryAbi, functionName: 'depositAllowed', args: [b.id] }),
  })) });
  const views = d ? assembleAccounts(d, assets, registry.data) : [];
  const full = (d?.Bond ?? []).flatMap((b, i) => {
    const a = views.find(a => a.address === b.account);
    return a && metas[i]?.data ? [assembleBond(b, a, metas[i].data!, registry.data, d!.CovenantCheck, { extra: [], allowed: health[i]?.data })] : [];
  });
  return { data: d ? { accounts: views, bonds: full, indexedBonds: d.Bond, indexedAt: Date.now() / 1000 } : undefined,
    registry, assets, metas, health, assetsLoading: assetQueries.some(q => q.isLoading), assetsError: assetQueries.find(q => q.error)?.error };
}

/** One list query for markets/portfolio/console; indexed values never generate per-bond RPC reads. */
export function useProtocol() {
  const cache = useQueryClient();
  const q = useQuery({ queryKey: key('protocol-index'), enabled: !!INDEXER_URL, staleTime: FRESH, refetchInterval: FRESH,
    queryFn: async () => { const d = await gql(listQuery); seedIndex(cache, d); return d; },
  });
  const views = useViews(q.data);
  return { ...views, loading: q.isLoading, error: q.error, configured: !!INDEXER_URL, refetch: q.refetch };
}

function useAccountEvidence(address?: string) {
  return useQuery({ queryKey: key('account-evidence', address), enabled: !!INDEXER_URL && !!address && isAddress(address),
    staleTime: FRESH, refetchInterval: FRESH, queryFn: () => gql(accountQuery, address),
  });
}

export function useBond(address: string, initialData?: IndexerData, initialDataUpdatedAt?: number) {
  const client = usePublicClient({ chainId: chain.id });
  const q = useQuery({ queryKey: key('indexed-bond', address), initialData, initialDataUpdatedAt, enabled: !!INDEXER_URL && isAddress(address),
    staleTime: FRESH, refetchInterval: FRESH, queryFn: () => gql(bondQuery, address),
  });
  const row = q.data?.Bond[0];
  const evidence = useAccountEvidence(row?.account);
  const checks = useQuery({ queryKey: key('bond-checks', address), enabled: !!row && row.adapter === 1,
    staleTime: FRESH, refetchInterval: FRESH, queryFn: () => gql(checksQuery, address),
  });
  const d = q.data ? { ...q.data, Issuer: evidence.data?.Issuer ?? q.data.Issuer, DailyRevenue: evidence.data?.DailyRevenue ?? [], PayerTotal: evidence.data?.PayerTotal ?? [] } : undefined;
  const views = useViews(d);
  const live = useQuery({ queryKey: key('bond-live', address), enabled: !!row && !!client,
    staleTime: FRESH, refetchInterval: FRESH, retry: 1,
    queryFn: async () => {
      const contracts = (['activationTime', 'collectionClosedAt', 'settleAfter', 'defaultedAt', 'source'] as const)
        .map(functionName => ({ address: row!.id, abi: bondAbi, functionName }));
      const result = await client!.multicall({ contracts });
      return { extra: result };
    },
  });
  const basis = views.data?.accounts[0];
  const a = evidence.data ? basis : undefined;
  const b = basis && row && views.metas[0]?.data ? assembleBond(row, basis, views.metas[0].data, views.registry.data, checks.data?.CovenantCheck, { extra: live.data?.extra ?? [], allowed: views.health[0]?.data }, Date.now() / 1000, !!a) : undefined;
  return { ...views, row, b, a, loading: q.isLoading || evidence.isLoading || views.assetsLoading,
    evidenceLoading: evidence.isLoading, liveLoading: live.isLoading, checksLoading: checks.isLoading, checksError: checks.error,
    termsLoading: views.metas[0]?.isLoading, termsError: views.metas[0]?.error,
    error: q.error || evidence.error || views.assetsError, configured: !!INDEXER_URL,
    refetch: () => Promise.all([q.refetch(), evidence.refetch(), live.refetch(), checks.refetch(), ...views.metas.map(m => m.refetch()), ...views.health.map(h => h.refetch())]),
  };
}

export function useAccountPage(address: string) {
  const evidence = useAccountEvidence(address);
  const bonds = useQuery({ queryKey: key('account-bonds', address), enabled: !!INDEXER_URL && isAddress(address),
    staleTime: FRESH, refetchInterval: FRESH, queryFn: () => gql(accountBondsQuery, address),
  });
  const d = evidence.data ? { ...evidence.data, Bond: bonds.data?.Bond ?? [] } : undefined;
  const views = useViews(d, false);
  return { ...views, bondsLoading: bonds.isLoading, loading: evidence.isLoading || views.assetsLoading, error: evidence.error || bonds.error || views.assetsError, configured: !!INDEXER_URL };
}

/** Factory review is progressive and scoped to this account, never a prerequisite for the summary. */
export function useNativeReview(project?: Address) {
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({ queryKey: ['native-review', chain.id, deployment.factory, project?.toLowerCase()],
    enabled: !!client && !!deployment.factory && !!project, staleTime: FRESH, refetchInterval: FRESH,
    queryFn: async () => {
      const base = { address: deployment.factory!, abi: factoryAbi } as const;
      const [individual, template] = await client!.multicall({ allowFailure: false, contracts: [
        { ...base, functionName: 'nativeApproved', args: [project!] }, { ...base, functionName: 'templateOf', args: [project!] },
      ] });
      const approved = !/^0x0{64}$/i.test(template) ? await client!.readContract({ ...base, functionName: 'nativeTemplate', args: [template] }) : undefined;
      return nativeReviewStatus(individual, template, approved);
    },
  });
}

export function useVaultHoldings(enabled = true) {
  const client = usePublicClient({ chainId: chain.id });
  return useQuery({ queryKey: ['vault-holdings', chain.id, deployment.vault], enabled: enabled && !!client && !!deployment.vault,
    staleTime: FRESH, refetchInterval: FRESH, retry: 1,
    queryFn: () => client!.readContract({ address: deployment.vault!, abi: vaultAbi, functionName: 'holdings' }),
  });
}

export function marketTab(b: Pick<BondView, 'phase'>): 'raising' | 'trading' | 'record' {
  if (b.phase === 'Funding') return 'raising';
  if (b.phase === 'Active' || b.phase === 'Closing') return 'trading';
  return 'record';
}
export const HIDING_FLAGS = ['No signed profile', 'Source unhealthy', 'Unrecognised asset', 'Fewer than two attributed payers'];
export const listed = (b: BondView) => !b.flags.some((f) => HIDING_FLAGS.includes(f));
export { fmt } from './format';
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export const days = (d: number) => (d >= 1 ? `${Math.round(d)}d` : `${Math.max(1, Math.round(d * 24))}h`);
