import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@bondrail/observer', '@bondrail/sdk'],
  poweredByHeader: false,
};
export default config;
