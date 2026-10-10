import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';

const config: NextConfig = {
  poweredByHeader: false,
  // The site, docs and app have separate root layouts, so unmatched URLs need one global 404 page.
  experimental: { globalNotFound: true },
};

export default createMDX()(config);
