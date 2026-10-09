import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@slice/observer'],
  poweredByHeader: false,
};
export default config;
