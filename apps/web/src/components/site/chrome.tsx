import { brandMessaging } from '@/lib/brand';
import Link from 'next/link';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme';

const LINKS = [
  ['How it works', '/#how'],
  ['Tiers', '/#tiers'],
  ['Markets', '/markets'],
  ['Docs', '/docs'],
] as const;

export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-foreground/10 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="Bondrail home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-8 text-sm text-foreground/60 md:flex">
          {LINKS.map(([label, href]) => (
            <Link key={href} href={href} className="transition-colors duration-300 hover:text-foreground">
              {label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/markets"
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors duration-300 hover:bg-primary/90"
          >
            Open app
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-foreground/10">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-12 text-sm text-foreground/60 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo />
          <span>{brandMessaging.category}</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-6">
          <Link href="/docs" className="hover:text-foreground">Docs</Link>
          <Link href="/docs/trust-model" className="hover:text-foreground">Trust model</Link>
          <Link href="/docs/reference/deployments" className="hover:text-foreground">Deployments</Link>
          <a href="https://github.com/calledAdo/bondrail" className="hover:text-foreground">GitHub</a>
        </nav>
      </div>
      <p className="mx-auto max-w-6xl px-6 pb-10 font-mono text-[11px] text-foreground/60">
        Monad testnet · not investment advice · demo businesses are run by the Bondrail team
      </p>
    </footer>
  );
}
