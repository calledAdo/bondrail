// 404 for unmatched URLs (the site and the app have separate root layouts).
import Link from 'next/link';
import { geistMono, geistSans } from '@/lib/fonts';
import '@/styles/site.css';

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-md space-y-4 text-center">
          <p className="font-mono text-xs text-foreground/60">(404)</p>
          <h1 className="text-3xl font-semibold">Nothing at this address.</h1>
          <Link href="/" className="inline-block text-sm text-foreground/70 underline-offset-4 hover:underline">
            Back to Slice
          </Link>
        </div>
      </body>
    </html>
  );
}
