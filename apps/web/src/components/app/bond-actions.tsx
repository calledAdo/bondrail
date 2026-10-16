'use client';
// The bond's decision panel: what the connected wallet can do right now, for investors, the issuer and
// anyone (housekeeping). Every write simulates first and reports the receipt; nothing is assumed.
import { useEffect, useRef, useState } from 'react';
import { useAccount, usePublicClient, useReadContracts, useWalletClient } from 'wagmi';
import { erc20Abi, formatUnits, isAddress, parseUnits, type Abi, type Address, type Hash } from 'viem';
import { ExternalLink } from 'lucide-react';
import { accountAbi, bondAbi, factoryAbi } from '@/lib/abi';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { fmt, type AccountView, type BondView } from '@/lib/protocol';
import { earlyRedemptionEstimate } from '@/lib/bond-yield';
import { bondrailCreditRegistryAbi } from '@bondrail/sdk/abis';
import { cn } from '@/lib/cn';
import { depositPauseReason } from '@/lib/bond-decision';
import { TermsText } from './term';
import { confirmedIn, receiptTimed } from '@/lib/tx';

type Call = { address: Address; abi: Abi; functionName: string; args?: unknown[] };

function Button({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'min-h-11 w-full rounded-lg px-4 text-sm font-medium transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40',
        primary ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-foreground/15 hover:bg-foreground/5',
      )}
    >
      {children}
    </button>
  );
}

export function BondActions({ b, account, onDone, mode = 'all', intent }: { b: BondView; account?: AccountView; onDone: () => void; mode?: 'all' | 'investor' | 'maintenance'; intent?: string }) {
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; hash?: Hash }>();
  const [signed, setSigned] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [projectionTime, setProjectionTime] = useState(0);

  const reads = useReadContracts({
    contracts: [
      { address: b.address, abi: bondAbi, functionName: 'issuer', chainId: chain.id },
      { address: b.address, abi: bondAbi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'], chainId: chain.id },
      { address: b.asset.address, abi: erc20Abi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'], chainId: chain.id },
      { address: b.asset.address, abi: erc20Abi, functionName: 'allowance', args: [address ?? '0x0000000000000000000000000000000000000000', b.address], chainId: chain.id },
      { address: b.address, abi: bondAbi, functionName: 'settleAfter', chainId: chain.id },
      { address: b.address, abi: bondAbi, functionName: 'pool', chainId: chain.id },
      { address: b.address, abi: bondAbi, functionName: 'totalSupply', chainId: chain.id },
    ],
    query: { enabled: !!address, refetchInterval: busy ? false : 5000 },
  });
  const [issuer, claims, cash, allowance, settleAfter, pool, supply] = (reads.data ?? []).map((r) => r.result) as [Address?, bigint?, bigint?, bigint?, bigint?, bigint?, bigint?];
  const isIssuer = !!address && !!issuer && issuer.toLowerCase() === address.toLowerCase();
  const d = b.asset.decimals;
  const now = Date.now() / 1000;
  const ready = !!address && chainId === chain.id && safeNetwork && !busy;
  const value = /^\d+(\.\d+)?$/.test(amount) && (amount.split('.')[1]?.length ?? 0) <= d ? parseUnits(amount, d) : 0n;
  // What redeem pays, exactly as BondrailBond.redeem computes it: tokens × pool / supply.
  const proceeds = pool === undefined || !supply ? 0n : value >= supply ? pool : (value * pool) / supply;
  const early = b.phase === 'Active';
  const paused = depositPauseReason(b, now);
  const canRedeem = ready && !reads.isError && value > 0n && claims !== undefined && value <= claims
    && supply !== undefined && value <= supply && proceeds > 0n && (!early || value < supply);
  const estimate = earlyRedemptionEstimate({ ...b,
    pool: pool === undefined ? NaN : Number(formatUnits(pool, d)),
    supply: supply === undefined ? NaN : Number(formatUnits(supply, d)),
  }, account, Number(formatUnits(value, d)), confirming ? projectionTime : now);
  // A changed amount, wallet, backing or projection requires a fresh acknowledgement.
  const quoteKey = [b.address, address, chainId, b.phase, value, pool, supply, claims,
    estimate?.additional.toFixed(6)].join(':');

  async function send(label: string, call: Call) {
    setBusy(true);
    setStatus({ text: 'Confirm in your wallet…' });
    try {
      if (!client || !wallet || !address) throw new Error('Connect a wallet on ' + chain.name + '.');
      const sim = (await client.simulateContract({ account: address, ...call } as never)) as unknown as { request: never };
      const hash = await wallet.writeContract(sim.request);
      setStatus({ text: 'Waiting for the receipt…', hash });
      const { receipt: r, ms } = await receiptTimed(client as never, hash);
      if (r.status !== 'success') throw new Error('The transaction reverted.');
      setStatus({ text: `${label}: ${confirmedIn(ms)}.`, hash });
      await reads.refetch();
      setConfirming(false);
      onDone();
    } catch (e) {
      // viem puts the decoded contract error (e.g. "Error: InvalidTerms()") in metaMessages.
      const m = e as { shortMessage?: string; message?: string; metaMessages?: string[] };
      const reason = m.metaMessages?.find((x) => x.startsWith('Error:'))?.replace('Error: ', '');
      setStatus({ text: (reason ? `Reverted with ${reason}` : m.shortMessage ?? m.message ?? 'Failed.').slice(0, 300), error: true });
    } finally {
      setBusy(false);
    }
  }

  const factory = deployment.factory;
  const releaseSigned = () => {
    try {
      const { milestone: m, signature } = JSON.parse(signed);
      if (!m || !isAddress(m.bond) || m.bond.toLowerCase() !== b.address.toLowerCase() || !/^0x[\da-fA-F]{130}$/.test(signature))
        throw new Error('Paste { milestone, signature } from the milestone signer for this bond.');
      const n = (v: unknown) => BigInt(String(v));
      const milestone = {
        bond: m.bond,
        policyHash: m.policyHash,
        periodStart: n(m.periodStart),
        periodEnd: n(m.periodEnd),
        eligibleRevenue: n(m.eligibleRevenue),
        evidenceHash: m.evidenceHash,
        expiresAt: n(m.expiresAt),
        nonce: n(m.nonce),
      };
      return send('Second release', { address: factory!, abi: factoryAbi as Abi, functionName: 'releaseSecondSigned', args: [b.address, milestone, signature] });
    } catch (e) {
      setStatus({ text: (e as Error).message, error: true });
    }
  };

  const fmtUnits = (v?: bigint) => (v === undefined ? '–' : Number(formatUnits(v, d)).toLocaleString('en-US', { maximumFractionDigits: 4 }));

  return (
    <div className="space-y-6">
      {mode !== 'maintenance' && <>{!address ? (
        <p className="text-sm text-foreground/70">Connect a wallet to fund, redeem or manage this bond.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-foreground/70"><TermsText>Your claims</TermsText></dt>
            <dd className="font-mono tabular">{fmtUnits(claims)}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/70">Your {b.asset.symbol}</dt>
            <dd className="font-mono tabular">{fmtUnits(cash)}</dd>
          </div>
        </dl>
      )}

      {/* Investors */}
      {(b.phase === 'Funding' || b.phase === 'Active' || b.phase === 'Closed' || b.phase === 'Cancelled') && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-foreground/70">Amount ({b.phase === 'Funding' ? b.asset.symbol : 'claims'})</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setConfirming(false); }}
              placeholder="0.00"
              className="min-h-11 w-full rounded-lg border border-foreground/15 bg-transparent px-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-foreground"
            />
          </label>
          {b.phase === 'Funding' && (
            <>
              {paused && <p className="text-sm text-foreground/80">Deposits paused: {paused}.</p>}
              {!paused && intent !== 'withdraw' && ((allowance ?? 0n) < value ? (
                <Button primary disabled={!ready || value === 0n} onClick={() => send('Approve', { address: b.asset.address, abi: erc20Abi as Abi, functionName: 'approve', args: [b.address, value] })}>
                  Approve {b.asset.symbol}
                </Button>
              ) : (
                <Button primary disabled={!ready || value === 0n || !!paused || value > (cash ?? 0n) || Number(formatUnits(value, d)) > b.raise - b.raised} onClick={() => send('Deposit', { address: b.address, abi: bondAbi as Abi, functionName: 'deposit', args: [value] })}>
                  Deposit
                </Button>
              ))}
              {(claims ?? 0n) > 0n && (
                <>
                  <Button disabled={!ready || value === 0n || value > (claims ?? 0n) || now >= b.fundingDeadline} onClick={() => send('Withdraw', { address: b.address, abi: bondAbi as Abi, functionName: 'withdraw', args: [value, address] })}>
                    Withdraw
                  </Button>
                  <p className="text-xs text-foreground/70"><TermsText>Before activation and the funding deadline, you can take your deposit back (claims burn 1:1). Activation needs the full raise.</TermsText></p>
                </>
              )}
            </>
          )}
          {(b.phase === 'Active' || b.phase === 'Closed') && (
            <>
              {value > 0n && (
                <dl className="space-y-1 rounded-lg border border-foreground/10 p-3 text-xs">
                  {(
                    [
                      ['Claims burned', fmtUnits(value)],
                      ['You receive now', `${fmtUnits(proceeds)} ${b.asset.symbol}`],
                      ['Claims left', fmtUnits(claims !== undefined && claims > value ? claims - value : 0n)],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4">
                      <dt className="text-foreground/70"><TermsText>{k}</TermsText></dt>
                      <dd className="font-mono tabular">{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <Button
                primary={!early}
                disabled={!canRedeem}
                onClick={() => early ? (setProjectionTime(now), setConfirming(true)) : send('Redeem', { address: b.address, abi: bondAbi as Abi, functionName: 'redeem', args: [value, address] })}
              >
                {proceeds === 0n && value > 0n ? 'Nothing to redeem yet' : early ? 'Redeem early' : 'Redeem'}
              </Button>
              {early && <p className="text-xs text-foreground/70"><TermsText>Early redemption burns claims for current backing and gives up their future receipts.</TermsText></p>}
              {value > (claims ?? 0n) && address && <p className="text-xs text-foreground/80"><TermsText>Enter no more than your claim balance.</TermsText></p>}
              {confirming && early && (
                <EarlyRedemptionConfirmation key={quoteKey}
                  burned={formatUnits(value, d)} cash={`${formatUnits(proceeds, d)} ${b.asset.symbol}`}
                  estimate={estimate} b={b} disabled={!canRedeem} busy={busy}
                  onCancel={() => setConfirming(false)}
                  onConfirm={() => { if (canRedeem) void send('Redeem', { address: b.address, abi: bondAbi as Abi, functionName: 'redeem', args: [value, address] }); }}
                  status={status?.text}
                />
              )}
              {b.phase !== 'Closed' && <p className="text-xs text-foreground/70"><TermsText>The last outstanding claim waits for the bond to close.</TermsText></p>}
            </>
          )}
          {b.phase === 'Cancelled' && (
            <Button primary disabled={!ready || value === 0n || value > (claims ?? 0n)} onClick={() => send('Refund', { address: b.address, abi: bondAbi as Abi, functionName: 'refund', args: [value, address] })}>
              Refund
            </Button>
          )}
        </div>
      )}

      </>}
      {mode !== 'investor' && <>
      {/* Issuer */}
      {isIssuer && factory && (
        <div className="space-y-3 border-t border-foreground/10 pt-5">
          <p className="text-xs font-medium uppercase tracking-wider text-foreground/70">Issuer</p>
          {b.phase === 'Funding' && (
            <Button disabled={!ready || b.raised < b.raise} onClick={() => send('Activate', { address: factory, abi: factoryAbi as Abi, functionName: 'activate', args: [b.address] })}>
              Activate {b.raised < b.raise && '(needs the full raise)'}
            </Button>
          )}
          {b.phase === 'Active' && b.undrawn > 0 && b.milestoneMode === 'Onchain' && (
            <Button disabled={!ready || now < b.secondReleaseNotBefore} onClick={() => send('Second release', { address: factory, abi: factoryAbi as Abi, functionName: 'releaseSecond', args: [b.address] })}>
              Request second release
            </Button>
          )}
          {b.phase === 'Active' && b.undrawn > 0 && b.milestoneMode === 'Signed' && (
            <details className="space-y-2">
              <summary className="cursor-pointer text-sm text-foreground/70">Submit a signed milestone</summary>
              <textarea
                rows={4}
                value={signed}
                onChange={(e) => setSigned(e.target.value)}
                placeholder='{"milestone": {…}, "signature": "0x…"}'
                className="w-full rounded-lg border border-foreground/15 bg-transparent p-3 font-mono text-xs outline-none"
              />
              <Button disabled={!ready || !signed} onClick={releaseSigned}>
                Validate and release
              </Button>
            </details>
          )}
        </div>
      )}

      {/* Anyone */}
      <details className="space-y-3 border-t border-foreground/10 pt-2">
        <summary className="cursor-pointer py-3 text-sm text-foreground/70">Maintenance (anyone can run)</summary>
        <p className="text-xs text-foreground/70">Book and split plain transfers waiting in the account. Bondrail-facilitated account settlements are already split.</p>
        <Button disabled={!ready} onClick={() => send('Sweep', { address: b.account, abi: accountAbi as Abi, functionName: 'sweep' })}>
          Book pending transfers (sweep)
        </Button>
        {b.phase === 'Active' && b.triggerWindowDays > 0 && !b.defaulted && <>
          <p className="pt-2 text-xs text-foreground/70"><TermsText>Check complete UTC revenue days and update the investor share if the performance trigger applies.</TermsText></p>
          <Button disabled={!ready} onClick={() => send('Trigger checked', { address: b.address, abi: bondAbi as Abi, functionName: 'checkTrigger' })}>Check performance trigger</Button>
        </>}
        {deployment.creditRegistry && <>
          <p className="pt-2 text-xs text-foreground/70">Add this bond to the account’s registry repayment record if it has not been recorded yet.</p>
          <Button disabled={!ready} onClick={() => send('Bond recorded', { address: deployment.creditRegistry!, abi: bondrailCreditRegistryAbi as Abi, functionName: 'recordBond', args: [b.address] })}>Record bond</Button>
        </>}
        {b.phase === 'Funding' && now >= b.fundingDeadline && (
          <>
          <p className="pt-2 text-xs text-foreground/70"><TermsText>End the expired funding round so depositors can claim refunds.</TermsText></p>
          <Button disabled={!ready} onClick={() => send('Cancel', { address: b.account, abi: accountAbi as Abi, functionName: 'cancelFunding', args: [b.address] })}>
            Cancel the unfilled raise
          </Button>
          </>
        )}
        {b.phase === 'Active' && now >= b.maturity && (
          <>
          <p className="pt-2 text-xs text-foreground/70"><TermsText>Stop revenue collection at maturity and recover undrawn capital.</TermsText></p>
          <Button disabled={!ready} onClick={() => send('Close', { address: b.account, abi: accountAbi as Abi, functionName: 'closeBondAtMaturity', args: [b.address] })}>
            Close at maturity
          </Button>
          </>
        )}
        {b.phase === 'Active' && b.undrawn > 0 && now >= b.secondReleaseDeadline && (
          <>
          <p className="pt-2 text-xs text-foreground/70"><TermsText>Recover capital after the second release window has expired.</TermsText></p>
          <Button disabled={!ready} onClick={() => send('Expire', { address: b.address, abi: bondAbi as Abi, functionName: 'expireUndrawn' })}>
            Return undrawn capital to investors
          </Button>
          </>
        )}
        {b.phase === 'Closing' && settleAfter !== undefined && now >= Number(settleAfter) && (
          <>
          <p className="pt-2 text-xs text-foreground/70"><TermsText>End the reporting grace period so the last outstanding claims can redeem.</TermsText></p>
          <Button disabled={!ready} onClick={() => send('Settle', { address: b.address, abi: bondAbi as Abi, functionName: 'finalizeSettlement' })}>
            Finalize settlement
          </Button>
          </>
        )}
      </details>

      </>}
      {status && (
        <p role={status.error ? 'alert' : 'status'} className={cn('text-sm', status.error ? 'text-foreground' : 'text-foreground/70')}>
          {status.text}{' '}
          {status.hash && chain.blockExplorers && (
            <a href={`${chain.blockExplorers.default.url}/tx/${status.hash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:underline">
              View <ExternalLink className="size-3" />
            </a>
          )}
        </p>
      )}
    </div>
  );
}


function EarlyRedemptionConfirmation({ burned, cash, estimate, b, disabled, busy, onCancel, onConfirm, status }: {
  burned: string; cash: string; estimate: ReturnType<typeof earlyRedemptionEstimate>; b: BondView;
  disabled: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void; status?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [ack, setAck] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    element.showModal();
    element.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    element.scrollTop = 0;
    return () => {
      element.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby="redeem-title" aria-describedby="redeem-warning"
      onCancel={(event) => { if (busy) event.preventDefault(); else onCancel(); }}
      className="fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-foreground/20 bg-background p-6 text-foreground backdrop:bg-black/70">
      <h2 id="redeem-title" tabIndex={-1} className="text-xl font-semibold outline-none">Confirm early redemption</h2>
      <p id="redeem-warning" className="mt-3 text-sm text-foreground/70"><TermsText>This permanently burns your selected claims for their current cash backing. You give up all future receipts on those claims, including revenue and any later capital or stake recovery.</TermsText></p>
      <dl className="my-5 space-y-3 rounded-lg border border-foreground/15 p-4 text-sm">
        {[
          ['Claims burned', burned], ['Cash received now', cash],
          ...(estimate ? [['Estimated additional revenue by maturity', fmt(estimate.additional, b.asset, 6)],
          ['Estimated total if held', fmt(estimate.total, b.asset, 6)]] : []),
        ].map(([label, value]) => <div key={label} className="space-y-1">
          <dt className="text-xs text-foreground/70"><TermsText>{label}</TermsText></dt><dd className="break-words font-mono tabular">{value}</dd>
        </div>)}
      </dl>
      {!estimate && <p className="mb-3 text-sm">Revenue history or projection inputs could not be read, so future receipts cannot be estimated.</p>}
      <p className="text-xs text-foreground/70">
        {b.phase === 'Closing' ? 'Revenue collection has ended, so no additional revenue is projected. Settlement may still recover stake.'
          : 'Estimate uses the trailing attributed daily revenue and current investor share, capped at the remaining revenue cap through maturity. It assumes the claim supply and terms stay unchanged and excludes future capital or stake recovery. It is not a guarantee.'}
        {' '}Cash is based on the latest read; the transaction uses the pool and supply when executed.
      </p>
      <label className="my-4 flex min-h-11 items-start gap-3 py-2 text-sm">
        <input type="checkbox" checked={ack} onChange={event => setAck(event.target.checked)} className="mt-1 size-4 shrink-0" />
        <span>I understand that these claims are burned and I give up their future receipts.</span>
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button disabled={busy} onClick={onCancel}>Keep my claims</Button>
        <Button disabled={disabled || !ack} onClick={onConfirm}>Burn claims and redeem</Button>
      </div>
      {status && <p role="status" className="mt-4 text-sm">{status}</p>}
    </dialog>
  );
}
