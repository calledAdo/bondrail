// Landing page. Placeholder until step 3 of the frontend build (DESIGN.md: the split beam hero).
import Link from 'next/link';

export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-5xl flex-col justify-center gap-8 px-6">
      <p className="font-mono text-xs uppercase tracking-wider text-foreground/60">Slice · Monad testnet</p>
      <h1 className="text-5xl font-semibold sm:text-7xl">
        Your revenue is your credit.
        <span className="block text-foreground/40">Borrow against what you already earn.</span>
      </h1>
      <div className="flex gap-3">
        <Link href="/markets" className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground">
          Open markets
        </Link>
      </div>
    </main>
  );
}
