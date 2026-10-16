import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { Observer } from '../src/index';
import { LocalStore } from '../src/store';
import { publicAddress, validateURL } from '../src/fetch';
import {
  classify,
  endpointsToCheck,
  parseManifest,
  parseOffer,
  policyHash,
  PARSER_VERSION,
  observationDomain,
  observationTypes,
  typedObservation,
  type WatchPolicy,
} from '../src/protocol';
const OTHER = '0x4444444444444444444444444444444444444444';
const p: WatchPolicy = {
  id: 'research',
  chainId: 10143,
  chainSelector: '2183018362218727504',
  covenant: '0x1111111111111111111111111111111111111111',
  bond: '0x2222222222222222222222222222222222222222',
  manifestUrl: 'https://agent.example/.well-known/bondrail.json',
  endpoints: [
    { url: 'https://agent.example/api/oracle?question=health', minAmount: '10000' },
    { url: 'https://agent.example/api/summary?text=health', minAmount: '20000' },
  ],
  method: 'GET',
  headers: { accept: 'application/json' },
  network: 'eip155:10143',
  asset: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
  expectedPayTo: '0x3333333333333333333333333333333333333333',
  maxTimeoutSeconds: 300,
  parserVersion: PARSER_VERSION,
  epochSeconds: 30,
  freshnessSeconds: 90,
};
const [e0, e1] = p.endpoints as [WatchPolicy['endpoints'][0], WatchPolicy['endpoints'][0]];
function option(over: Record<string, unknown> = {}) {
  return {
    scheme: 'exact',
    network: p.network,
    asset: p.asset,
    payTo: p.expectedPayTo,
    amount: e0.minAmount,
    maxTimeoutSeconds: 300,
    extra: { assetTransferMethod: 'eip3009' },
    ...over,
  };
}
function offer(accepts: unknown[] = [option()], url = e0.url) {
  return { x402Version: 2, resource: { url }, accepts };
}
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
const manifest = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ version: 1, chainId: 10143, account: p.expectedPayTo, endpoints: p.endpoints.map((e) => e.url), ...over });
const check = (accepts: unknown[]) => parseOffer(402, encoded(offer(accepts)), p, e0).result;

test('every payment option must pay the account at or above the floor', () => {
  assert.equal(check([option()]), 1);
  assert.equal(check([option({ amount: '15000' })]), 1); // raising the price is fine
  assert.equal(check([option(), option({ amount: '50000' })]), 1); // several options, all to the account
  assert.equal(check([option({ payTo: OTHER })]), 2);
  assert.equal(check([option(), option({ payTo: OTHER })]), 2); // a second option paying elsewhere
  assert.equal(check([option(), option({ network: 'eip155:8453' })]), 2); // another network
  assert.equal(check([option({ amount: '9999' })]), 2); // below the floor
  assert.equal(check([option({ extra: { assetTransferMethod: 'permit2' } })]), 2); // another transfer method
  assert.equal(check([option(), 'opaque']), 2); // an option we cannot verify
});
test('no readable offer is Unknown, never a violation', () => {
  for (const status of [0, 200, 301, 429, 500]) assert.equal(parseOffer(status, encoded(offer()), p, e0).result, 0);
  assert.equal(parseOffer(402, 'not_base64', p, e0).result, 0);
  assert.equal(parseOffer(402, encoded(offer([])), p, e0).result, 0);
  assert.equal(parseOffer(402, encoded(offer([option()], 'https://agent.example/other')), p, e0).result, 0);
});
test('the manifest must keep naming the account and every covered endpoint', () => {
  assert.equal(parseManifest(200, manifest(), p).result, 1);
  assert.equal(parseManifest(200, manifest({ endpoints: [...p.endpoints.map((e) => e.url), 'https://agent.example/new'] }), p).result, 1);
  assert.equal(parseManifest(200, manifest({ account: OTHER }), p).result, 2);
  assert.equal(parseManifest(200, manifest({ endpoints: [e0.url] }), p).result, 2);
  assert.equal(parseManifest(404, undefined, p).result, 0);
  assert.equal(parseManifest(200, '{not json', p).result, 0);
});
test('a check covers the manifest and every endpoint: violation wins, then all compliant, else Unknown', () => {
  const ok0 = { status: 402, header: encoded(offer()) };
  const ok1 = { status: 402, header: encoded(offer([option({ amount: e1.minAmount })], e1.url)) };
  const m = { status: 200, body: manifest() };
  const E = p.endpoints;
  assert.equal(classify(p, m, E, [ok0, ok1]).result, 1);
  assert.equal(classify(p, m, E, [ok0, { status: 500 }]).result, 0);
  const diverted = { status: 402, header: encoded(offer([option({ payTo: OTHER })], e1.url)) };
  assert.equal(classify(p, m, E, [{ status: 500 }, diverted]).result, 2);
  assert.equal(classify(p, m, E, [{ status: 500 }, diverted]).observedPayTo, OTHER);
  assert.equal(classify(p, { status: 404 }, E, [ok0, ok1]).result, 0);
});
test('paid endpoints added to the manifest after issuance are checked too (same origin only)', () => {
  const added = 'https://agent.example/api/new';
  const m = { status: 200, body: manifest({ endpoints: [...p.endpoints.map((e) => e.url), added, 'https://evil.example/x'] }) };
  const all = endpointsToCheck(p, m);
  assert.deepEqual(all.map((e) => e.url), [...p.endpoints.map((e) => e.url), added]);
  const ok0 = { status: 402, header: encoded(offer()) };
  const ok1 = { status: 402, header: encoded(offer([option({ amount: e1.minAmount })], e1.url)) };
  const cheap = { status: 402, header: encoded(offer([option({ amount: '1' })], added)) };
  const elsewhere = { status: 402, header: encoded(offer([option({ payTo: OTHER })], added)) };
  assert.equal(classify(p, m, all, [ok0, ok1, cheap]).result, 1); // no floor on an endpoint added later
  assert.equal(classify(p, m, all, [ok0, ok1, elsewhere]).result, 2); // but it must pay the account
  assert.equal(endpointsToCheck(p, { status: 404 }).length, 2);
});
test('full offer canonical hash stable across field order, sensitive to extensions', () => {
  const a = offer(),
    b = { accepts: a.accepts, resource: a.resource, x402Version: 2 };
  assert.equal(parseOffer(402, encoded(a), p, e0).offerHash, parseOffer(402, encoded(b), p, e0).offerHash);
  assert.notEqual(
    parseOffer(402, encoded(a), p, e0).offerHash,
    parseOffer(402, encoded({ ...a, extensions: { newPolicy: true } }), p, e0).offerHash,
  );
  assert.notEqual(policyHash(p), policyHash({ ...p, endpoints: [e0] }));
});
test('SSRF checks deny private, loopback, reserved and mapped address ranges', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.2',
    '169.254.169.254',
    '192.168.1.2',
    '172.31.1.1',
    '100.64.1.2',
    '::1',
    '::ffff:127.0.0.1',
    'fd00::1',
    'fe80::1',
    '2002:7f00:1::',
    '2001:db8::1',
  ])
    assert.equal(publicAddress(ip), false, ip);
  assert.equal(publicAddress('8.8.8.8'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  assert.throws(() => validateURL('https://user:password@example.com/'));
  assert.throws(() => validateURL('http://127.0.0.1:3001/', false));
  assert.equal(validateURL('http://127.0.0.1:3001/', true).port, '3001');
});
test('durable CAS elects one writer across store instances and survives reopening', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bondrail-store-'));
  try {
    const a = new LocalStore(dir),
      b = new LocalStore(dir);
    const wins = await Promise.all([a.cas('key', null, 'one'), b.cas('key', null, 'two')]);
    assert.equal(wins.filter(Boolean).length, 1);
    const value = await new LocalStore(dir).get('key');
    assert.ok(value === 'one' || value === 'two');
    assert.equal(await b.cas('key', 'wrong', 'three'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('observer fetches independently, signs immutable one-per-epoch and binds deployment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bondrail-observer-'));
  try {
    let calls = 0;
    const key = `0x${'11'.repeat(32)}` as Hex;
    const observer = new Observer(
      [p],
      new LocalStore(dir),
      key,
      false,
      async (url: string) => {
        calls++;
        if (url === p.manifestUrl) return { status: 200, body: manifest() };
        const e = p.endpoints.find((x) => x.url === url)!;
        return { status: 402, header: encoded(offer([option({ amount: e.minAmount })], e.url)) };
      },
      () => 3001,
    );
    const one = await observer.observe(p.id, 100),
      two = await observer.observe(p.id, 100);
    assert.deepEqual(one, two);
    assert.equal(calls, 3); // the manifest and both endpoints, once per epoch
    assert.equal(one.observation.result, 1);
    const signer = await recoverTypedDataAddress({
      domain: observationDomain(p),
      types: observationTypes,
      primaryType: 'Observation',
      message: typedObservation(one.observation),
      signature: one.signature,
    });
    assert.equal(signer, observer.signerAddress);
    const wrong = await recoverTypedDataAddress({
      domain: observationDomain({ ...p, chainId: 31337 }),
      types: observationTypes,
      primaryType: 'Observation',
      message: typedObservation(one.observation),
      signature: one.signature,
    });
    assert.notEqual(wrong, observer.signerAddress);
    await assert.rejects(observer.observe(p.id, 99));
    await assert.rejects(observer.observe('arbitrary-url', 100));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
