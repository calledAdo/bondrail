import assert from 'node:assert/strict';
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const canonicalDir = resolve(packageDir, '../../contracts/src');
const targetDir = join(packageDir, 'src');
// Generated files never become a second editable source tree.
await rm(targetDir, { recursive: true, force: true });
await mkdir(targetDir, { recursive: true });
const sources = (await readdir(canonicalDir)).filter(name => name.endsWith('.sol')).sort();
assert(sources.length > 0, 'No canonical Solidity sources');
for (const name of sources) {
  await copyFile(join(canonicalDir, name), join(targetDir, name));
  assert.deepEqual(await readFile(join(targetDir, name)), await readFile(join(canonicalDir, name)));
}
console.error(`[contracts:prepare] ${sources.length} Solidity sources byte-identical to contracts/src`);
