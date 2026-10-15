// Owner-run CRE reporter for the selected Bondrail deployment. This script is never used by local e2e.
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { account, assertChain, chainId, DEPLOYMENT, key, readDeployment, ROOT } from './lib.ts';
async function main() {
  if (chainId !== 10143) throw new Error('Reporter requires chain 10143');
  if (!process.argv.includes('--broadcast')) throw new Error('Owner must pass --broadcast to send CRE reports');
  await assertChain();
  const d = readDeployment();
  const options = { fallbackFile: path.join(os.homedir(), '.zeitgeist/testnet-deployer.key') };
  if (account('deployer', options).address.toLowerCase() !== d.deployer?.toLowerCase()) throw new Error('Deployer mismatch');
  const config = path.join(process.env.BONDRAIL_CONFIG_DIR ?? path.join(ROOT, '.data/deployments', `${chainId}-${DEPLOYMENT}`), 'cre-config.json');
  const report = () => new Promise<string>((resolve, reject) => {
    const child = spawn(process.env.CRE_BIN ?? 'cre', ['workflow', 'simulate', 'bondrail-covenant', '--target', 'testnet',
      '--non-interactive', '--trigger-index', '0', '--broadcast', '--config', config,
      '--env', process.env.CRE_ENV_FILE ?? '/etc/bondrail.env',
      '--wasm', path.join(ROOT, 'cre/bondrail-covenant/dist/workflow.wasm')],
    { cwd: path.join(ROOT, 'cre'), env: { ...process.env, CRE_ETH_PRIVATE_KEY: key('deployer', options) }, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString(); process.stdout.write(chunk); });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(out) : reject(new Error(`CRE exited ${code}`)));
  });
  let out = await report();
  for (let attempt = 0; attempt < 4 && out.includes('BONDRAIL_RESULT=2'); attempt++) {
    const epoch = Number(/BONDRAIL_EPOCH=(\d+)/.exec(out)?.[1]);
    if (!Number.isSafeInteger(epoch)) throw new Error('Missing CRE epoch');
    await delay(Math.max(0, ((epoch + 1) * 30 + 1) * 1000 - Date.now()));
    out = await report();
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
