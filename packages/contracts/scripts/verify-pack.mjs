import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(packageDir, '../..');
const forge = process.env.FORGE ?? join(homedir(), '.foundry/bin/forge');
const tempDir = await mkdtemp(join(tmpdir(), 'bondrail-contracts-verify-'));
const env = { ...process.env, npm_config_cache: join(tempDir, 'npm-cache') };
// The external consumer must not resolve libraries or configuration from this workspace.
for (const key of Object.keys(env)) {
  if (/^(FOUNDRY_|DAPP_)/.test(key) || ['NODE_PATH', 'NODE_OPTIONS'].includes(key)) delete env[key];
}
function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
}
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
function type(parameter) {
  return parameter.type.startsWith('tuple')
    ? `(${parameter.components.map(type).join(',')})${parameter.type.slice(5)}`
    : parameter.type;
}
function signature(item) { return `${item.name}(${item.inputs.map(type).join(',')})`; }

try {
  console.log('[contracts:verify] Compile canonical contracts and compare interface ABIs');
  run(forge, ['build'], join(repoDir, 'contracts'));
  for (const contract of ['BondrailVault', 'BondrailCreditRegistry']) {
    const actual = await json(join(repoDir, `contracts/out/${contract}.sol/${contract}.json`));
    const iface = await json(join(repoDir, `contracts/out/I${contract}.sol/I${contract}.json`));
    const functions = new Map(actual.abi.filter(i => i.type === 'function').map(i => [signature(i), i]));
    let count = 0;
    for (const item of iface.abi.filter(i => i.type === 'function')) {
      const sig = signature(item);
      const real = functions.get(sig);
      assert(real, `${contract} missing ${sig}`);
      assert.equal(iface.methodIdentifiers[sig], actual.methodIdentifiers[sig], `${sig} selector`);
      assert.equal(item.stateMutability, real.stateMutability, `${sig} mutability`);
      assert.deepEqual(item.outputs.map(type), real.outputs.map(type), `${sig} return layout`);
      count++;
    }
    console.log(`[contracts:verify] I${contract}: ${count} selectors, mutability and return layouts match`);
  }

  console.log('[contracts:verify] npm pack (runs prepack from canonical sources)');
  const [packed] = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', tempDir], packageDir, true));
  const consumerDir = join(tempDir, 'native-project');
  await cp(join(repoDir, 'examples/native-project'), consumerDir, {
    recursive: true,
    filter: path => !['node_modules', 'out', 'cache'].includes(path.split('/').at(-1)),
  });
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    join(tempDir, packed.filename)], consumerDir);
  const installedDir = join(consumerDir, 'node_modules/@bondrail/contracts');
  const manifest = await json(join(installedDir, 'package.json'));
  assert.equal(manifest.name, '@bondrail/contracts');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.dependencies['@openzeppelin/contracts'], '5.4.0');
  const canonicalDir = join(repoDir, 'contracts/src');
  const names = (await readdir(canonicalDir)).filter(name => name.endsWith('.sol')).sort();
  assert.deepEqual((await readdir(join(installedDir, 'src'))).sort(), names);
  for (const name of names) {
    assert.deepEqual(await readFile(join(installedDir, 'src', name)), await readFile(join(canonicalDir, name)), name);
  }
  console.log(`[contracts:verify] Installed tarball: ${names.length} sources byte-identical`);
  run(forge, ['build'], consumerDir);
  run(forge, ['test', '-v'], consumerDir);
  console.log('[contracts:verify] PASS: external npm consumer builds and routes fees through real local contracts');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
