'use client';
import Link from 'next/link';
import { VaultPositions } from './vault-positions';
import { useAccount, useReadContracts } from 'wagmi';
import { formatUnits } from 'viem';
import { bondAbi } from '@/lib/abi';
import { chain } from '@/lib/wallet';
import { fmt, useProtocol } from '@/lib/protocol';
import { Empty, Panel, PhaseBadge, TierBadge } from './ui';

export function Portfolio() {
  const { address } = useAccount();
  const { data, loading } = useProtocol();
  const bonds = data?.bonds ?? [];
  // Typed loosely: a dynamic-length contract list makes wagmi's inference recurse too deeply.
  const contracts = bonds.map((b) => ({ address: b.address, abi: bondAbi, functionName: 'balanceOf', args: [address!], chainId: chain.id })) as never[];
  const balances = useReadContracts({
    contracts,
    query: { enabled: !!address && bonds.length > 0, refetchInterval: 10_000 },
  });
  const held = bonds
    .map((b, i) => ({ b, claims: (balances.data?.[i]?.result as bigint | undefined) ?? 0n }))
    .filter((x) => x.claims > 0n);
  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <p className="font-mono text-xs text-foreground/60">(portfolio)</p>
        <h1 className="text-4xl font-semibold">Your positions</h1>
        <p className="text-foreground/60">Your bond claims and vault shares, their current value, and the next action available.</p>
      </header>
      <VaultPositions />
      {!!address && <h2 className="text-2xl font-semibold">Your bond claims</h2>}
      {!address ? (
        <Empty title="Connect a wallet">Your balances are read straight from each bond and vault.</Empty>
      ) : loading || balances.isLoading ? (
        <div className="h-48 animate-pulse rounded-xl border border-foreground/10" />
      ) : held.length === 0 ? (
        <Empty title="No bond claims yet">
          <Link href="/markets" className="underline-offset-4 hover:underline">Browse markets</Link>
        </Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {held.map(({ b, claims }) => {
            const units = Number(formatUnits(claims, b.asset.decimals));
            return (
              <Link key={b.address} href={`/bonds/${b.address}`} className="block">
                <Panel title={b.name} aside={<div className="flex gap-1.5"><TierBadge tier={b.tier} /><PhaseBadge phase={b.phase} defaulted={b.defaulted} /></div>} className="transition-colors hover:border-foreground/25">
                  <dl className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <dt className="text-xs text-foreground/60">Claims</dt>
                      <dd className="font-mono tabular">[{units.toLocaleString('en-US', { maximumFractionDigits: 4 })}]</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-foreground/60">Redeemable now</dt>
                      <dd className="font-mono tabular">[{fmt(units * b.backingPerToken, b.asset)}]</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-sm underline underline-offset-4">{b.phase === 'Closed' ? 'Redeem claims' : b.phase === 'Cancelled' ? 'Claim refund' : b.phase === 'Funding' ? 'Manage funding' : 'Review repayment and exit'} →</p>
                </Panel>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
