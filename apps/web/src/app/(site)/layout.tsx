import { brandMetadata, brandMessaging } from '@/lib/brand';
// Root layout for the public site and docs: static pages, no wallet code.
import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/theme';
import { geistMono, geistSans } from '@/lib/fonts';
import '@/styles/site.css';

export const metadata: Metadata = {
  ...brandMetadata,
  title: { default: 'Bondrail | Revenue bonds for onchain businesses', template: '%s | Bondrail' },
  description:
    brandMessaging.description,
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
