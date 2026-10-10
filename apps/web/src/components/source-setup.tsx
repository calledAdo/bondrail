'use client';
// Issuer onboarding. Every path starts with a SliceAccount (history starts at its first payment), then:
//   Native : bind your own project, which inherits SliceEarner and points at the account forever;
//            Slice's disclosed reviewer must approve it before you can raise (history accrues meanwhile).
//   Watched: nothing on-chain; set your x402 payTo to the account (see @slice/sdk/x402).
// Raising needs factory.minHistory() seconds since the account's first booked payment.
import { useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { isAddress, parseEventLogs, type Address, type Hash } from 'viem';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { accountAbi, factoryAbi } from '@/lib/abi';

export function SourceSetup({
  account,
  adapter,
  onCreated,
}: {
  account: string;
  adapter: string;
  onCreated: (values: { account?: string; source?: string }) => void;
}) {
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hash, setHash] = useState<Hash>();
  const [message, setMessage] = useState('');
  const [project, setProject] = useState('');
  const ready = !!address && !!deployment.factory && chainId === chain.id && safeNetwork && !busy;

  async function send(kind: 'account' | 'bind') {
    setError('');
    setHash(undefined);
    setMessage('');
    setBusy(true);
    try {
      if (!ready || !address || !deployment.factory || !client || !wallet)
        throw Error('Configure the Factory and connect your wallet on the configured network first.');
      if (kind !== 'account' && !isAddress(account)) throw Error('Create or enter your SliceAccount first.');
      let request: unknown;
      if (kind === 'account') {
        request = (
          await client.simulateContract({
            account: address,
            address: deployment.factory,
            abi: factoryAbi,
            functionName: 'createAccount',
          })
        ).request;
      } else {
        if (!isAddress(project)) throw Error('Enter your project contract (it must inherit SliceEarner).');
        request = (
          await client.simulateContract({
            account: address,
            address: account as Address,
            abi: accountAbi,
            functionName: 'bindProject',
            args: [project],
          })
        ).request;
      }
      setMessage('Confirm the transaction in your wallet.');
      const tx = await wallet.writeContract(request as Parameters<typeof wallet.writeContract>[0]);
      setHash(tx);
      setMessage('Waiting for the receipt…');
      const receipt = await client.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== 'success') throw Error('The transaction reverted.');
      const logs = receipt.logs.filter((log) => log.address.toLowerCase() === deployment.factory?.toLowerCase());
      if (kind === 'account') {
        const e = parseEventLogs({ abi: factoryAbi, logs, eventName: 'AccountCreated' }).find(
          (x) => x.args.issuer.toLowerCase() === address.toLowerCase(),
        );
        if (!e) throw Error('AccountCreated event not found.');
        onCreated({ account: e.args.account });
        setMessage('Account created. Every payment from now on builds its on-chain revenue history.');
      } else {
        onCreated({ source: project });
        setMessage(
          'Project bound. Its fees now build your history; ask the Slice reviewer to approve it before raising.',
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message.slice(0, 320) : 'Setup failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="source-setup">
      <h3>Set up on {chain.name}</h3>
      <div className="setup-actions">
        <button className="button" disabled={!ready} onClick={() => send('account')}>
          1. Create my SliceAccount
        </button>
      </div>
      {adapter === 'Native' && (
        <div className="form-grid">
          <label className="field-label wide">
            Your project contract (inherits SliceEarner, points at your account)
            <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="0x…" spellCheck={false} />
          </label>
          <button className="button" disabled={!ready || !isAddress(account)} onClick={() => send('bind')}>
            2. Bind project to my account
          </button>
        </div>
      )}
      {adapter === 'Watched' && (
        <p className="help">
          Nothing to deploy: set your x402 payTo to your SliceAccount (see @slice/sdk/x402). Chainlink CRE checks it
          every 30 seconds once you raise.
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="notice danger" role="alert">
          {error}
        </p>
      )}
      {hash && chain.blockExplorers && (
        <a
          className="transaction-link"
          href={`${chain.blockExplorers.default.url}/tx/${hash}`}
          target="_blank"
          rel="noreferrer"
        >
          View transaction
        </a>
      )}
    </div>
  );
}
