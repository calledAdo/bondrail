import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

const config: NextConfig = {
  transpilePackages: ['@bondrail/sdk'],
  poweredByHeader: false,
  distDir: process.env.BONDRAIL_WEB_DIST_DIR ?? '.next',
  // The site, docs and app have separate root layouts, so unmatched URLs need one global 404 page.
  experimental: { globalNotFound: true },
  // Old routes from before the console and the account profiles.
  async redirects() {
    return [
      { source: '/issue', destination: '/console', permanent: true },
      { source: '/issuers/:id', destination: '/markets', permanent: false },
    ];
  },
};

export default createMDX()(config);
