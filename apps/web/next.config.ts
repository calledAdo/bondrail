import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false,
  // The site and the app have separate root layouts, so unmatched URLs need one global 404 page.
  experimental: { globalNotFound: true },
};
export default config;
