'use client';
import { useState } from 'react';
import Link from 'next/link';
import { formatUnits } from 'viem';
import { type VaultView } from '@bondrail/sdk/vault';
import { useVaultCards, useVaultDirectory, useVaultHistory } from '@/lib/vaults';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { short } from '@/lib/protocol';
import type { VaultSnapshot } from '@/lib/vault-data';
import { isTeamVault, vaultDisclosure } from '@/lib/vault-data';
import { Badge, Empty, Figure, Panel } from './ui';
import { Term } from './term';
import { vaultControl, vaultMoney } from './vault-actions';

export function AddressLink({ address, full = false }: { address: string; full?: boolean }) {
  const label = full ? address : short(address);
  return chain.blockExplorers ? <a href={`${chain.blockExplorers.default.url}/address/${address}`} title={address} target="_blank" rel="noreferrer" className="break-all font-mono underline underline-offset-4">{label}</a>
    : <span title={address} className="break-all font-mono">{label}</span>;
}
export function VaultDisclosure({ vault }: { vault: VaultView }) {
  return <div className="space-y-2 text-sm text-foreground/80">
    {isTeamVault(vault, deployment) && <Badge>Created by the Bondrail team</Badge>}
    <p>{vaultDisclosure}</p>
  </div>;
}
export function VaultTrend({ snapshots, vault }: { snapshots: VaultSnapshot[]; vault: VaultView }) {
  const rows = snapshots.filter(s => s.vault.toLowerCase() === vault.address.toLowerCase()).sort((a, b) => a.day - b.day).slice(-30);
  if (rows.length < 2) return <p className="text-xs text-foreground/70">30-day exit price · {rows.length ? 'one daily observation; trend builds over time' : 'history not available yet'}</p>;
  const points = rows.map(r => Number(formatUnits(BigInt(r.exitPrice), vault.assetDecimals)));
  const low = Math.min(...points), high = Math.max(...points), span = high - low || Math.max(high * 0.05, 0.000001);
  const first = rows[0].day, last = rows.at(-1)!.day;
  const coordinates = points.map((y, i) => `${4 + (rows[i].day - first) / Math.max(last - first, 1) * 272},${44 - (y - low) / span * 36}`).join(' ');
  return <figure className="space-y-2">
    <svg viewBox="0 0 280 52" className="h-14 w-full text-foreground/70" role="img" aria-label={`Exit price: ${points[0]} to ${points.at(-1)} ${vault.assetSymbol}; ${rows.length} daily observations`}><polyline points={coordinates} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>
    <figcaption className="flex flex-wrap justify-between gap-1 text-xs text-foreground/70"><span>30-day exit price · {rows.length} observations</span><span>{points[0]} → {points.at(-1)} {vault.assetSymbol}</span></figcaption>
  </figure>;
}
export function VaultDirectory() {
  const directory = useVaultDirectory();
  const addresses = directory.data?.pages.flatMap(p => [...p.addresses]) ?? [];
  const cards = useVaultCards(addresses);
  const history = useVaultHistory(addresses);
  const [asset, setAsset] = useState('all'), [strategy, setStrategy] = useState(''), [sort, setSort] = useState('name');
  const vaults = cards.flatMap(q => q.data ? [q.data] : []);
  const assets = [...new Map(vaults.map(v => [v.asset.toLowerCase(), v.assetSymbol])).entries()];
  const visible = vaults.filter(v => (asset === 'all' || v.asset.toLowerCase() === asset) && (v.strategy?.description ?? 'Diversified revenue bonds under fixed allocation limits').toLowerCase().includes(strategy.toLowerCase()))
    .sort((a, b) => sort === 'asset' ? a.assetSymbol.localeCompare(b.assetSymbol) || a.name.localeCompare(b.name)
      : sort === 'strategy' ? (a.strategy?.description ?? '').localeCompare(b.strategy?.description ?? '') : a.name.localeCompare(b.name));
  return <div className="space-y-8">
    <header className="max-w-3xl space-y-3"><p className="font-mono text-xs text-foreground/60">(vaults)</p><h1 className="text-4xl font-semibold">Revenue bonds, held together.</h1>
      <p className="text-foreground/70">Choose a disclosed curator and a mandate. One deposit buys shares in a portfolio of revenue bonds; withdrawals depend on available cash.</p></header>
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="space-y-2 text-sm"><span>Asset</span><select className={`${vaultControl} w-full`} value={asset} onChange={e => setAsset(e.target.value)}><option value="all">All assets</option>{assets.map(([id, label]) => <option value={id} key={id}>{label} · {short(id)}</option>)}</select></label>
      <label className="space-y-2 text-sm"><span>Strategy</span><input className={`${vaultControl} w-full`} value={strategy} onChange={e => setStrategy(e.target.value)} placeholder="Search strategy" /></label>
      <label className="space-y-2 text-sm"><span>Sort by</span><select className={`${vaultControl} w-full`} value={sort} onChange={e => setSort(e.target.value)}><option value="name">Vault name</option><option value="asset">Asset</option><option value="strategy">Strategy</option></select></label>
    </div>
    {!safeNetwork ? <Empty title="Unsupported network">Select a supported Bondrail network.</Empty> : directory.isPending || cards.some(q => q.isPending) ? <p role="status">Reading vaults…</p> : null}
    {(directory.isError || cards.some(q => q.isError)) && <div role="alert" className="space-y-2"><p>Some vaults could not be read. Refresh to try again.</p><button type="button" className={vaultControl} onClick={() => { void directory.refetch(); cards.forEach(q => void q.refetch()); }}>Retry vaults</button></div>}
    {!directory.isPending && !directory.isError && !addresses.length && <Empty title="No vaults registered yet">A vault pools deposits and lets a disclosed curator invest them across revenue bonds under fixed limits. You receive shares, and can withdraw only the cash currently available in the vault.</Empty>}
    {vaults.length > 0 && !visible.length && <Empty title="No matching vaults">Try another asset or strategy.</Empty>}
    <div className="grid gap-5 lg:grid-cols-2">{visible.map(v => <Panel className="[&_dd]:break-words [&_dd]:text-base" key={v.address} title={<Link className="underline-offset-4 hover:underline" href={`/vaults/${v.address}`}>{v.name}</Link>} aside={<Badge>{v.maxDeposit > 0n ? 'Open to deposits' : 'Closed to deposits'}</Badge>}>
      <p className="mb-2 text-sm text-foreground/80">{v.strategy?.description || 'Diversified revenue bonds under fixed allocation limits'}</p>
      <p className="mb-5 text-xs text-foreground/70">Curator <AddressLink address={v.curator} /> · {v.assetSymbol}</p>
      <div className="mb-5"><VaultDisclosure vault={v} /></div>
      <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
        <Figure label={<Term term="nav">NAV</Term>} value={vaultMoney(v.nav, v)} bracket={false} />
        <Figure label="Withdrawable now" value={vaultMoney(v.idle, v)} bracket={false} />
        <Figure label="Holdings" value={v.holdings.length} bracket={false} />
        <Figure label={<Term term="price">Entry price / share</Term>} value={vaultMoney(v.entryPrice, v)} bracket={false} />
        <Figure label={<Term term="price">Exit price / share</Term>} value={vaultMoney(v.exitPrice, v)} bracket={false} />
      </dl>
      <div className="my-5 border-t border-foreground/10 pt-4"><VaultTrend snapshots={history.data?.VaultDailySnapshot ?? []} vault={v} /></div>
      <Link href={`/vaults/${v.address}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Explore vault →</Link>
    </Panel>)}</div>
    {history.isError && <p className="text-sm text-foreground/70">Price history is temporarily unavailable. Current valuations above come from the vault contracts.</p>}
    {directory.hasNextPage && <button type="button" className={vaultControl} disabled={directory.isFetchingNextPage} onClick={() => void directory.fetchNextPage()}>Load more vaults</button>}
  </div>;
}
