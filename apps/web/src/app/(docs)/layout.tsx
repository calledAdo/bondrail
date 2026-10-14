import { brandMetadata } from '@/lib/brand';
// Root layout for /docs: Fumadocs (its own theme provider and search), no wallet code.
import type { Metadata } from 'next';
import { RootProvider } from 'fumadocs-ui/provider/next';
import { geistMono, geistSans } from '@/lib/fonts';
import '@/styles/docs.css';

export const metadata: Metadata = {
  ...brandMetadata,
  title: { default: 'Bondrail docs', template: '%s | Bondrail docs' },
  description: 'Integrate Bondrail: route revenue through a BondrailAccount, raise against it, and invest in revenue bonds.',
};

export default function DocsRoot({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col">
        <RootProvider theme={{ defaultTheme: 'dark', enableSystem: false }}>{children}</RootProvider>
      </body>
    </html>
  );
}
