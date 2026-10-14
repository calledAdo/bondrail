'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { usePublicClient } from 'wagmi';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { bondAbi, vaultAbi } from '@/lib/abi';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { Badge, Empty, Figure, Panel } from './ui';

const phases = ['Funding', 'Active', 'Closing', 'Closed', 'Cancelled'];

// Pin every read to one block so NAV, holdings and the share price describe the same portfolio.
async function readVault(client: NonNullable<ReturnType<typeof usePublicClient>>, address: Address) {
  const blockNumber = await client.getBlockNumber();
  const base = { address, abi: vaultAbi, blockNumber } as const;
  const [asset, decimals, nav, idle, curator, owner, held, cap, maxBonds, buffer, entryNav, unvested, pending, changeAfter, delay] = await Promise.all([
    client.readContract({ ...base, functionName: 'asset' }),
    client.readContract({ ...base, functionName: 'decimals' }),
    client.readContract({ ...base, functionName: 'totalAssets' }),
    client.readContract({ ...base, functionName: 'idleAssets' }),
    client.readContract({ ...base, functionName: 'curator' }),
    client.readContract({ ...base, functionName: 'owner' }),
    client.readContract({ ...base, functionName: 'holdings' }),
    client.readContract({ ...base, functionName: 'MAX_BOND_BPS' }),
    client.readContract({ ...base, functionName: 'MAX_BONDS' }),
    client.readContract({ ...base, functionName: 'MIN_IDLE_BPS' }),
    client.readContract({ ...base, functionName: 'entryAssets' }),
    client.readContract({ ...base, functionName: 'unvestedIncome' }),
    client.readContract({ ...base, functionName: 'pendingCurator' }),
    client.readContract({ ...base, functionName: 'curatorChangeAfter' }),
    client.readContract({ ...base, functionName: 'CURATOR_DELAY' }),
  ]);
  // Fail explicitly for a misconfigured contract instead of querying an unbounded address list.
  if (held.length > 16) throw new Error('Unexpected vault holdings limit');
  const [symbol, assetDecimals, exitPrice, entryPrice, holdings] = await Promise.all([
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'symbol', blockNumber }),
    client.readContract({ address: asset, abi: erc20Abi, functionName: 'decimals', blockNumber }),
    client.readContract({ ...base, functionName: 'previewRedeem', args: [10n ** BigInt(decimals)] }),
    client.readContract({ ...base, functionName: 'previewMint', args: [10n ** BigInt(decimals)] }),
    Promise.all(held.map(async (bond) => {
      const b = { address: bond, abi: bondAbi, blockNumber } as const;
      const [name, phase, claims, value, realized, cost, triggered, defaultedAt] = await Promise.all([
        client.readContract({ ...b, functionName: 'name' }),
        client.readContract({ ...b, functionName: 'phase' }),
        client.readContract({ ...b, functionName: 'balanceOf', args: [address] }),
        client.readContract({ ...base, functionName: 'holdingValue', args: [bond] }),
        client.readContract({ ...base, functionName: 'holdingRealizedValue', args: [bond] }),
        client.readContract({ ...base, functionName: 'costBasis', args: [bond] }),
        client.readContract({ ...b, functionName: 'triggered' }),
        client.readContract({ ...b, functionName: 'defaultedAt' }),
      ]);
      return { bond, name, phase, claims, value, realized, cost, triggered, defaulted: defaultedAt > 0n };
    })),
  ]);
  return { blockNumber, asset, symbol, assetDecimals, nav, idle, exitPrice, entryPrice, curator, owner, holdings, cap, maxBonds, buffer, entryNav, unvested, pending, changeAfter, delay };
}

export function CreditVault() {
  const client = usePublicClient({ chainId: chain.id });
  const address = deployment.vault;
  const query = useQuery({
    queryKey: ['credit-vault', chain.id, address],
    enabled: !!client && !!address && safeNetwork,
    queryFn: () => readVault(client!, address!),
    refetchInterval: 30_000,
    retry: 1,
  });
  const data = query.data;
  const amount = (value: bigint) => data ? `${formatUnits(value, data.assetDecimals)} ${data.symbol}` : '—';
  const invalidAddress = !address && !!process.env.NEXT_PUBLIC_VAULT_ADDRESS;
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="font-mono text-xs text-foreground/60">(credit vault)</p>
        <h1 className="text-4xl font-semibold">One deposit. A portfolio of revenue bonds.</h1>
        <p className="max-w-3xl text-foreground/70">A disclosed curator allocates within fixed limits. Healthy bonds are carried at unrecovered cost. Exit prices reflect rule-based losses; realized profit enters share value over seven days.</p>
        <Badge>{address ? 'Read-only' : 'Not yet deployed'}</Badge>
      </header>

      {!safeNetwork ? <Empty title="Unsupported network configuration">Select a supported Bondrail network to read the vault.</Empty>
        : invalidAddress ? <Empty title="Invalid vault address">The configured vault address is not valid.</Empty>
        : !address ? <Empty title="Not yet deployed">No vault is configured on {chain.name}. Balances, holdings and curator details will appear here after deployment.</Empty>
        : query.isPending ? <p role="status" className="text-foreground/70">Reading vault balances…</p>
        : null}
      {address && safeNetwork && query.isError && (
        <div role="alert" className="rounded-xl border border-red-500/30 p-5">
          <p>{data ? `Could not refresh. Showing the last successful snapshot at block ${data.blockNumber}.` : 'Could not read the configured vault. Check its address and network connection.'}</p>
          <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching} className="mt-2 min-h-11 rounded-lg px-3 underline underline-offset-4 disabled:opacity-50">Retry</button>
        </div>
      )}

      <Panel title="Vault valuation" aside={data && <Badge>Open to deposits</Badge>}>
        <dl className="grid gap-6 sm:grid-cols-3">
          <Figure label="Entry price / share" value={data ? amount(data.entryPrice) : '—'} />
          <Figure label="Exit price / share" value={data ? amount(data.exitPrice) : '—'} />
          <Figure label="Idle liquidity" value={data ? amount(data.idle) : '—'} />
          <Figure label="Entry net asset value" value={data ? amount(data.entryNav) : '—'} />
          <Figure label="Exit net asset value" value={data ? amount(data.nav) : '—'} />
          <Figure label="Unvested income" value={data ? amount(data.unvested) : '—'} />
        </dl>
        <p className="mt-5 max-w-3xl text-sm text-foreground/70">Deposits remain open while bonds are active. Entry prices ignore trigger and default impairments; exit prices include them. Both prices exclude unvested income. Withdrawals are limited to idle cash and can exhaust it. Claims stay invested until settlement or cancellation.</p>
        {data && <p className="mt-3 text-xs text-foreground/60">{chain.name} · block {data.blockNumber.toString()} · refreshes every 30 seconds</p>}
      </Panel>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel title="Bond holdings" aside={data && <span className="font-mono text-sm">{data.holdings.length} / {data.maxBonds.toString()}</span>}>
          {!data ? <p className="text-sm text-foreground/70">Holdings are unavailable until the vault can be read.</p>
            : data.holdings.length === 0 ? <p className="text-sm text-foreground/70">No bonds allocated. All backing is idle.</p>
            : <ul className="divide-y divide-foreground/10">
              {data.holdings.map((holding) => (
                <li key={holding.bond} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/bonds/${holding.bond}`} className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline">{holding.name}</Link>
                    <div className="flex flex-wrap gap-2"><Badge>{phases[holding.phase] ?? 'Unknown'}</Badge>{holding.defaulted ? <Badge tone="danger">Defaulted</Badge> : holding.triggered && <Badge tone="danger">Performance trigger</Badge>}</div>
                  </div>
                  <p className="break-all font-mono text-xs text-foreground/60">{holding.bond}</p>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <Figure label="Claims held" value={formatUnits(holding.claims, data.assetDecimals)} />
                    <Figure label="Cost basis" value={amount(holding.cost)} />
                    <Figure label="Realized backing" value={amount(holding.realized)} />
                    <Figure label="Exit carrying value" value={amount(holding.value)} />
                  </dl>
                </li>
              ))}
            </ul>}
          <p className="mt-5 text-sm text-foreground/70">Holding values are before the vault-wide income vesting deduction. Carrying at cost assumes healthy bonds keep paying; impairments are rules, not market prices.</p>
        </Panel>
        <Panel title="Mandate & curator">
          <dl className="space-y-4 text-sm">
            <div><dt className="text-foreground/60">Maximum per bond</dt><dd>{data ? Number(data.cap) / 100 : 25}% of exit NAV at allocation</dd></div>
            <div><dt className="text-foreground/60">Minimum idle buffer</dt><dd>{data ? Number(data.buffer) / 100 : 20}% at allocation</dd></div>
            <div><dt className="text-foreground/60">Maximum holdings</dt><dd>{data ? data.maxBonds.toString() : 16} bonds</dd></div>
            <div><dt className="text-foreground/60">Curator replacement delay</dt><dd>{data ? Number(data.delay) / 86_400 : 2} days</dd></div>
            <div><dt className="text-foreground/60">Curator</dt><dd className="break-all font-mono">{data?.curator ?? 'Unavailable'}</dd></div>
            <div><dt className="text-foreground/60">Owner</dt><dd className="break-all font-mono">{data?.owner ?? 'Unavailable'}</dd></div>
            {data && data.changeAfter > 0n && <div><dt className="text-foreground/60">Proposed curator</dt><dd className="break-all font-mono">{data.pending}</dd><dd className="mt-1">Can be applied after {new Date(Number(data.changeAfter) * 1000).toISOString()}.</dd></div>}
          </dl>
          <p className="mt-5 text-xs text-foreground/70">{data ? 'Limits are fixed. The owner can only replace the curator after the delay.' : 'These are the design limits; no live vault settings have been read.'} Concentrations can change as NAV changes or investors withdraw.</p>
          {address && <p className="mt-4 break-all font-mono text-xs text-foreground/60">Vault: {address}</p>}
        </Panel>
      </div>
    </div>
  );
}
