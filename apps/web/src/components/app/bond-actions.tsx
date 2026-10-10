'use client';
// The bond's decision panel: what the connected wallet can do right now, for investors, the issuer and
// anyone (housekeeping). Every write simulates first and reports the receipt; nothing is assumed.
import { useState } from 'react';
import { useAccount, usePublicClient, useReadContracts, useWalletClient } from 'wagmi';
import { erc20Abi, formatUnits, isAddress, parseUnits, type Abi, type Address, type Hash } from 'viem';
import { ExternalLink } from 'lucide-react';
import { accountAbi, bondAbi, factoryAbi } from '@/lib/abi';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import type { BondView } from '@/lib/protocol';
import { cn } from '@/lib/cn';

type Call = { address: Address; abi: Abi; functionName: string; args?: unknown[] };

function Button({ children, onClick, disabled, primary }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'h-10 w-full rounded-lg px-4 text-sm font-medium transition-colors duration-300 disabled:cursor-not-allowed disabled:opacity-40',
        primary ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'border border-foreground/15 hover:bg-foreground/5',
      )}
    >
      {children}
    </button>
  );
}

export function BondActions({ b, onDone }: { b: BondView; onDone: () => void }) {
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean; hash?: Hash }>();
  const [signed, setSigned] = useState('');

  const reads = useReadContracts({
    contracts: [
      { address: b.address, abi: bondAbi, functionName: 'issuer', chainId: chain.id },
      { address: b.address, abi: bondAbi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'], chainId: chain.id },
      { address: b.asset.address, abi: erc20Abi, functionName: 'balanceOf', args: [address ?? '0x0000000000000000000000000000000000000000'], chainId: chain.id },
      { address: b.asset.address, abi: erc20Abi, functionName: 'allowance', args: [address ?? '0x0000000000000000000000000000000000000000', b.address], chainId: chain.id },
      { address: b.address, abi: bondAbi, functionName: 'settleAfter', chainId: chain.id },
    ],
    query: { enabled: !!address, refetchInterval: 5000 },
  });
  const [issuer, claims, cash, allowance, settleAfter] = (reads.data ?? []).map((r) => r.result) as [Address?, bigint?, bigint?, bigint?, bigint?];
  const isIssuer = !!address && !!issuer && issuer.toLowerCase() === address.toLowerCase();
  const d = b.asset.decimals;
  const now = Date.now() / 1000;
  const ready = !!address && chainId === chain.id && safeNetwork && !busy;
  const value = /^\d+(\.\d+)?$/.test(amount) ? parseUnits(amount, d) : 0n;

  async function send(label: string, call: Call) {
    setBusy(true);
    setStatus({ text: 'Confirm in your wallet…' });
    try {
      if (!client || !wallet || !address) throw new Error('Connect a wallet on ' + chain.name + '.');
      const sim = (await client.simulateContract({ account: address, ...call } as never)) as unknown as { request: never };
      const hash = await wallet.writeContract(sim.request);
      setStatus({ text: 'Waiting for the receipt…', hash });
      const r = await client.waitForTransactionReceipt({ hash });
      if (r.status !== 'success') throw new Error('The transaction reverted.');
      setStatus({ text: `${label}: confirmed.`, hash });
      await reads.refetch();
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
      {!address ? (
        <p className="text-sm text-foreground/60">Connect a wallet to fund, redeem or manage this bond.</p>
      ) : (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <dt className="text-xs text-foreground/60">Your claims</dt>
            <dd className="font-mono tabular">{fmtUnits(claims)}</dd>
          </div>
          <div>
            <dt className="text-xs text-foreground/60">Your {b.asset.symbol}</dt>
            <dd className="font-mono tabular">{fmtUnits(cash)}</dd>
          </div>
        </dl>
      )}

      {/* Investors */}
      {(b.phase === 'Funding' || b.phase === 'Active' || b.phase === 'Closing' || b.phase === 'Closed' || b.phase === 'Cancelled') && (
        <div className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-foreground/60">Amount ({b.phase === 'Funding' ? b.asset.symbol : 'claims'})</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="h-10 w-full rounded-lg border border-foreground/15 bg-transparent px-3 font-mono text-sm outline-none focus:border-foreground/40"
            />
          </label>
          {b.phase === 'Funding' && (
            <>
              {b.depositAllowed === false && <p className="text-xs text-orange-500">Deposits are paused: the source is not healthy right now.</p>}
              {(allowance ?? 0n) < value ? (
                <Button primary disabled={!ready || value === 0n} onClick={() => send('Approve', { address: b.asset.address, abi: erc20Abi as Abi, functionName: 'approve', args: [b.address, value] })}>
                  Approve {b.asset.symbol}
                </Button>
              ) : (
                <Button primary disabled={!ready || value === 0n || b.depositAllowed === false} onClick={() => send('Deposit', { address: b.address, abi: bondAbi as Abi, functionName: 'deposit', args: [value] })}>
                  Deposit
                </Button>
              )}
            </>
          )}
          {(b.phase === 'Active' || b.phase === 'Closing' || b.phase === 'Closed') && (
            <>
              <Button primary disabled={!ready || value === 0n} onClick={() => send('Redeem', { address: b.address, abi: bondAbi as Abi, functionName: 'redeem', args: [value, address] })}>
                Redeem for {b.backingPerToken.toFixed(4)} {b.asset.symbol} each
              </Button>
              {b.phase !== 'Closed' && <p className="text-xs text-foreground/60">The last outstanding claim waits for the bond to close.</p>}
            </>
          )}
          {b.phase === 'Cancelled' && (
            <Button primary disabled={!ready || value === 0n} onClick={() => send('Refund', { address: b.address, abi: bondAbi as Abi, functionName: 'refund', args: [value, address] })}>
              Refund
            </Button>
          )}
        </div>
      )}

      {/* Issuer */}
      {isIssuer && factory && (
        <div className="space-y-3 border-t border-foreground/10 pt-5">
          <p className="text-xs font-medium uppercase tracking-wider text-foreground/60">Issuer</p>
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
      <div className="space-y-2 border-t border-foreground/10 pt-5">
        <p className="text-xs font-medium uppercase tracking-wider text-foreground/60">Anyone</p>
        <Button disabled={!ready} onClick={() => send('Sweep', { address: b.account, abi: accountAbi as Abi, functionName: 'sweep' })}>
          Book pending transfers (sweep)
        </Button>
        {b.phase === 'Funding' && now >= b.fundingDeadline && (
          <Button disabled={!ready} onClick={() => send('Cancel', { address: b.account, abi: accountAbi as Abi, functionName: 'cancelFunding', args: [b.address] })}>
            Cancel the unfilled raise
          </Button>
        )}
        {b.phase === 'Active' && now >= b.maturity && (
          <Button disabled={!ready} onClick={() => send('Close', { address: b.account, abi: accountAbi as Abi, functionName: 'closeBondAtMaturity', args: [b.address] })}>
            Close at maturity
          </Button>
        )}
        {b.phase === 'Active' && b.undrawn > 0 && now >= b.secondReleaseDeadline && (
          <Button disabled={!ready} onClick={() => send('Expire', { address: b.address, abi: bondAbi as Abi, functionName: 'expireUndrawn' })}>
            Return undrawn capital to investors
          </Button>
        )}
        {b.phase === 'Closing' && settleAfter !== undefined && now >= Number(settleAfter) && (
          <Button disabled={!ready} onClick={() => send('Settle', { address: b.address, abi: bondAbi as Abi, functionName: 'finalizeSettlement' })}>
            Finalize settlement
          </Button>
        )}
      </div>

      {status && (
        <p role={status.error ? 'alert' : 'status'} className={cn('text-sm', status.error ? 'text-red-500' : 'text-foreground/70')}>
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
