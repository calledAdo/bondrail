'use client';
import Link from 'next/link';
import { useQueries } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, isAddress, type Address } from 'viem';
import { getVault } from '@bondrail/sdk/vault';
import { vaultAbi, vaultFactoryAbi } from '@/lib/abi';
import { chain, deployment } from '@/lib/wallet';
import { useIndexedVaultPositions, useVaultDirectory } from '@/lib/vaults';
import { Empty, Panel } from './ui';
import { Term } from './term';
import { vaultControl, vaultMoney } from './vault-actions';

export function VaultPositions() {
  const { address } = useAccount();
  const client = usePublicClient({ chainId: chain.id });
  const directory = useVaultDirectory();
  const history = useIndexedVaultPositions(address);
  const addresses = [...new Set([
    ...(directory.data?.pages.flatMap(p => [...p.addresses]) ?? []),
    ...(history.data?.VaultPosition.filter(p => p.shares !== '0').map(p => p.vault).filter(a => isAddress(a)) ?? []),
  ].map(a => a.toLowerCase() as Address))];
  const queries = useQueries({ queries: addresses.map(vault => ({ queryKey: ['vault-portfolio', chain.id, deployment.vaultFactory, vault, address],
    enabled: !!address && !!client, staleTime: 5000, refetchInterval: 15000,
    queryFn: async () => {
      const blockNumber = await client!.getBlockNumber();
      if (deployment.vaultFactory) {
        const registered = await client!.readContract({ address: deployment.vaultFactory, abi: vaultFactoryAbi, functionName: 'isVault', args: [vault], blockNumber });
        if (!registered) return null;
      } else if (vault !== deployment.vault?.toLowerCase()) return null;
      const base = { address: vault, abi: vaultAbi, blockNumber } as const;
      const shares = await client!.readContract({ ...base, functionName: 'balanceOf', args: [address!] });
      if (shares === 0n) return null;
      const [v, value, withdrawable] = await Promise.all([
        getVault(client!, vault, { blockNumber }),
        client!.readContract({ ...base, functionName: 'previewRedeem', args: [shares] }),
        client!.readContract({ ...base, functionName: 'maxWithdraw', args: [address!] }),
      ]);
      return { v, shares, value, withdrawable };
    },
  })) });
  const rows = queries.flatMap(q => q.data ? [q.data] : []);
  if (!address) return null;
  return <section className="space-y-4" aria-labelledby="vault-positions-title">
    <h2 id="vault-positions-title" className="text-2xl font-semibold">Your <Term term="vaultShare">vault shares</Term></h2>
    {rows.map(({ v, shares, value, withdrawable }) => {
      const indexed = history.data?.VaultPosition.find(p => p.vault.toLowerCase() === v.address.toLowerCase() && p.holder.toLowerCase() === address.toLowerCase());
      const basis = indexed && BigInt(indexed.shares) === shares ? BigInt(indexed.costBasis) : undefined;
      return <Panel key={v.address} title={<Link className="hover:underline" href={`/vaults/${v.address}`}>{v.name}</Link>}>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {([['Shares', formatUnits(shares, v.decimals)], ['Value at exit price', vaultMoney(value, v)], ['Withdrawable now', vaultMoney(withdrawable, v)],
            ['Remaining deposit cost', basis === undefined ? 'History syncing or unavailable' : vaultMoney(basis, v)]] as const).map(([label, val]) => <div key={label}><dt className="mb-1 text-xs text-foreground/70">{label}</dt><dd className="break-words font-mono">{val}</dd></div>)}
        </dl>
        <p className="mt-3 text-xs text-foreground/70">Deposit cost comes from indexed deposits, reduced pro rata for burned shares and carried with transferred shares. It excludes transaction fees.</p>
        <Link href={`/vaults/${v.address}?action=withdraw#transact`} className="mt-4 inline-flex min-h-11 items-center underline underline-offset-4">{withdrawable > 0n ? 'Review withdrawal →' : 'View holdings · waiting for repayments →'}</Link>
      </Panel>;
    })}
    {(directory.isPending || queries.some(q => q.isPending)) && <p role="status">Reading vault positions…</p>}
    {(directory.isError || queries.some(q => q.isError)) && <p role="alert">Some vault positions could not be read. <button type="button" className={vaultControl} onClick={() => { void directory.refetch(); queries.forEach(q => void q.refetch()); }}>Retry positions</button></p>}
    {!rows.length && !directory.isPending && !directory.isError && queries.every(q => !q.isPending && !q.isError) && <Empty title="No vault shares found"><Link href="/vaults" className="underline">Explore vaults</Link></Empty>}
    {directory.hasNextPage && <button type="button" className={vaultControl} disabled={directory.isFetchingNextPage} onClick={() => void directory.fetchNextPage()}>Check more registered vaults</button>}
  </section>;
}
