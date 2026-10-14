import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@bondrail/observer'],
  poweredByHeader: false,
};
export default config;
