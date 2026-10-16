// Writes the Watched bond's monitoring config from docs/deployments/<chain>.json (after setup-demo.ts agent):
//   .data/deployments/<chain>-<deployment>/{registry,cre-config,targets}.json
// BONDRAIL_CONFIG_DIR overrides this directory; checked-in defaults are not overwritten.
//
//   OBSERVER_URL=https://<observer>/observe pnpm tsx demo/scripts/write-watch-config.ts
// Without OBSERVER_URL the CRE config points at a loopback observer (local `cre workflow simulate` only).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, DEPLOYMENT, chainId, readDeployment } from '../../scripts/lib.ts';

import { assertWritable, writeJson } from '../../scripts/deployment-path.mjs';

const d = readDeployment();
const output = path.resolve(process.env.BONDRAIL_CONFIG_DIR ?? path.join(ROOT, '.data/deployments', `${chainId}-${DEPLOYMENT}`));
for (const name of ['registry.json', 'cre-config.json', 'targets.json']) assertWritable(path.join(output, name));
if (!d.watchPolicy) throw new Error('No watchPolicy in the deployment: run setup-demo.ts agent first');
const observerURL = process.env.OBSERVER_URL ?? 'http://127.0.0.1:8790/observe';
const loopback = observerURL.startsWith('http://127.0.0.1:');
const write = (file: string, value: unknown) => {
  writeJson(path.join(output, file), value);
  console.log(`  wrote ${file}`);
};
write('registry.json', [d.watchPolicy]);
write('cre-config.json', {
  schedule: '*/30 * * * * *',
  observerURL,
  ...(loopback ? { simulationLoopbackObserver: true } : {}),
  observerSigner: d.observer,
  gasLimit: '700000',
  policy: d.watchPolicy,
});

write('targets.json', Object.values(d.issuers).filter(r => r.bond).map(r => ({ bond: r.bond, account: r.account })));
console.log(`Configuration directory: ${output}`);
