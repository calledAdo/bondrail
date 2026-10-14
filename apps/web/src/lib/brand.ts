import type { Metadata } from 'next';

export const brandMessaging = {
  category: 'Revenue bonds for onchain businesses.',
  headline: 'Issue bonds. Raise capital.',
  repayment: 'Repay investors from your revenue.',
  description: 'Issue revenue bonds to raise capital for your onchain business. Investors fund the bonds, and a share of business revenue is routed toward repayment.',
} as const;

export const brandMetadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://bondrail.vercel.app'),
  applicationName: 'Bondrail',
  icons: {
    icon: [{ url: '/brand/icon.svg', type: 'image/svg+xml' }, { url: '/brand/favicon.ico' }],
    apple: '/brand/avatar.png',
  },
  twitter: { card: 'summary', title: 'Bondrail', description: brandMessaging.category, images: ['/brand/avatar.png'] },
};
