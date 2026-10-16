import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const sdkDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(sdkDir, '../..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const entryPoints = ['.', './abis', './client', './permit', './x402', './x402-guard',
  './data', './credit', './yield', './trigger', './vault'];

// Do not let workspace loaders, conditions or NODE_PATH make the consumer pass accidentally.
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.NODE_PATH;
delete env.npm_config_node_options;
delete env.NPM_CONFIG_NODE_OPTIONS;

function run(command, args, cwd, capture = false) {
  return execFileSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: ['ignore', capture ? 'pipe' : 'inherit', 'inherit'],
  });
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
}

async function assertTargets(value, label, packageDir) {
  if (typeof value === 'string') {
    assert(value.startsWith('./dist/'), `${label} must point into dist/, got ${value}`);
    const target = resolve(packageDir, value);
    assert(isInside(join(packageDir, 'dist'), target), `${label} escapes dist/: ${value}`);
    assert((await stat(target)).isFile(), `${label} is not a file: ${value}`);
    return;
  }
  assert(value && typeof value === 'object', `${label} is not an export target`);
  assert(Object.keys(value).length > 0, `${label} has no export targets`);
  for (const [key, target] of Object.entries(value)) {
    await assertTargets(target, `${label}.${key}`, packageDir);
  }
}

const tempDir = await mkdtemp(join(tmpdir(), 'bondrail-sdk-verify-'));
try {
  assert(!isInside(repoDir, tempDir), 'Verification must run outside the repository');
  env.npm_config_cache = join(tempDir, 'npm-cache');
  console.log('[sdk:verify] Building SDK');
  run(npm, ['run', 'build'], sdkDir);

  // Reproduce npm's manifest handling, including publishes that skip lifecycle scripts.
  // Building explicitly also avoids a second build or any lifecycle recursion here.
  console.log('[sdk:verify] Packing with npm --ignore-scripts');
  const packed = JSON.parse(run(npm,
    ['pack', '--ignore-scripts', '--json', '--pack-destination', tempDir], sdkDir, true));
  assert.equal(packed.length, 1, 'Expected exactly one tarball');
  const tarball = join(tempDir, packed[0].filename);
  const unpackDir = join(tempDir, 'unpacked');
  await mkdir(unpackDir);
  run('tar', ['-xzf', tarball, '-C', unpackDir], tempDir);

  const packageDir = join(unpackDir, 'package');
  const manifest = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'));
  const sourceManifest = JSON.parse(await readFile(join(sdkDir, 'package.json'), 'utf8'));
  assert.equal(manifest.name, '@bondrail/sdk');
  assert.equal(manifest.version, sourceManifest.version);
  assert.deepEqual(Object.keys(manifest.exports).sort(), [...entryPoints].sort());
  assert.equal(manifest.publishConfig?.exports, undefined, 'Do not rely on publisher-specific exports');
  for (const field of ['exports', 'main', 'types']) {
    await assertTargets(manifest[field], field, packageDir);
  }
  console.log(`[sdk:verify] ${manifest.name}@${manifest.version}: all exports/main/types targets exist in dist/`);

  const consumerDir = join(tempDir, 'consumer');
  await mkdir(consumerDir);
  await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
    name: 'bondrail-sdk-pack-consumer', private: true, type: 'module',
  }));
  console.log('[sdk:verify] Installing tarball + viem into an isolated consumer');
  run(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false',
    tarball, `viem@${sourceManifest.devDependencies.viem}`], consumerDir);

  const specifiers = entryPoints.map(entry => manifest.name + (entry === '.' ? '' : entry.slice(1)));
  const smokePath = join(consumerDir, 'smoke.mjs');
  await writeFile(smokePath, `for (const name of ${JSON.stringify(specifiers)}) {
  const module = await import(name);
  if (Object.keys(module).length === 0) throw new Error(name + ' has no exports');
  console.log('OK ' + name + ' (' + Object.keys(module).length + ' exports)');
}
`);
  run(process.execPath, [smokePath], consumerDir);
  console.log(`[sdk:verify] PASS: all ${entryPoints.length} entry points imported with plain Node`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
