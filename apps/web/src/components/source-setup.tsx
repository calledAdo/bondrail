'use client';
import { useState } from 'react';
import { useAccount, usePublicClient, useWalletClient } from 'wagmi';
import { isAddress, parseEventLogs, type Hash } from 'viem';
import { chain, deployment, safeNetwork } from '@/lib/wallet';
import { factoryAbi } from '@/lib/abi';
export function SourceSetup({
  account,
  adapter,
  onCreated,
}: {
  account: string;
  adapter: string;
  onCreated: (values: { account?: string; source?: string; guard?: string }) => void;
}) {
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { data: wallet } = useWalletClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [hash, setHash] = useState<Hash>();
  const [message, setMessage] = useState('');
  const ready = !!address && !!deployment.factory && chainId === chain.id && safeNetwork && !busy;
  async function setup(kind: 'account' | 'native' | 'locked') {
    setError('');
    setHash(undefined);
    setMessage('');
    setBusy(true);
    try {
      if (!ready || !address || !deployment.factory || !client || !wallet)
        throw Error('Configure the Factory and connect your testnet wallet first.');
      if (kind !== 'account' && !isAddress(account)) throw Error('Create or enter your SliceAccount first.');
      const base = { account: address, address: deployment.factory, abi: factoryAbi } as const;
      const simulation =
        kind === 'account'
          ? await client.simulateContract({ ...base, functionName: 'createAccount' })
          : kind === 'native'
            ? await client.simulateContract({
                ...base,
                functionName: 'createNativeLaunchpad',
                args: [account as `0x${string}`, 'PumpLab Demo', 'PUMP'],
              })
            : await client.simulateContract({
                ...base,
                functionName: 'createLockedLaunchpad',
                args: [account as `0x${string}`, 'PumpLab Classic Demo', 'CPUMP', 64],
              });
      setMessage('Confirm the setup transaction in your wallet.');
      const tx = await wallet.writeContract(simulation.request as Parameters<typeof wallet.writeContract>[0]);
      setHash(tx);
      setMessage('Waiting for the setup receipt…');
      const receipt = await client.waitForTransactionReceipt({ hash: tx });
      if (receipt.status !== 'success') throw Error('Setup reverted.');
      const logs = receipt.logs.filter((log) => log.address.toLowerCase() === deployment.factory?.toLowerCase());
      const mine = (e: { args: { issuer: string } }) => e.args.issuer.toLowerCase() === address.toLowerCase();
      if (kind === 'account') {
        const event = parseEventLogs({ abi: factoryAbi, logs, eventName: 'AccountCreated' }).find(mine);
        if (!event) throw Error('AccountCreated event not found. Inspect the transaction.');
        onCreated({ account: event.args.account });
      } else if (kind === 'native') {
        const event = parseEventLogs({ abi: factoryAbi, logs, eventName: 'NativeSourceCreated' }).find(mine);
        if (!event) throw Error('NativeSourceCreated event not found.');
        onCreated({ source: event.args.source });
      } else {
        const event = parseEventLogs({ abi: factoryAbi, logs, eventName: 'LockedSourceCreated' }).find(mine);
        if (!event) throw Error('LockedSourceCreated event not found.');
        onCreated({ source: event.args.source, guard: event.args.guard });
      }
      setMessage('Setup receipt confirmed. Addresses were filled in from Factory events.');
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
        <button className="button" disabled={!ready} onClick={() => setup('account')}>
          Create my SliceAccount
        </button>
        {adapter === 'Native' && (
          <button className="button" disabled={!ready || !isAddress(account)} onClick={() => setup('native')}>
            Launch a Native PumpLab
          </button>
        )}
        {adapter === 'Locked' && (
          <button className="button" disabled={!ready || !isAddress(account)} onClick={() => setup('locked')}>
            Launch a guarded PumpLab Classic
          </button>
        )}
      </div>
      <p className="help">
        Create your account first: from then on every payment builds your on-chain revenue history, long before you raise.
      </p>
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
          View setup transaction
        </a>
      )}
    </div>
  );
}
