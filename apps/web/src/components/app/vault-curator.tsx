'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAccount, usePublicClient } from 'wagmi';
import { formatUnits, type Address } from 'viem';
import { getVault, type VaultView } from '@bondrail/sdk/vault';
import { readBondTerms } from '@bondrail/sdk/client';
import { bondAbi, factoryAbi, vaultAbi } from '@/lib/abi';
import { chain, deployment } from '@/lib/wallet';
import { useProtocol } from '@/lib/protocol';
import { allocationHeadroom, vaultAmount } from '@/lib/vault-data';
import { Panel } from './ui';
import { useVaultTransaction, VaultTransactionStatus, vaultControl, vaultMoney } from './vault-actions';

export function VaultCurator({ vault }: { vault: VaultView }) {
  const { address } = useAccount();
  return address?.toLowerCase() === vault.curator.toLowerCase() ? <CuratorConsole vault={vault} /> : null;
}
function CuratorConsole({ vault: v }: { vault: VaultView }) {
  const { data, loading, error } = useProtocol();
  const client = usePublicClient({ chainId: chain.id });
  const [bond, setBond] = useState<Address>();
  const [text, setText] = useState('');
  const tx = useVaultTransaction();
  const candidates = (data?.bonds ?? []).filter(b => b.asset.address.toLowerCase() === v.asset.toLowerCase() && (b.phase === 'Funding' || v.holdings.some(h => h.toLowerCase() === b.address.toLowerCase())));
  const quote = useQuery({ queryKey: ['vault-curator-quote', chain.id, v.address, bond], enabled: !!client && !!bond && !!deployment.factory,
    staleTime: 5000, refetchInterval: tx.busy ? false : 5000,
    queryFn: async () => {
      const blockNumber = await client!.getBlockNumber();
      const b = { address: bond!, abi: bondAbi, blockNumber } as const;
      const [fresh, phase, asset, allowed, trackedProtocol, claims, heldValue, escrow, terms, block] = await Promise.all([
        getVault(client!, v.address, { blockNumber }), client!.readContract({ ...b, functionName: 'phase' }),
        client!.readContract({ ...b, functionName: 'asset' }),
        client!.readContract({ address: deployment.factory!, abi: factoryAbi, functionName: 'depositAllowed', args: [bond!], blockNumber }),
        client!.readContract({ address: deployment.factory!, abi: factoryAbi, functionName: 'isBond', args: [bond!], blockNumber }),
        client!.readContract({ ...b, functionName: 'balanceOf', args: [v.address] }),
        client!.readContract({ address: v.address, abi: vaultAbi, functionName: 'holdingValue', args: [bond!], blockNumber }),
        client!.readContract({ ...b, functionName: 'fundingEscrow' }), readBondTerms(client!, bond!), client!.getBlock({ blockNumber }),
      ]);
      const tracked = fresh.holdings.some(h => h.toLowerCase() === bond!.toLowerCase());
      const headroom = allocationHeadroom({ nav: fresh.nav, idle: fresh.idle, holdingValue: heldValue, cap: fresh.cap, buffer: fresh.buffer,
        holdings: fresh.holdings.length, maxBonds: fresh.maxBonds, tracked, raiseRemaining: terms.raiseAmount - escrow });
      return { phase, claims, tracked, headroom, funding: phase === 0 && Number(terms.fundingDeadline) > Number(block.timestamp),
        eligible: trackedProtocol && allowed && asset.toLowerCase() === v.asset.toLowerCase() };
    },
  });
  const q = quote.data, amount = vaultAmount(text, v.assetDecimals);
  const ready = tx.ready && !quote.isFetching && !quote.isError && !!q;
  return <Panel title="Curator console">
    <p className="mb-4 text-sm text-foreground/70">Allocate within the fixed mandate, recover a Funding allocation, or collect a settled holding.</p>
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <div className="space-y-2 text-sm"><label htmlFor="curator-bond" className="block">Bond</label><select id="curator-bond" value={bond ?? ''} disabled={tx.busy} onChange={e => { setBond(e.target.value as Address || undefined); setText(''); }} className={`${vaultControl} w-full`}>
        <option value="">Choose a bond</option>{candidates.map(b => <option key={b.address} value={b.address}>{b.name} · {b.phase}</option>)}
      </select></div>
      <label className="space-y-2 text-sm"><span>Allocation / raise withdrawal ({v.assetSymbol})</span><input value={text} disabled={tx.busy} onChange={e => setText(e.target.value)} inputMode="decimal" className={`${vaultControl} w-full`} /></label>
    </div>
    {loading && <p role="status" className="mt-3 text-sm">Loading eligible bonds…</p>}
    {(error || quote.isError) && <p role="alert" className="mt-3 text-sm">Could not verify bond eligibility and limits. Refresh before continuing.</p>}
    {!loading && !candidates.length && <p className="mt-3 text-sm">No eligible Funding bonds or tracked holdings are indexed for this asset.</p>}
    {q && <div className="mt-4 space-y-2 text-sm">
      <p>Allocation headroom: <strong>{vaultMoney(q.headroom.available, v)}</strong>. Per-bond headroom {vaultMoney(q.headroom.concentration, v)}; cash above the idle buffer {vaultMoney(q.headroom.liquidity, v)}.</p>
      <p>{q.headroom.slotAvailable ? 'Holding slot available.' : 'All holding slots are occupied.'} {q.tracked ? `Current claim balance: ${formatUnits(q.claims, v.assetDecimals)}.` : ''}</p>
      {q.funding && !q.eligible && <p role="alert">This bond is not currently eligible for allocation.</p>}
      {amount !== undefined && amount > q.headroom.available && q.funding && <p>Amount exceeds allocation headroom.</p>}
    </div>}
    <div className="my-4 flex flex-wrap gap-3">
      <button type="button" className={vaultControl} disabled={!ready || !q?.funding || !q.eligible || !amount || amount > q.headroom.available}
        onClick={() => void tx.send('Allocation', v.address, vaultAbi, 'allocate', [bond!, amount!])}>Allocate</button>
      <button type="button" className={vaultControl} disabled={!ready || !q?.funding || !q.tracked || !amount || amount > q.claims}
        onClick={() => void tx.send('Raise withdrawal', v.address, vaultAbi, 'withdrawFromRaise', [bond!, amount!])}>Withdraw from raise</button>
      <button type="button" className={vaultControl} disabled={!ready || !q?.tracked || ![3, 4].includes(q.phase) || q.claims === 0n}
        onClick={() => void tx.send('Collection', v.address, vaultAbi, 'collect', [bond!])}>Collect settled</button>
    </div>
    <VaultTransactionStatus status={tx.status} />
  </Panel>;
}
