// Root layout for the app (markets, bonds, accounts, console, portfolio): wallet providers load here only.
import type { Metadata } from 'next';
import { Providers } from '@/components/providers';
import { Shell } from '@/components/shell';
import './app.css';

export const metadata: Metadata = {
  title: { default: 'Slice | Revenue markets', template: '%s | Slice' },
  description:
    'Markets for staged revenue financing on Monad testnet. Follow committed capital, collected revenue and investor recovery.',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <Shell>{children}</Shell>
        </Providers>
      </body>
    </html>
  );
}
