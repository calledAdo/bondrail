// Writes the Watched bond's monitoring config from docs/deployments/<chain>.json (after setup-demo.ts agent):
//   services/observer/registry.json   the observer's immutable policy list
//   cre/slice-covenant/config.json    the CRE workflow config (policy + observer endpoint and signer)
//
//   OBSERVER_URL=https://<observer>/observe pnpm tsx demo/scripts/write-watch-config.ts
// Without OBSERVER_URL the CRE config points at a loopback observer (local `cre workflow simulate` only).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readDeployment } from '../../scripts/lib.ts';

const d = readDeployment();
if (!d.watchPolicy) throw new Error('No watchPolicy in the deployment: run setup-demo.ts agent first');
const observerURL = process.env.OBSERVER_URL ?? 'http://127.0.0.1:8787/observe';
const loopback = observerURL.startsWith('http://127.0.0.1:');
const write = (file: string, value: unknown) => {
  fs.writeFileSync(path.join(ROOT, file), JSON.stringify(value, null, 2) + '\n');
  console.log(`  wrote ${file}`);
};
write('services/observer/registry.json', [d.watchPolicy]);
write('cre/slice-covenant/config.json', {
  schedule: '*/30 * * * * *',
  observerURL,
  ...(loopback ? { simulationLoopbackObserver: true } : {}),
  observerSigner: d.observer,
  gasLimit: '700000',
  policy: d.watchPolicy,
});
