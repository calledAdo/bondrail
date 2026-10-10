'use client';
import Link from 'next/link';
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
        <p className="text-foreground/60">Claims you hold, what they are worth if redeemed now, and where each bond stands.</p>
      </header>
      {!address ? (
        <Empty title="Connect a wallet">Your claim balances are read straight from each bond.</Empty>
      ) : loading || balances.isLoading ? (
        <div className="h-48 animate-pulse rounded-xl border border-foreground/10" />
      ) : held.length === 0 ? (
        <Empty title="No claims yet">
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
                </Panel>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
