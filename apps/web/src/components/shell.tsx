'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { ArrowUpRight, ChevronDown, FlaskConical, Wallet, LogOut } from 'lucide-react';
import { useState } from 'react';
import { chain, safeNetwork } from '@/lib/wallet';
import { setPasskeyMode } from '@/lib/passkey-connector';
import { shortAddress } from '@/lib/data';
import { liveConfigured } from '@/lib/live';
export function WalletButton() {
  const { address, chainId } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const [error, setError] = useState('');
  const [menu, setMenu] = useState(false);
  async function connectWith(kind: 'signin' | 'create' | 'extension') {
    setError('');
    setMenu(false);
    try {
      if (kind === 'extension') {
        const ext = connectors.find((c) => c.id !== 'passkey');
        if (!ext || !(await ext.getProvider().catch(() => null)))
          throw new Error('No browser wallet found. Use a passkey instead.');
        await connectAsync({ connector: ext });
        return;
      }
      setPasskeyMode(kind);
      await connectAsync({ connector: connectors.find((c) => c.id === 'passkey')! });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet connection failed.');
    }
  }
  async function connect() {
    setError('');
    try {
      if (address && chainId !== chain.id) {
        await switchChainAsync({ chainId: chain.id });
        return;
      }
      if (address) {
        await navigator.clipboard.writeText(address);
        return;
      }
      setMenu((m) => !m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet connection failed.');
    }
  }
  return (
    <div className="wallet-control">
      <button
        className="button wallet-button"
        title={address && chainId === chain.id ? 'Copy wallet address' : undefined}
        onClick={connect}
        disabled={isPending || !safeNetwork}
      >
        <Wallet size={16} aria-hidden />
        {isPending
          ? 'Connecting…'
          : address
            ? chainId === chain.id
              ? shortAddress(address)
              : `Switch to ${chain.name}`
            : 'Connect wallet'}
        {address && chainId === chain.id && <ChevronDown size={14} aria-hidden />}
      </button>
      {address && (
        <button className="icon-button" aria-label="Disconnect wallet" onClick={() => disconnect()}>
          <LogOut size={16} />
        </button>
      )}
      {menu && !address && (
        <div className="wallet-menu" role="menu">
          <button role="menuitem" onClick={() => connectWith('signin')}>
            Sign in with passkey
          </button>
          <button role="menuitem" onClick={() => connectWith('create')}>
            Create passkey account
          </button>
          <button role="menuitem" onClick={() => connectWith('extension')}>
            Browser wallet
          </button>
        </div>
      )}
      {error && (
        <p className="wallet-error" role="alert">
          {error.slice(0, 220)}
        </p>
      )}
    </div>
  );
}
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <a href="#main" className="skip">
        Skip to content
      </a>
      <header className="topbar">
        <Link href="/" className="brand" aria-label="Slice home">
          <span className="brand-mark" aria-hidden>
            <i />
            <i />
            <i />
          </span>
          slice<span className="brand-test">testnet</span>
        </Link>
        <nav aria-label="Main navigation">
          {[
            ['/markets', 'Markets'],
            ['/portfolio', 'Portfolio'],
            ['/issue', 'Raise capital'],
          ].map(([href, label]) => (
            <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>
              {label}
            </Link>
          ))}
        </nav>
        <WalletButton />
      </header>
      <div className="preview-strip">
        <FlaskConical size={15} aria-hidden />
        {liveConfigured ? (
          <span>
            <strong>Monad testnet.</strong> Live contracts and Envio-indexed revenue. Demo businesses and
            their traffic are run by the Slice team.
          </span>
        ) : (
          <span>
            <strong>Synthetic preview.</strong> Illustrative businesses and activity. Live wallet transactions
            require a configured testnet deployment.
          </span>
        )}
        <Link href="/docs">
          Docs <ArrowUpRight size={13} aria-hidden />
        </Link>
      </div>
      <main id="main" className="main">
        {children}
      </main>
      <footer>
        <span>Slice · Revenue, with a clear trail.</span>
        <span>
          {chain.name}
          <span className="footer-dot" />
          One claim class. Two capital releases.
        </span>
        <Link href="/docs">Docs</Link>
      </footer>
    </>
  );
}
