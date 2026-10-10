import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="space-y-4 py-24 text-center">
      <p className="font-mono text-xs text-foreground/60">(404)</p>
      <h1 className="text-3xl font-semibold">Not in the market.</h1>
      <Link href="/markets" className="text-sm text-foreground/70 underline-offset-4 hover:underline">
        Back to markets
      </Link>
    </div>
  );
}
