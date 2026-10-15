// Environment configuration. Server RPC URLs may contain provider keys; keep exports private.
import { chainId, DEPLOYMENT, readDeployment, rpcUrl, rpcUrls } from './lib.ts';
import { webEnvironment } from './web-env.ts';
const d = readDeployment();
const kind = process.argv[2];
const origin = process.env.AGENT_PUBLIC_URL ?? 'https://agent-next.example.com';
const rpcEnvironment = {
  BONDRAIL_RPC_URLS: rpcUrls.join(','), BONDRAIL_RPC_URL: rpcUrl,
  BONDRAIL_RPC_RPS: process.env.BONDRAIL_RPC_RPS ?? '6',
  BONDRAIL_RPC_CONCURRENCY: process.env.BONDRAIL_RPC_CONCURRENCY ?? '2',
};
const env = kind === 'web' ? webEnvironment(d, rpcUrl, process.env.INDEXER_URL ?? '')
  : kind === 'agent' ? {
    ...rpcEnvironment,
    BONDRAIL_CHAIN_ID: String(chainId), BONDRAIL_ENV: 'testnet', BONDRAIL_STORE: 'redis',
    BONDRAIL_STORE_NAMESPACE: `bondrail-${chainId}-${DEPLOYMENT}-agent`,
    AGENT_USDC_ADDRESS: d.asset, AGENT_INITIAL_PAY_TO: d.issuers.agent?.account ?? '', AGENT_PUBLIC_URL: origin,
    X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL ?? 'https://facilitator-next.example.com',
  } : kind === 'facilitator' ? { ...rpcEnvironment, FACILITATOR_FACTORY: d.factory, FACILITATOR_ASSET: d.asset,
    FACILITATOR_RPC_URL: rpcUrl, FACILITATOR_HOST: '127.0.0.1', FACILITATOR_PORT: '8789' }
  : undefined;
if (!env) throw new Error('usage: export-env.ts web|agent|facilitator');
for (const [name, value] of Object.entries(env)) {
  if (/[\r\n]/.test(value)) throw new Error('Invalid environment value');
  console.log(`${name}=${value}`);
}
