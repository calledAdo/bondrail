import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deploymentPath, deploymentName, writeJson, roleKeyPath } from './deployment-path.mjs';

test('default main manifest and indexer config select current Bondrail contracts', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const deployment = JSON.parse(fs.readFileSync(deploymentPath(root, 10143, 'main'), 'utf8'));
  assert.equal(deployment.deployment, 'main');
  assert.equal(deployment.factory, '0x94c86517a520e56f104c6c82b96632643b3f5d81');
  assert.equal(deployment.vault, '0x57fd6a271a6a4e96b151e5d0732c7f61e3059f07');
  assert.equal(deployment.creditRegistry, '0x8cb78ff328cd4982030f275d017892fd2fa512f8');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'services/observer/registry.json'), 'utf8')), [deployment.watchPolicy]);
  const cre = JSON.parse(fs.readFileSync(path.join(root, 'cre/bondrail-covenant/config.json'), 'utf8'));
  assert.deepEqual(cre.policy, deployment.watchPolicy);
  assert.equal(cre.observerSigner, deployment.observer);

  const output = fs.mkdtempSync(path.join(os.tmpdir(), 'bondrail-indexer-test-'));
  try {
    const env = { ...process.env, BONDRAIL_INDEXER_DIR: output };
    for (const name of ['BONDRAIL_DEPLOYMENT', 'CREDIT_REGISTRY_ADDRESS', 'MONAD_RPC']) delete env[name];
    execFileSync(process.execPath, ['indexer/gen-config.mjs', '10143'], { cwd: root, env });
    for (const file of ['config.yaml', 'src/deployment.ts']) {
      assert.equal(fs.readFileSync(path.join(output, file), 'utf8'), fs.readFileSync(path.join(root, 'indexer', file), 'utf8'));
    }
    const config = fs.readFileSync(path.join(output, 'config.yaml'), 'utf8');
    for (const address of [deployment.factory, deployment.covenant, deployment.creditRegistry]) assert(config.includes(address));
    assert(config.includes(String(deployment.startBlock)));
  } finally { fs.rmSync(output, { recursive: true }); }
});

test('named manifests isolate main and reject traversal', () => {
  assert.equal(deploymentPath('/repo', 10143, 'main'), '/repo/docs/deployments/10143.json');
  assert.equal(deploymentPath('/repo', 10143, 'staging'), '/repo/docs/deployments/10143-staging.json');
  for (const name of ['../main', '', '/tmp/a', 'STAGING', 'a/b']) assert.throws(() => deploymentName(name));
});
test('existing manifests require explicit force and remain intact on refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondrail-path-test-'));
  try {
    const file = deploymentPath(dir, 31337, 'staging');
    writeJson(file, { factory: 'original' }, false);
    assert.throws(() => writeJson(file, { factory: 'replacement' }, false), /--force/);
    assert.equal(JSON.parse(fs.readFileSync(file)).factory, 'original');
    writeJson(file, { factory: 'replacement' }, true);
    assert.equal(JSON.parse(fs.readFileSync(file)).factory, 'replacement');
  } finally { fs.rmSync(dir, { recursive: true }); }
});

test('named roles get fresh paths while the deployer remains shared; explicit overrides are respected', () => {
  assert.equal(roleKeyPath('observer', {}, '/operator'), '/operator/.bondrail/observer.key');
  assert.equal(roleKeyPath('deployer', {}, '/operator'), '/operator/.bondrail/deployer.key');
  const env = { BONDRAIL_DEPLOYMENT: 'staging', BONDRAIL_KEY_DIR: '/tmp/test-keys' };
  assert.equal(roleKeyPath('reviewer', env), '/tmp/test-keys/staging/reviewer.key');
  assert.equal(roleKeyPath('deployer', env), '/tmp/test-keys/deployer.key');
  assert.equal(roleKeyPath('payer-0', { ...env, BONDRAIL_KEY_PREFIX: 'other' }), '/tmp/test-keys/other/payer-0.key');
  assert.equal(roleKeyPath('deployer', { ...env, BONDRAIL_DEPLOYER_KEY_FILE: '/tmp/shared.key' }), '/tmp/shared.key');
  assert.throws(() => roleKeyPath('../deployer', env));
  assert.throws(() => roleKeyPath('reviewer', { ...env, BONDRAIL_KEY_PREFIX: '../main' }));
});
