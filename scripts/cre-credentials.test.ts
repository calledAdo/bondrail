import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertCreCredentials } from './cre-credentials.ts';

test('CRE requires an explicit absolute HOME instead of the Node home fallback', () => {
  for (const HOME of [undefined, '', 'relative']) {
    assert.throws(() => assertCreCredentials({ HOME }), /CRE requires an absolute HOME.*HOME=\/root/);
  }
});

test('CRE preflight reports the expected credential path and rejects a directory', t => {
  const HOME = mkdtempSync(path.join(os.tmpdir(), 'bondrail-cre-'));
  t.after(() => rmSync(HOME, { recursive: true, force: true }));
  const file = path.join(HOME, '.cre/cre.yaml');
  assert.throws(() => assertCreCredentials({ HOME }), error => {
    assert(error instanceof Error);
    assert(error.message.includes(file));
    assert.match(error.message, /missing or unreadable.*cre login/);
    return true;
  });
  mkdirSync(file, { recursive: true });
  assert.throws(() => assertCreCredentials({ HOME }), /missing or unreadable/);
  rmSync(file, { recursive: true });
  writeFileSync(file, 'test fixture; never real credentials', { mode: 0o600 });
  assert.equal(assertCreCredentials({ HOME }), file);
});

test('reporter fails on missing credentials before contacting RPC or loading a deployer key', t => {
  const HOME = mkdtempSync(path.join(os.tmpdir(), 'bondrail-cre-reporter-'));
  t.after(() => rmSync(HOME, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/report-covenant.ts', '--broadcast'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, HOME, BONDRAIL_CHAIN_ID: '10143', BONDRAIL_DEPLOYMENT: 'main',
      BONDRAIL_RPC_URLS: 'http://127.0.0.1:1', BONDRAIL_KEY_DIR: HOME, BONDRAIL_KEY_PREFIX: '' },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CRE credentials file missing or unreadable/);
  assert.doesNotMatch(result.stderr, /Missing key|HTTP request failed|Credential validation failed/);
});
