'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { ChevronDown, LogOut, Wallet } from 'lucide-react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme';
import { chain, safeNetwork } from '@/lib/wallet';
import { setPasskeyMode } from '@/lib/passkey-connector';
import { short } from '@/lib/protocol';
import { cn } from '@/lib/cn';

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
        if (!ext || !(await ext.getProvider().catch(() => null))) throw new Error('No browser wallet found. Use a passkey instead.');
        await connectAsync({ connector: ext });
        return;
      }
      setPasskeyMode(kind);
      await connectAsync({ connector: connectors.find((c) => c.id === 'passkey')! });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet connection failed.');
    }
  }
  async function click() {
    setError('');
    try {
      if (address && chainId !== chain.id) return void (await switchChainAsync({ chainId: chain.id }));
      if (address) return void (await navigator.clipboard.writeText(address));
      setMenu((m) => !m);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Wallet connection failed.');
    }
  }
  const wrong = !!address && chainId !== chain.id;
  return (
    <div className="relative flex items-center gap-1">
      <button
        type="button"
        onClick={click}
        disabled={isPending || !safeNetwork}
        title={address && !wrong ? 'Copy wallet address' : undefined}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-300 disabled:opacity-50',
          address ? 'border border-foreground/15 hover:bg-foreground/5' : 'bg-primary text-primary-foreground hover:bg-primary/90',
        )}
      >
        <Wallet className="size-4" />
        {isPending ? 'Connecting…' : address ? (wrong ? `Switch to ${chain.name}` : <span className="font-mono">{short(address)}</span>) : 'Connect'}
        {address && !wrong && <ChevronDown className="size-3.5 text-foreground/60" />}
      </button>
      {address && (
        <button type="button" aria-label="Disconnect wallet" onClick={() => disconnect()} className="inline-flex size-9 items-center justify-center rounded-lg text-foreground/60 hover:bg-foreground/5 hover:text-foreground">
          <LogOut className="size-4" />
        </button>
      )}
      {menu && !address && (
        <div role="menu" className="absolute right-0 top-11 z-50 w-56 overflow-hidden rounded-xl border border-foreground/10 bg-background p-1 shadow-lg">
          {(
            [
              ['signin', 'Sign in with passkey'],
              ['create', 'Create passkey account'],
              ['extension', 'Browser wallet'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="menuitem" type="button" onClick={() => connectWith(k)} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-foreground/5">
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="absolute right-0 top-11 z-50 w-72 rounded-lg border border-red-500/30 bg-background p-3 text-xs text-red-500">
          {error.slice(0, 220)}
        </p>
      )}
    </div>
  );
}

const NAV = [
  ['/markets', 'Markets'],
  ['/portfolio', 'Portfolio'],
  ['/issue', 'Raise'],
  ['/docs', 'Docs'],
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4">
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-foreground/10 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
          <Link href="/" aria-label="Slice home">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 text-sm md:flex">
            {NAV.map(([href, label]) => (
              <Link
                key={href}
                href={href}
                aria-current={path.startsWith(href) ? 'page' : undefined}
                className={cn('transition-colors duration-300 hover:text-foreground', path.startsWith(href) ? 'text-foreground' : 'text-foreground/60')}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden rounded-full border border-foreground/10 px-2.5 py-1 font-mono text-[11px] text-foreground/60 sm:inline">
              {chain.name}
            </span>
            <ThemeToggle />
            <WalletButton />
          </div>
        </div>
        <nav aria-label="Main (mobile)" className="flex gap-5 overflow-x-auto px-6 pb-3 text-sm md:hidden">
          {NAV.map(([href, label]) => (
            <Link key={href} href={href} className={path.startsWith(href) ? 'text-foreground' : 'text-foreground/60'}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-7xl px-6 py-10">
        {children}
      </main>
      <footer className="border-t border-foreground/10">
        <p className="mx-auto max-w-7xl px-6 py-8 font-mono text-[11px] text-foreground/60">
          Monad testnet · demo businesses and their traffic are run by the Slice team · not investment advice
        </p>
      </footer>
    </>
  );
}
