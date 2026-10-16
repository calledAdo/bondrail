'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useAccount, useReadContract } from 'wagmi';
import { erc20Abi } from 'viem';
import { bondAction, vaultHoldsBond } from '@/lib/bond-decision';
import { chain } from '@/lib/wallet';
import { useVaultHoldings, type AccountView, type BondView } from '@/lib/protocol';
import { BondActions } from './bond-actions';
import { Trade } from './trade';
import { TermsText } from './term';
import { Panel } from './ui';
export type BondIntent = 'deposit' | 'withdraw' | 'buy' | 'sell' | 'redeem' | 'refund';
const quiet = 'inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:text-foreground/70';
export function DecisionLinks({ b, now, onSelect, primary = true }: { b: BondView; now: number; onSelect: (intent: BondIntent) => void; primary?: boolean }) {
  const { address } = useAccount();
  const balance = useReadContract({ address: b.address, abi: erc20Abi, functionName: 'balanceOf', args: address ? [address] : undefined, chainId: chain.id, query: { enabled: !!address, refetchInterval: 10000 } });
  const [shared, setShared] = useState('');
  const action = bondAction(b, now);
  const holdings = useVaultHoldings(b.phase === 'Active' && !b.kuru);
  const vaultLink = primary && b.phase === 'Active' && !b.kuru && !holdings.isError && vaultHoldsBond(b.address, holdings.data);
  const intent: BondIntent = b.phase === 'Funding' ? 'deposit' : b.phase === 'Active' ? 'buy' : b.phase === 'Closed' ? 'redeem' : 'refund';
  return <div>
    {action.message && !vaultLink && <p className="text-sm font-medium"><TermsText>{action.message}</TermsText></p>}
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
      {vaultLink && <Link href="/vault" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">View vault holdings</Link>}
      {action.primary && <button type="button" onClick={() => onSelect(intent)} className={primary ? 'inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90' : quiet}>{action.primary}</button>}
      {!primary && b.phase === 'Funding' && (balance.data ?? 0n) > 0n && now < b.fundingDeadline && <button type="button" onClick={() => onSelect('withdraw')} className={quiet}>Withdraw</button>}
      {!primary && b.phase === 'Funding' && action.primary && <button type="button" className={quiet} onClick={async () => { try { await navigator.clipboard.writeText(location.href); setShared('Link copied'); } catch { setShared('Copy the page address to share this bond.'); } }}>Share link</button>}
      {!primary && b.phase === 'Active' && b.kuru && <button type="button" onClick={() => onSelect('sell')} className={quiet}>Sell claims</button>}
      {!primary && b.phase === 'Active' && <button type="button" onClick={() => onSelect('redeem')} className={quiet}>Redeem early</button>}
    </div>
    {shared && <p role="status" className="text-xs text-foreground/70">{shared}</p>}
  </div>;
}
export function DecisionPanel({ b, account, now, intent, onSelect }: { b: BondView; account?: AccountView; now: number; intent: BondIntent | null; onSelect: (intent: BondIntent) => void }) {
  return <div id="bond-actions" className="scroll-mt-24">
    <Panel compact title="What you can do now" className="p-4 sm:p-6">
      <DecisionLinks b={b} now={now} onSelect={onSelect} primary={false} />
      {intent && b.phase !== 'Closing' && <div className="mt-4 max-w-lg border-t border-foreground/10 pt-4">
        <h3 className="mb-4 font-medium">{intent === 'redeem' && b.phase === 'Active' ? 'Review early redemption' : `${intent[0].toUpperCase()}${intent.slice(1)}`}</h3>
        {b.kuru && b.phase === 'Active' && (intent === 'buy' || intent === 'sell') ? <Trade key={intent} b={b} initialSide={intent} /> : <BondActions key={intent} b={b} account={account} onDone={() => undefined} mode="investor" intent={intent} />}
      </div>}
    </Panel>
  </div>;
}
