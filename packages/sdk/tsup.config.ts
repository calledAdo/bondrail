import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/abis.ts', 'src/client.ts', 'src/x402.ts', 'src/x402-guard.ts',
    'src/permit.ts', 'src/data.ts', 'src/credit.ts', 'src/yield.ts', 'src/trigger.ts'],
  format: ['esm'],
  target: 'node20',
  platform: 'neutral',
  splitting: true,
  clean: true,
  // These private workspace helpers must be embedded in both JS and declarations.
  noExternal: [/^@bondrail\//],
  external: ['viem', 'viem/*', '@x402/core', '@x402/core/*', '@x402/evm', '@x402/evm/*'],
  dts: {
    resolve: [/^@bondrail\//],
    // tsup's declaration resolver needs explicit paths for source-only package exports.
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@bondrail/observer/*': ['../../services/observer/src/*'],
        '@bondrail/scoring': ['../scoring/src/index.ts'],
        '@bondrail/scoring/*': ['../scoring/src/*'],
      },
    },
  },
});
