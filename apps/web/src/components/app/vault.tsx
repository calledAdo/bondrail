'use client';
import Link from 'next/link';
import type { Address } from 'viem';
import { formatUnits } from 'viem';
import { useVault, useVaultHistory, useVaultHoldingsDetail } from '@/lib/vaults';
import { chain } from '@/lib/wallet';
import { Badge, Empty, Figure, Panel } from './ui';
import { Term } from './term';
import { VaultActions, vaultControl, vaultMoney } from './vault-actions';
import { AddressLink, VaultDisclosure, VaultTrend } from './vaults';
import { VaultCurator } from './vault-curator';
const phases = ['Funding', 'Active', 'Closing', 'Closed', 'Cancelled'];

export function CreditVault({ address, initialAction }: { address: Address; initialAction?: 'deposit' | 'withdraw' }) {
  const query = useVault(address);
  const v = query.data;
  const holdings = useVaultHoldingsDetail(address, v?.holdings);
  const history = useVaultHistory([address]);
  if (!v) return <div className="space-y-5"><Link href="/vaults" className="underline underline-offset-4">← All vaults</Link>
    {query.isError ? <Empty title="Vault could not be loaded"><p>{query.error.message}</p><button type="button" onClick={() => void query.refetch()} className={`${vaultControl} mt-4`}>Retry</button></Empty>
      : <p role="status">Reading vault balances and mandate…</p>}</div>;
  const money = (value: bigint) => vaultMoney(value, v);
  return <div className="space-y-8">
    <header className="max-w-4xl space-y-3">
      <Link href="/vaults" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">← All vaults</Link>
      <div className="flex flex-wrap items-center gap-3"><h1 className="break-words text-3xl font-semibold sm:text-4xl">{v.name}</h1><Badge>{v.maxDeposit > 0n ? 'Open to deposits' : 'Closed to deposits'}</Badge></div>
      <p className="text-foreground/80">This vault, curated by <AddressLink address={v.curator} />, spreads deposits across revenue bonds under fixed limits. {v.holdings.length} {v.holdings.length === 1 ? 'holding' : 'holdings'}, {money(v.idle)} withdrawable now.</p>
      <p className="text-sm text-foreground/70">{v.strategy?.description ?? 'Diversified revenue bonds under fixed allocation limits'}</p>
      <VaultDisclosure vault={v} />
    </header>
    {query.isError && <p role="alert">Could not refresh. Showing the last successful read at block {v.blockNumber.toString()}. <button className="underline" onClick={() => void query.refetch()}>Retry</button></p>}
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <Panel title="Vault value" className="[&_dd]:break-words [&_dd]:text-base">
          <dl className="grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Figure label={<Term term="nav">Net asset value</Term>} value={money(v.nav)} bracket={false} />
            <Figure label="Withdrawable now" value={money(v.idle)} bracket={false} />
            <Figure label="Holdings" value={v.holdings.length} bracket={false} />
            <Figure label={<Term term="price">Entry price / share</Term>} value={money(v.entryPrice)} bracket={false} />
            <Figure label={<Term term="price">Exit price / share</Term>} value={money(v.exitPrice)} bracket={false} />
          </dl>
          <div className="mt-5 border-t border-foreground/10 pt-4"><VaultTrend vault={v} snapshots={history.data?.VaultDailySnapshot ?? []} /></div>
          <p className="mt-3 text-xs text-foreground/60">{chain.name} · block {v.blockNumber.toString()} · refreshes every 15 seconds</p>
        </Panel>
        <Panel title="How you could lose money">
          <ul className="list-disc space-y-3 pl-5 text-sm text-foreground/80">
            <li>Bonds can earn less than expected or <Term term="default">default</Term>. The vault writes down unpaid capital, reducing the value of your shares.</li>
            <li>Exits are limited to idle cash. Other holders can withdraw it first; invested money remains tied up until bonds repay or settle.</li>
            <li>The <Term term="curator">curator</Term> chooses the holdings. Fixed limits reduce concentration but cannot prevent poor choices, correlated losses, or curator inactivity.</li>
            <li>This is testnet software and has not been audited. Contract bugs and asset failures can cause losses.</li>
          </ul>
        </Panel>
      </div>
      <div className="min-w-0" id="transact"><VaultActions key={`${v.address}:${initialAction}`} vault={v} initialAction={initialAction} /></div>
    </div>
    <Panel title="Holdings">
      {holdings.isError ? <p role="alert">Could not read holdings. <button className={vaultControl} onClick={() => void holdings.refetch()}>Retry holdings</button></p>
        : holdings.isPending ? <p role="status">Reading holdings…</p>
        : !holdings.data.length ? <p className="text-sm text-foreground/70">The vault currently holds only cash. The curator can allocate it to eligible Funding bonds.</p>
        : <ul className="divide-y divide-foreground/10">{holdings.data.map(h => <li key={h.bond} className="grid gap-3 py-4 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div><Link href={`/bonds/${h.bond}`} className="font-medium underline-offset-4 hover:underline">{h.name}</Link><p className="mt-1 text-xs text-foreground/70">{phases[h.phase]}{h.defaulted ? ' · defaulted' : h.triggered ? ' · performance trigger active' : ''}</p></div>
          <div className="text-sm sm:text-right"><p className="font-mono">{money(h.value)}</p><p className="text-xs text-foreground/70">{formatUnits(h.claims, v.assetDecimals)} claims · cost {money(h.cost)}</p></div>
        </li>)}</ul>}
    </Panel>
    <Panel title="Mandate">
      <p className="mb-4 text-sm text-foreground/80">{v.strategy?.description ?? 'Diversified revenue bonds under fixed allocation limits'}. Strategy text describes the curator&apos;s intent; eligibility includes both <Term term="native">Native</Term> and <Term term="watched">Watched</Term> bonds.</p>
      <dl className="grid gap-5 sm:grid-cols-3"><Figure label="Maximum per bond" value={`${Number(v.cap) / 100}%`} bracket={false} /><Figure label="Maximum holdings" value={v.maxBonds.toString()} bracket={false} /><Figure label="Minimum idle at allocation" value={`${Number(v.buffer) / 100}%`} bracket={false} /></dl>
      <p className="mt-4 text-sm text-foreground/70">Limits apply when allocating and cannot be loosened. Withdrawals can exhaust idle cash. Owner changes to the curator have a {Number(v.delay / 86400n)}-day delay; the owner cannot transfer vault funds.</p>
      {v.pending !== '0x0000000000000000000000000000000000000000' && <p className="mt-3 text-sm">Proposed curator <AddressLink address={v.pending} /> · executable after {new Date(Number(v.changeAfter) * 1000).toISOString()}.</p>}
    </Panel>
    <VaultCurator vault={v} />
    <details className="rounded-xl border border-foreground/10 p-5"><summary className="cursor-pointer text-sm font-medium">Technical details</summary>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        {([['Vault', v.address], ['Asset', v.asset], ['Owner', v.owner], ['Curator', v.curator]] as const).map(([label, a]) => <div key={label}><dt className="mb-1 text-foreground/70">{label}</dt><dd><AddressLink address={a} full /></dd></div>)}
        <div><dt className="text-foreground/70">Share supply</dt><dd>{formatUnits(v.supply, v.decimals)} {v.symbol}</dd></div>
        <div><dt className="text-foreground/70">Entry NAV / unvested income</dt><dd>{money(v.entryNav)} / {money(v.unvested)}</dd></div>
        {v.strategy && <div className="min-w-0 sm:col-span-2"><dt className="text-foreground/70">Metadata hash</dt><dd className="break-all font-mono text-xs">{v.strategy.metadataHash}</dd></div>}
      </dl>
      <p className="mt-5 text-sm text-foreground/70">ERC-4626 shares use {v.decimals} decimals; {v.assetSymbol} uses {v.assetDecimals}. Healthy holdings are carried at unrecovered cost. Entry NAV excludes unrealized trigger/default impairments; exit NAV includes them. Both exclude unvested profit, which enters share value over seven days.</p>
    </details>
  </div>;
}
