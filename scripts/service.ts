// Launch an existing service with the selected deployment and scoped key, without printing secrets.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { account, assertChain, chainId, DEPLOYMENT, key, readDeployment, ROOT, rpcUrl } from './lib.ts';
async function main() {
  await assertChain();
  const [service, ...args] = process.argv.slice(2);
  if (!['facilitator', 'attester', 'worker', 'observer'].includes(service)) throw new Error('Choose facilitator, attester, worker or observer');
  const d = readDeployment();
  if (d.roles?.[service]?.toLowerCase() !== account(service).address.toLowerCase()) throw new Error('Service key does not match deployment role');
  const env = { ...process.env, BONDRAIL_CHAIN_ID: String(chainId), BONDRAIL_RPC_URL: rpcUrl,
    BONDRAIL_STORE_NAMESPACE: `bondrail-${chainId}-${DEPLOYMENT}`,
    ...(service === 'facilitator' ? { FACILITATOR_PRIVATE_KEY: key(service), FACILITATOR_FACTORY: d.factory,
      FACILITATOR_ASSET: d.asset, FACILITATOR_RPC_URL: rpcUrl } : {}),
    ...(service === 'attester' ? { ATTESTER_PRIVATE_KEY: key(service), CHAIN_ID: String(chainId), RPC_URL: rpcUrl,
      CREDIT_REGISTRY_ADDRESS: d.creditRegistry, CREDIT_ACCOUNT: process.env.CREDIT_ACCOUNT ?? d.issuers.pumplab?.account,
      FACTORY_START_BLOCK: d.startBlock } : {}),
    ...(service === 'worker' ? { WORKER_PRIVATE_KEY: key(service) } : {}),
    ...(service === 'observer' ? { OBSERVER_PRIVATE_KEY: key(service) } : {}),
  };
  const entry = service === 'facilitator' || service === 'observer' ? 'server.ts' : 'main.ts';
  const child = spawn(process.execPath, ['--import', 'tsx', `services/${service}/src/${entry}`, ...args], { cwd: ROOT, env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  child.on('error', () => { process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
