'use client';
import { useState } from 'react';
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWalletClient } from 'wagmi';
import { erc20Abi, formatUnits, parseUnits, type Address, type Hash } from 'viem';
import { ExternalLink, RefreshCw, ShieldAlert, Wallet } from 'lucide-react';
import { bondAbi, accountAbi, factoryAbi } from '@/lib/abi';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { shortAddress } from '@/lib/data';
import { MilestoneRelease } from './milestone-release';
const fields = [
  'phase',
  'fundingEscrow',
  'releasedPrincipal',
  'undrawnPrincipal',
  'principalRecovery',
  'revenuePool',
  'stakeRecovery',
  'stakeHeld',
  'pool',
  'defaultedAt',
  'effectiveRevenueCap',
  'issuer',
  'account',
  'backingPerToken',
  'totalSupply',
  'asset',
  'decimals',
] as const;
const phaseNames = ['Funding', 'Active', 'Closing', 'Closed', 'Cancelled'];
export function LiveContract({ id }: { id: string }) {
  const bond = deployment.bonds[id];
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const [amount, setAmount] = useState('10');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [hash, setHash] = useState<Hash>();
  const [error, setError] = useState(false);
  const reads = useReadContracts({
    contracts: bond
      ? fields.map((functionName) => ({ address: bond, abi: bondAbi, functionName, chainId: chain.id }))
      : [],
    // Fast polling keeps the backing-per-claim figure moving with each routed payment (Monad ~0.6 s finality).
    query: { enabled: !!bond, refetchInterval: 3000 },
  });
  const phase = reads.data?.[0]?.status === 'success' ? Number(reads.data[0].result) : undefined;
  const issuer = reads.data?.[11]?.result as Address | undefined;
  const accountAddress = reads.data?.[12]?.result as Address | undefined;
  // The bond raises and repays in its account's asset (any token): use its decimals and symbol.
  const asset = reads.data?.[15]?.result as Address | undefined;
  const decimals = Number(reads.data?.[16]?.result ?? 6);
  const { data: unit = 'tokens' } = useReadContract({
    address: asset,
    abi: erc20Abi,
    functionName: 'symbol',
    chainId: chain.id,
    query: { enabled: !!asset },
  });
  const show = (v: unknown) => `${formatUnits(BigInt(v as bigint), decimals)} ${unit}`;
  const ready = !!bond && !!address && chainId === chain.id && safeNetwork && phase !== undefined && !busy;
  const isIssuer = !!address && issuer?.toLowerCase() === address.toLowerCase();
  async function transact(action: string) {
    setError(false);
    setHash(undefined);
    setBusy(true);
    setMessage('Waiting for wallet approval…');
    try {
      if (!ready || !bond || !address || !publicClient || !walletClient)
        throw Error('Connect a wallet on the configured test network and wait for contract reads.');
      let value = 0n;
      if (['approve', 'deposit', 'redeem', 'refund'].includes(action)) {
        if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(amount))
          throw Error(`Enter a positive amount with at most ${decimals} decimal places.`);
        value = parseUnits(amount, decimals);
        if (value <= 0n) throw Error('Amount must be greater than zero.');
      }
      let request;
      if (action === 'approve') {
        if (!asset) throw Error('The bond asset is not loaded yet.');
        request = await publicClient.simulateContract({
          account: address,
          address: asset,
          abi: erc20Abi,
          functionName: 'approve',
          args: [bond, value],
        });
      } else if (action === 'activate') {
        if (!deployment.factory) throw Error('Factory address is not configured.');
        request = await publicClient.simulateContract({
          account: address,
          address: deployment.factory,
          abi: factoryAbi,
          functionName: 'activate',
          args: [bond],
        });
      } else if (action === 'sweep' || action === 'close' || action === 'cancel') {
        if (!accountAddress) throw Error('Account read is unavailable.');
        request =
          action === 'sweep'
            ? await publicClient.simulateContract({
                account: address,
                address: accountAddress,
                abi: accountAbi,
                functionName: 'sweep',
              })
            : await publicClient.simulateContract({
                account: address,
                address: accountAddress,
                abi: accountAbi,
                functionName: action === 'close' ? 'closeBondAtMaturity' : 'cancelFunding',
                args: [bond],
              });
      } else if (action === 'deposit') {
        request = await publicClient.simulateContract({
          account: address,
          address: bond,
          abi: bondAbi,
          functionName: 'deposit',
          args: [value],
        });
      } else if (action === 'redeem' || action === 'refund') {
        request = await publicClient.simulateContract({
          account: address,
          address: bond,
          abi: bondAbi,
          functionName: action,
          args: [value, address],
        });
      } else {
        request = await publicClient.simulateContract({
          account: address,
          address: bond,
          abi: bondAbi,
          functionName: action === 'expire' ? 'expireUndrawn' : 'finalizeSettlement',
        });
      }
      const tx = await walletClient.writeContract(request.request as Parameters<typeof walletClient.writeContract>[0]);
      setHash(tx);
      setMessage('Transaction submitted. Waiting for a receipt…');
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== 'success')
        throw Error('Transaction reverted. No successful action was recorded.');
      setMessage('Receipt confirmed. Verified checkpoint has not been established by this interface.');
      await reads.refetch();
    } catch (e) {
      setError(true);
      setMessage(
        e instanceof Error ? e.message.slice(0, 360) : 'Transaction failed. Check your wallet and try again.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel live-panel">
      <div className="section-heading">
        <h2>
          <Wallet size={18} aria-hidden /> Contract workspace
        </h2>
        <span className="badge neutral">{chain.name}</span>
      </div>
      {!bond ? (
        <div className="empty compact-empty">
          <ShieldAlert size={24} />
          <h3>Deployment not configured</h3>
          <p>
            This market is a synthetic preview. Add its testnet bond, token and factory addresses to enable
            actual reads and wallet actions.
          </p>
        </div>
      ) : (
        <>
          <div className="live-address">
            <span>Bond {shortAddress(bond)}</span>
            <button
              className="icon-button"
              aria-label="Refresh contract reads"
              onClick={() => reads.refetch()}
            >
              <RefreshCw size={15} />
            </button>
          </div>
          {phase === undefined ? (
            <p className="notice warning" role="status">
              {reads.isLoading
                ? 'Reading deployed contract…'
                : 'Contract reads unavailable. Check the address, RPC and selected network. Actions are disabled.'}
            </p>
          ) : (
            <>
              <div className="live-phase">
                <span>Actual contract phase</span>
                <strong>{phaseNames[phase] ?? 'Unknown'}</strong>
              </div>
              {phase >= 1 && phase <= 3 && reads.data?.[13]?.status === 'success' && (
                <div className="live-phase">
                  <span>Backing per claim, redeemable now</span>
                  <strong>{show(reads.data[13].result)}</strong>
                </div>
              )}
              <dl className="fact-list">
                {[
                  ['Released principal', 2],
                  ['Undrawn principal', 3],
                  ['Principal recovery', 4],
                  ['Collected revenue pool', 5],
                  ['Stake recovery', 6],
                ].map(([label, index]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {reads.data?.[Number(index)]?.status === 'success'
                        ? show(reads.data[Number(index)].result)
                        : 'Unavailable'}
                    </dd>
                  </div>
                ))}
              </dl>
              {Number(reads.data?.[9]?.result ?? 0) > 0 && (
                <p className="notice danger">
                  Default recorded. Future capital release is disabled; recovery remains separate from
                  revenue.
                </p>
              )}
            </>
          )}
          <label className="field-label">
            Amount in {unit} / claim units
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-describedby="amount-help"
            />
          </label>
          <p className="help" id="amount-help">
            Up to {decimals} decimal places. Approve only the amount you intend to deposit.
          </p>
          <div className="transaction-buttons">
            {phase === 0 && (
              <>
                <button
                  className="button"
                  disabled={!ready || !asset}
                  onClick={() => transact('approve')}
                >
                  1. Approve {unit}
                </button>
                <button className="button primary" disabled={!ready} onClick={() => transact('deposit')}>
                  2. Deposit
                </button>
                {isIssuer && (
                  <button className="button" disabled={!ready} onClick={() => transact('activate')}>
                    Activate full raise
                  </button>
                )}
                <button className="button subtle" disabled={!ready} onClick={() => transact('cancel')}>
                  Cancel after deadline
                </button>
              </>
            )}
            {phase === 1 && (
              <>
                <button className="button primary" disabled={!ready} onClick={() => transact('sweep')}>
                  Collect pending receipts
                </button>
                <button className="button" disabled={!ready} onClick={() => transact('expire')}>
                  Recover expired commitment
                </button>
                <button className="button" disabled={!ready} onClick={() => transact('close')}>
                  Close at maturity
                </button>
              </>
            )}
            {phase === 2 && (
              <button className="button primary" disabled={!ready} onClick={() => transact('finalize')}>
                Settle after evidence window
              </button>
            )}
            {phase !== undefined && phase >= 1 && phase <= 3 && (
              <button
                className={`button ${phase === 3 ? 'primary' : ''}`}
                disabled={!ready}
                onClick={() => transact('redeem')}
              >
                Redeem claim units for today's backing
              </button>
            )}
            {phase === 4 && (
              <button className="button primary" disabled={!ready} onClick={() => transact('refund')}>
                Refund held claim units
              </button>
            )}
          </div>
          {!address && <p className="help">Connect your wallet using the header to continue.</p>}
          {address && chainId !== chain.id && (
            <p className="notice warning">Switch your wallet to {chain.name}. Mainnet writes are disabled.</p>
          )}
          {phase === 1 && isIssuer && bond && (
            <MilestoneRelease bond={bond} onComplete={() => void reads.refetch()} />
          )}
          {phase === 1 && (
            <p className="help">
              A second draw requires proof of revenue since activation (on-chain counter or signed attestation,
              per the bond&apos;s terms) and current source health. No manual override is available.
            </p>
          )}
          {message && (
            <div className={`notice ${error ? 'danger' : ''}`} role="status">
              {message}
              {hash && chain.blockExplorers && (
                <a
                  className="transaction-link"
                  href={`${chain.blockExplorers.default.url}/tx/${hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View actual transaction <ExternalLink size={12} />
                </a>
              )}
            </div>
          )}
        </>
      )}
      <p className="footnote">
        Values in this panel are read straight from the bond contract on every refresh.
      </p>
    </section>
  );
}
