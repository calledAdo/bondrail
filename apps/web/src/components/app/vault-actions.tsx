'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccount, usePublicClient, useSwitchChain, useWalletClient } from 'wagmi';
import { erc20Abi, formatUnits, type Abi, type Address, type Hash } from 'viem';
import type { VaultView } from '@bondrail/sdk/vault';
import { vaultAbi } from '@/lib/abi';
import { chain, safeNetwork } from '@/lib/wallet';
import { receiptTimed } from '@/lib/tx';
import { depositGap, vaultAmount, vaultInputError } from '@/lib/vault-data';
import { useVaultBalance } from '@/lib/vaults';
import { Panel } from './ui';
import { Term } from './term';

export const vaultControl = 'min-h-11 rounded-lg border border-foreground/20 bg-background px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-50';
export function vaultMoney(value: bigint, v: VaultView) { return `${formatUnits(value, v.assetDecimals)} ${v.assetSymbol}`; }

export function useVaultTransaction() {
  const { address, chainId } = useAccount();
  const client = usePublicClient({ chainId: chain.id });
  const { data: wallet } = useWalletClient();
  const cache = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; hash?: Hash }>();
  const ready = !!address && !!wallet && safeNetwork && chainId === chain.id && !busy;
  async function send(label: string, to: Address, abi: Abi, functionName: string, args: readonly unknown[]) {
    if (!ready || !client || !wallet) return;
    setBusy(true); setStatus({ text: 'Confirm in your wallet…' });
    try {
      const call = { address: to, abi, functionName, args, account: address! };
      const { request } = await client.simulateContract(call);
      const gas = await client.estimateContractGas(call);
      const hash = await wallet.writeContract({ ...request, gas: gas * 12n / 10n } as never);
      setStatus({ text: 'Waiting for confirmation…', hash });
      const { receipt, ms } = await receiptTimed(client, hash);
      if (receipt.status !== 'success') throw new Error('The transaction reverted. Refresh the preview and try again.');
      setStatus({ text: `${label} confirmed in ${ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`}.`, hash });
      await cache.invalidateQueries({ predicate: q => String(q.queryKey[0]).startsWith('vault') });
      return true;
    } catch (error) {
      const e = error as { shortMessage?: string; message?: string };
      setStatus({ text: (e.shortMessage ?? e.message ?? 'Transaction failed.').slice(0, 300), error: true });
      return false;
    } finally { setBusy(false); }
  }
  return { ready, busy, status, send };
}
export function VaultTransactionStatus({ status }: { status: ReturnType<typeof useVaultTransaction>['status'] }) {
  return status ? <p role={status.error ? 'alert' : 'status'} className="break-words text-sm">
    {status.text}{' '}{status.hash && chain.blockExplorers && <a className="underline underline-offset-4" target="_blank" rel="noreferrer" href={`${chain.blockExplorers.default.url}/tx/${status.hash}`}>View transaction</a>}
  </p> : null;
}

export function VaultActions({ vault: v, initialAction = 'deposit' }: { vault: VaultView; initialAction?: 'deposit' | 'withdraw' }) {
  const { address, chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const client = usePublicClient({ chainId: chain.id });
  const [mode, setMode] = useState<'deposit' | 'withdraw'>(initialAction);
  const [unit, setUnit] = useState<'assets' | 'shares'>('assets');
  const [text, setText] = useState('');
  const [acknowledgedQuote, setAcknowledgedQuote] = useState<string>();
  const balance = useVaultBalance(v.address, v.asset, address);
  const tx = useVaultTransaction();
  const deposit = mode === 'deposit', byShares = !deposit && unit === 'shares';
  const amount = vaultAmount(text, byShares ? v.decimals : v.assetDecimals);
  const preview = useQuery({ queryKey: ['vault-preview', chain.id, v.address, mode, unit, amount?.toString()], enabled: !!client && amount !== undefined && amount > 0n,
    staleTime: 3000, refetchInterval: tx.busy ? false : 5000, retry: 1,
    queryFn: async () => {
      const blockNumber = await client!.getBlockNumber({ cacheTime: 0 });
      const base = { address: v.address, abi: vaultAbi, blockNumber } as const;
      const value = await client!.readContract({ ...base,
        functionName: deposit ? 'previewDeposit' : byShares ? 'previewRedeem' : 'previewWithdraw', args: [amount!] });
      const exitAssets = deposit ? await client!.readContract({ ...base, functionName: 'previewRedeem', args: [value] }) : undefined;
      return { value, exitAssets };
    },
  });
  const previewValue = preview.data?.value;
  const gap = deposit && amount !== undefined && preview.data?.exitAssets !== undefined
    ? depositGap(amount, preview.data.exitAssets) : undefined;
  const quoteKey = `${chain.id}:${v.address}:${address}:${amount}:${previewValue}:${preview.data?.exitAssets}`;
  const acknowledged = acknowledgedQuote === quoteKey;
  const b = balance.data;
  const maximum = deposit ? b?.maxDeposit ?? v.maxDeposit : byShares ? b?.maxRedeem : b?.maxWithdraw;
  const closed = deposit && maximum === 0n;
  const reason = vaultInputError({ connected: !!address, correctNetwork: chainId === chain.id && safeNetwork,
    amount, balance: deposit ? b?.cash : b?.shares, preview: previewValue, max: maximum, deposit, closed,
    readError: balance.isError || preview.isError });
  const error = reason && (text !== '' || !address || closed || chainId !== chain.id || balance.isError) ? reason : undefined;
  const approved = b !== undefined && amount !== undefined && b.allowance >= amount;
  const valid = !reason && tx.ready && !balance.isFetching && !preview.isFetching && (!gap?.requiresAcknowledgement || acknowledged);
  function changeAmount(value: string) { setText(value); setAcknowledgedQuote(undefined); }
  function max() {
    const value = deposit ? b && (b.cash < b.maxDeposit ? b.cash : b.maxDeposit) : maximum;
    if (value !== undefined) changeAmount(formatUnits(value, byShares ? v.decimals : v.assetDecimals));
  }
  return <Panel title="Your deposit & withdrawal" className="min-w-0">
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Vault action">
        {(['deposit', 'withdraw'] as const).map(m => <button key={m} type="button" disabled={tx.busy} aria-pressed={mode === m}
          className={`${vaultControl} ${mode === m ? 'bg-foreground text-background' : ''}`}
          onClick={() => { if (mode !== m) { setMode(m); changeAmount(''); } }}>{m === 'deposit' ? 'Deposit' : 'Withdraw'}</button>)}
      </div>
      {!deposit && <fieldset className="flex flex-wrap gap-4 text-sm"><legend className="mb-1 text-foreground/70">Withdraw by</legend>
        {(['assets', 'shares'] as const).map(u => <label key={u} className="flex min-h-11 items-center gap-2"><input type="radio" name="withdraw-unit" checked={unit === u} disabled={tx.busy} onChange={() => { setUnit(u); changeAmount(''); }} />{u === 'assets' ? 'Asset amount' : 'Shares'}</label>)}
      </fieldset>}
      <div>
        <label htmlFor="vault-amount" className="mb-2 block text-sm">Amount ({byShares ? 'shares' : v.assetSymbol})</label>
        <div className="flex gap-2"><input id="vault-amount" inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} disabled={tx.busy}
          onChange={e => changeAmount(e.target.value)} aria-describedby="vault-balance vault-input-error" aria-invalid={!!text && !!reason && !reason.startsWith('Reading')}
          className={`${vaultControl} min-w-0 flex-1 font-mono`} />
          <button type="button" onClick={max} disabled={!b || tx.busy} className={vaultControl}>Max</button></div>
        <p id="vault-balance" className="mt-2 text-xs text-foreground/70">{!address ? 'Connect to see your balance.' : b
          ? `Balance: ${deposit ? vaultMoney(b.cash, v) : `${formatUnits(b.shares, v.decimals)} shares · ${vaultMoney(b.value, v)} at exit price`}`
          : 'Reading your balance…'}</p>
      </div>
      <div className="min-h-16 rounded-lg border border-foreground/15 p-3 text-sm" aria-live="polite">
        {previewValue !== undefined && amount !== undefined && amount > 0n ? deposit
          ? <>You receive ≈ <strong>{formatUnits(previewValue, v.decimals)} shares</strong> at the entry price of {vaultMoney(v.entryPrice, v)}.</>
          : byShares ? <>You receive ≈ <strong>{vaultMoney(previewValue, v)}</strong> for {formatUnits(amount, v.decimals)} shares at the exit price.</>
          : <>You burn ≈ <strong>{formatUnits(previewValue, v.decimals)} shares</strong> to receive {vaultMoney(amount, v)} at the exit price.</>
          : <span className="text-foreground/70">{preview.isFetching ? 'Reading the current price…' : `Enter an amount to preview ${deposit ? 'your shares' : 'your withdrawal'}.`}</span>}
      </div>
      <div className="space-y-2 text-sm text-foreground/80">
        {deposit ? <>
          <p>Withdrawals are limited to the vault&apos;s idle cash (withdrawable now: {vaultMoney(v.idle, v)}).</p>
          <p>Returns come from bond repayments; there is no fixed rate.</p>
        </> : <>
          <p>You can withdraw up to <strong>{b ? vaultMoney(b.maxWithdraw, v) : 'your share of idle cash'}</strong> now; the rest is invested until bonds repay.</p>
          <p>Withdrawals use the <Term term="price">exit price</Term> of {vaultMoney(v.exitPrice, v)} per share.</p>
        </>}
        {v.entryPrice > v.exitPrice && <p>Entry price is higher than exit price because holdings are impaired. A new deposit can immediately be worth less at exit; losses can deepen or recover as bonds repay.</p>}
        <p className="text-xs">The transaction uses the price and available cash when it executes. Previewed amounts can change.</p>
      </div>
      {deposit && <ol aria-label="Deposit steps" className="grid grid-cols-2 gap-2 text-xs">
        <li className="border-t border-foreground/25 pt-2" aria-current={!approved ? 'step' : undefined}>1. Approve {v.assetSymbol}{approved ? ' · ready' : ''}</li>
        <li className="border-t border-foreground/25 pt-2" aria-current={approved ? 'step' : undefined}>2. Deposit</li>
      </ol>}
      <p id="vault-input-error" role={error && !error.startsWith('Reading') ? 'alert' : 'status'} className="min-h-5 text-sm">{error}</p>
      {!!address && chainId !== chain.id && <button type="button" onClick={() => switchChain({ chainId: chain.id })} className={`${vaultControl} w-full`}>Switch to {chain.name}</button>}
      {gap && previewValue !== 0n && <div className="space-y-2 rounded-lg border border-amber-600/60 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
        <p id="vault-gap-warning" role="status">If you withdrew right away you&apos;d get ≈ <strong>{vaultMoney(gap.exitAssets, v)}</strong> ({gap.percent}% less) — the gap closes as impaired bonds repay or settle.</p>
        {gap.requiresAcknowledgement && <label className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
          <input type="checkbox" className="mt-1 size-4 shrink-0 accent-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2" checked={acknowledged} disabled={tx.busy}
            aria-describedby="vault-gap-warning" onChange={e => setAcknowledgedQuote(e.target.checked ? quoteKey : undefined)} />
          <span>I understand that withdrawing right away would return less than I deposit.</span>
        </label>}
      </div>}
      <button id="vault-submit" type="button" disabled={!valid} className={`${vaultControl} w-full bg-primary font-medium text-primary-foreground`}
        onClick={() => {
          if (!valid || amount === undefined || !address) return;
          if (deposit && !approved) void tx.send('Approval', v.asset, erc20Abi, 'approve', [v.address, amount]);
          else void tx.send(deposit ? 'Deposit' : 'Withdrawal', v.address, vaultAbi, deposit ? 'deposit' : byShares ? 'redeem' : 'withdraw',
            deposit ? [amount, address] : [amount, address, address]);
        }}>{tx.busy ? 'Waiting for confirmation…' : closed ? 'Closed to deposits' : deposit ? approved ? 'Deposit' : `Approve ${v.assetSymbol}` : 'Withdraw'}</button>
      {(balance.isError || preview.isError) && <button type="button" className={`${vaultControl} w-full`} onClick={() => { void balance.refetch(); void preview.refetch(); }}>Retry balances and preview</button>}
      <VaultTransactionStatus status={tx.status} />
    </div>
  </Panel>;
}
