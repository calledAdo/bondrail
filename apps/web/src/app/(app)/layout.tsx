// Root layout for the app (markets, bonds, accounts, portfolio, raise): wallet providers load here only.
import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { AppShell } from '@/components/app/shell';
import { ThemeProvider } from '@/components/theme';
import { geistMono, geistSans } from '@/lib/fonts';
import '@/styles/site.css';

export const metadata: Metadata = {
  title: { default: 'Slice | Revenue markets', template: '%s | Slice' },
  description: 'Revenue bonds on Monad testnet: attributed revenue, coverage and live repayment for every bond.',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider>
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
