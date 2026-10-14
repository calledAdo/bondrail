import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deploymentPath, deploymentName, writeJson } from './deployment-path.mjs';

test('named manifests isolate main and reject traversal', () => {
  assert.equal(deploymentPath('/repo', 10143, 'main'), '/repo/docs/deployments/10143.json');
  assert.equal(deploymentPath('/repo', 10143, 'next'), '/repo/docs/deployments/10143-next.json');
  for (const name of ['../main', '', '/tmp/a', 'NEXT', 'a/b']) assert.throws(() => deploymentName(name));
});
test('existing manifests require explicit force and remain intact on refusal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bondrail-path-test-'));
  try {
    const file = deploymentPath(dir, 31337, 'next');
    writeJson(file, { factory: 'original' }, false);
    assert.throws(() => writeJson(file, { factory: 'replacement' }, false), /--force/);
    assert.equal(JSON.parse(fs.readFileSync(file)).factory, 'original');
    writeJson(file, { factory: 'replacement' }, true);
    assert.equal(JSON.parse(fs.readFileSync(file)).factory, 'replacement');
  } finally { fs.rmSync(dir, { recursive: true }); }
});
