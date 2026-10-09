'use client';
import { useState } from 'react';
import { useAccount, usePublicClient, useReadContract, useWalletClient } from 'wagmi';
import { isAddress, type Address, type Hash } from 'viem';
import { bondAbi, factoryAbi } from '@/lib/abi';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
export function MilestoneRelease({ bond, onComplete }: { bond: Address; onComplete: () => void }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [hash, setHash] = useState<Hash>();
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const terms = useReadContract({ address: bond, abi: bondAbi, functionName: 'terms', chainId: chain.id });
  const onchain = terms.data ? Number(terms.data.milestoneMode) === 0 : undefined;

  /** On-chain mode: the factory reads the account's own revenue counter; no signature involved. */
  async function releaseOnchain() {
    setError('');
    setMessage('');
    setHash(undefined);
    setBusy(true);
    try {
      if (!safeNetwork || chainId !== chain.id || !address || !client || !wallet || !deployment.factory)
        throw Error('Connect the issuer wallet on the configured test network.');
      const simulation = await client.simulateContract({
        account: address,
        address: deployment.factory,
        abi: factoryAbi,
        functionName: 'releaseSecond',
        args: [bond],
      });
      setMessage('Confirm the second-release transaction in your wallet.');
      const tx = await wallet.writeContract(simulation.request as Parameters<typeof wallet.writeContract>[0]);
      setHash(tx);
      const receipt = await client.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== 'success') throw Error('Release reverted; no draw was recorded.');
      setMessage('Second release confirmed: the account had earned enough since activation.');
      onComplete();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.slice(0, 360)
          : 'Not yet: revenue since activation or the operating period is below the bond terms.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    setError('');
    setMessage('');
    setHash(undefined);
    setBusy(true);
    try {
      if (!safeNetwork || chainId !== chain.id || !address || !client || !wallet || !deployment.factory)
        throw Error('Connect the issuer wallet on the configured test network.');
      const body = JSON.parse(input);
      const m = body.milestone;
      const signature = body.signature;
      if (
        !m ||
        !isAddress(m.bond) ||
        m.bond.toLowerCase() !== bond.toLowerCase() ||
        !/^0x[\da-fA-F]{64}$/.test(m.policyHash) ||
        !/^0x[\da-fA-F]{64}$/.test(m.evidenceHash) ||
        typeof signature !== 'string' ||
        !/^0x[\da-fA-F]{130}$/.test(signature)
      )
        throw Error('Provide { milestone, signature } from the authorized evaluator for this bond.');
      const integer = (value: unknown, bits: number) => {
        if (typeof value !== 'string' || !/^\d+$/.test(value))
          throw Error('Milestone integers must be unsigned decimal strings.');
        const n = BigInt(value);
        if (n >= 2n ** BigInt(bits)) throw Error('Milestone integer exceeds the contract field width.');
        return n;
      };
      const milestone = {
        bond: m.bond as Address,
        policyHash: m.policyHash as Hash,
        periodStart: integer(m.periodStart, 64),
        periodEnd: integer(m.periodEnd, 64),
        eligibleRevenue: integer(m.eligibleRevenue, 256),
        evidenceHash: m.evidenceHash as Hash,
        expiresAt: integer(m.expiresAt, 64),
        nonce: integer(m.nonce, 256),
      };
      const simulation = await client.simulateContract({
        account: address,
        address: deployment.factory,
        abi: factoryAbi,
        functionName: 'releaseSecondSigned',
        args: [bond, milestone, signature as Hash],
      });
      setMessage('Confirm the second-release transaction in your wallet.');
      const tx = await wallet.writeContract(simulation.request as Parameters<typeof wallet.writeContract>[0]);
      setHash(tx);
      setMessage('Waiting for the actual release receipt…');
      const receipt = await client.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== 'success') throw Error('Release reverted; no draw was recorded.');
      setMessage('Second-release receipt confirmed. Refreshing contract accounting.');
      onComplete();
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 360) : 'Milestone release failed.');
    } finally {
      setBusy(false);
    }
  }
  if (onchain)
    return (
      <div className="milestone-details">
        <p className="help">
          This bond proves its milestone on-chain: the second release unlocks once the SliceAccount has
          earned the minimum revenue since activation and the operating period has passed.
        </p>
        <button className="button full" disabled={busy} onClick={releaseOnchain}>
          Request second release
        </button>
        {error && (
          <p className="notice danger" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice" role="status">
            {message}
          </p>
        )}
      </div>
    );
  return (
    <details className="milestone-details">
      <summary>Issuer: submit a signed second-draw milestone</summary>
      <p className="help">
        Paste the evaluator’s exact JSON envelope. The Factory verifies policy, nonce, expiry, revenue,
        interval and current source health. This screen does not generate signatures.
      </p>
      <label className="field-label">
        Signed milestone JSON
        <textarea
          rows={5}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'{"milestone": {…}, "signature": "0x…"}'}
          spellCheck={false}
        />
      </label>
      <button className="button full" disabled={busy || !input} onClick={release}>
        Validate & request second release
      </button>
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {hash && chain.blockExplorers && (
        <a
          className="transaction-link"
          href={`${chain.blockExplorers.default.url}/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View release transaction
        </a>
      )}
    </details>
  );
}
