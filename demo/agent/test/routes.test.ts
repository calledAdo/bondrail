import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeBase64Json, type BondrailManifest } from '@bondrail/observer/protocol';
import { GET as oracle } from '../src/app/api/oracle/route';
import { GET as manifest } from '../src/app/.well-known/bondrail.json/route';

test('every advertised resource returns an unpaid 402 with identical account, asset and price', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bondrail-agent-routes-'));
  const env = {
    BONDRAIL_ENV: 'local', BONDRAIL_CHAIN_ID: '10143', BONDRAIL_STORE: 'local',
    BONDRAIL_DATA_DIR: dir, AGENT_PUBLIC_URL: 'https://agent.example',
    AGENT_INITIAL_PAY_TO: '0x1111111111111111111111111111111111111111',
    AGENT_BONDRAIL_ACCOUNT: '0x1111111111111111111111111111111111111111',
    AGENT_USDC_ADDRESS: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
    X402_FACILITATOR_URL: 'https://facilitator.example',
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unpaid probes must not call backend'); });
  const response = await manifest();
  assert.equal(response.status, 200);
  const doc = await response.json() as BondrailManifest;
  assert.deepEqual(doc.endpoints, [
    'https://agent.example/api/oracle', 'https://agent.example/api/oracle?question=health',
  ]);
  const offers = [];
  for (const url of [...doc.endpoints, 'https://agent.example/api/oracle?question=hello']) {
    const result = await oracle(new Request(url));
    assert.equal(result.status, 402, url);
    const offer = decodeBase64Json(result.headers.get('PAYMENT-REQUIRED')!) as {
      resource: { url: string }; accepts: { payTo: string; asset: string; amount: string }[];
    };
    assert.equal(offer.resource.url, url);
    assert.equal(offer.accepts.length, 1);
    assert.equal(offer.accepts[0]!.payTo, doc.account);
    assert.equal(offer.accepts[0]!.asset, env.AGENT_USDC_ADDRESS);
    assert.equal(offer.accepts[0]!.amount, '10000');
    offers.push(offer.accepts);
  }
  assert.deepEqual(offers[0], offers[1]);
  assert.deepEqual(offers[0], offers[2]);
});

test('oracle still rejects empty, repeated, oversized and unknown query parameters', async () => {
  for (const query of ['?question=', '?question=a&question=b', `?question=${'x'.repeat(1201)}`, '?other=health']) {
    assert.equal((await oracle(new Request(`https://agent.example/api/oracle${query}`))).status, 400);
  }
});
