import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARSER_VERSION, type WatchPolicy } from '@bondrail/observer/protocol';
import {
  assertPreflightMode, preflightWatchedPolicy, selectAgentEndpoint,
} from '../../scripts/watched-preflight';

const base = 'https://agent.example/api/oracle';
const health = `${base}?question=health`;
const policy: WatchPolicy = {
  id: 'bondrail-agent', chainId: 10143, chainSelector: '2183018362218727504',
  covenant: '0x1111111111111111111111111111111111111111',
  bond: '0x2222222222222222222222222222222222222222',
  manifestUrl: 'https://agent.example/.well-known/bondrail.json',
  endpoints: [{ url: base, minAmount: '10000' }], method: 'GET', headers: { accept: 'application/json' },
  network: 'eip155:10143', asset: '0x3333333333333333333333333333333333333333',
  expectedPayTo: '0x4444444444444444444444444444444444444444', maxTimeoutSeconds: 300,
  parserVersion: PARSER_VERSION, epochSeconds: 30, freshnessSeconds: 90,
};
const manifest = (endpoints = [base, health], account = policy.expectedPayTo) => ({
  version: 1, chainId: policy.chainId, account, endpoints,
});
const fetchedManifest = (endpoints?: string[]) => ({ status: 200, body: JSON.stringify(manifest(endpoints)) });
function offer(url: string, overrides: Record<string, unknown> = {}) {
  return new Response(null, {
    status: 402,
    headers: { 'PAYMENT-REQUIRED': Buffer.from(JSON.stringify({
      x402Version: 2, resource: { url }, accepts: [{
        scheme: 'exact', network: policy.network, asset: policy.asset,
        payTo: policy.expectedPayTo, amount: '10000', maxTimeoutSeconds: 300,
        extra: { assetTransferMethod: 'eip3009' }, ...overrides,
      }],
    })).toString('base64') },
  });
}
function fixture(
  doc = manifest(),
  endpointResponse: (url: string) => Response = offer,
) {
  const visited: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'manual');
    assert.equal(new Headers(init?.headers).has('PAYMENT-SIGNATURE'), false);
    const url = String(input);
    visited.push(url);
    return url === policy.manifestUrl ? Response.json(doc) : endpointResponse(url);
  };
  return { fetcher, visited };
}

test('issuance refuses the live base-policy / query-only-manifest mismatch with the observer reason', async () => {
  const { fetcher, visited } = fixture(manifest([health]));
  await assert.rejects(preflightWatchedPolicy(policy, fetcher), /manifest_endpoint_withdrawn/);
  assert.deepEqual(visited, [policy.manifestUrl, base, health]);
});

test('matching manifest and paid endpoints pass for both base and legacy health policies', async () => {
  for (const url of [base, health]) {
    const { fetcher, visited } = fixture();
    const result = await preflightWatchedPolicy({ ...policy, endpoints: [{ url, minAmount: '10000' }] }, fetcher);
    assert.equal(result.result, 1);
    assert.equal(result.reason, 'compliant');
    assert.equal(result.observedPayTo, policy.expectedPayTo);
    assert.deepEqual(new Set(visited), new Set([policy.manifestUrl, base, health]));
  }
});

test('issuance checks extra manifest endpoints and refuses diverted payment', async () => {
  const { fetcher } = fixture(manifest(), (url) =>
    offer(url, url === health ? { payTo: policy.bond } : {}));
  await assert.rejects(preflightWatchedPolicy(policy, fetcher), /payto_changed/);
});

test('issuance refuses Unknown responses, wrong resources, account changes and invalid payment terms', async () => {
  for (const [response, reason] of [
    [() => new Response(null, { status: 400 }), 'unavailable'],
    [() => new Response(null, { status: 302, headers: { location: health } }), 'unavailable'],
    [() => offer('https://wrong.example/api/oracle'), 'malformed'],
    [(url: string) => offer(url, { amount: '9999' }), 'price_below_floor'],
    [(url: string) => offer(url, { asset: policy.bond }), 'option_not_to_account'],
  ] as const) {
    await assert.rejects(preflightWatchedPolicy(policy, fixture(manifest(), response).fetcher), new RegExp(reason));
  }
  await assert.rejects(preflightWatchedPolicy(policy, fixture(manifest([base], policy.bond)).fetcher), /manifest_account_changed/);
  await assert.rejects(preflightWatchedPolicy(policy, async () => { throw new Error('offline'); }), /manifest_unavailable/);
});

test('AGENT_URL must be listed; otherwise choose the canonical base or the first listed resource', () => {
  assert.equal(selectAgentEndpoint(fetchedManifest([health, base]), policy), base);
  assert.equal(selectAgentEndpoint(fetchedManifest([health]), policy), health);
  assert.equal(selectAgentEndpoint(fetchedManifest(), policy, health), health);
  assert.throws(() => selectAgentEndpoint(fetchedManifest([health]), policy, base), /manifest_endpoint_withdrawn/);
  assert.throws(() => selectAgentEndpoint(fetchedManifest([]), policy), /no paid endpoint/);
  assert.throws(() => selectAgentEndpoint(fetchedManifest(['https://other.example/api/oracle']), policy), /manifest HTTPS origin/);
});

test('preflight bypass requires both local environment and local chain', () => {
  assert.doesNotThrow(() => assertPreflightMode(false, 10143, 'testnet'));
  assert.doesNotThrow(() => assertPreflightMode(true, 31337, 'local'));
  for (const [chainId, environment] of [[10143, 'testnet'], [10143, 'local'], [31337, undefined]] as const)
    assert.throws(() => assertPreflightMode(true, chainId, environment), /only allowed for local tests/);
});
