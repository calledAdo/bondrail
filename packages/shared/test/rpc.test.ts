import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createPublicClient } from 'viem';
import { createRpcTransport, rpcUrlsFromEnv, type RpcTransportOptions } from '../src/rpc';

type Call = { url: string; method: string; params: unknown; time: number };
function fixture(name: string, respond: (call: Call, n: number) => Response | Promise<Response>, options: RpcTransportOptions = {}) {
  const calls: Call[] = [];
  const urls = [`https://${name}-primary.example/`, `https://${name}-fallback.example/`];
  const transport = createRpcTransport(urls, {
    retryDelay: 20, ...options,
    fetchFn: async (url, init) => {
      const body = JSON.parse(String(init?.body));
      assert.equal(Array.isArray(body), false, 'never JSON-RPC batch');
      const call = { url: String(url), method: body.method, params: body.params, time: performance.now() };
      calls.push(call);
      return respond(call, calls.length);
    },
  });
  return { calls, urls, transport, client: createPublicClient({ transport }) };
}
const ok = () => Response.json({ jsonrpc: '2.0', id: 1, result: '0x1' });

test('ordered URL configuration prefers plural, then singular, then service/default URL', () => {
  assert.deepEqual(rpcUrlsFromEnv('https://legacy', { BONDRAIL_RPC_URLS: ' https://a, https://b,https://a ', BONDRAIL_RPC_URL: 'https://old' }), ['https://a', 'https://b']);
  assert.deepEqual(rpcUrlsFromEnv('https://legacy', { BONDRAIL_RPC_URL: 'https://old' }), ['https://old']);
  assert.deepEqual(rpcUrlsFromEnv('https://legacy', {}), ['https://legacy']);
  assert.throws(() => createRpcTransport([]), /URL/);
  for (const rps of [0, -1, NaN]) assert.throws(() => createRpcTransport(['https://a'], { rps }), /RPS/);
  assert.throws(() => createRpcTransport(['https://a'], { concurrency: 1.5 }), /concurrency/);
});

test('default six-RPS bucket spaces concurrent calls across clients and URLs without batching', async () => {
  const a = fixture('pace-a', ok);
  const b = fixture('pace-b', ok);
  await Promise.all(Array.from({ length: 7 }, (_, i) => (i % 2 ? a : b).client.request({ method: 'eth_chainId' })));
  const calls = [...a.calls, ...b.calls].sort((a, b) => a.time - b.time);
  for (let i = 1; i < calls.length; i++) assert.ok(calls[i].time - calls[i - 1].time >= 150);
  assert.ok(calls[6].time - calls[0].time >= 990);
});

test('default concurrency two holds queued requests until an HTTP slot is free', async () => {
  const releases: Array<() => void> = [];
  const f = fixture('concurrency', async () => {
    await new Promise<void>(resolve => releases.push(resolve));
    return ok();
  });
  const requests = Array.from({ length: 4 }, () => f.client.request({ method: 'eth_chainId' }));
  await delay(600);
  assert.equal(f.calls.length, 2);
  releases.shift()!();
  await delay(220);
  assert.equal(f.calls.length, 3);
  releases.shift()!();
  await delay(220);
  assert.equal(f.calls.length, 4);
  releases.forEach(release => release());
  await Promise.all(requests);
});

test('HTTP 429 retains status even with opaque JSON-RPC error and retries with jitter', async () => {
  const f = fixture('429', (_, n) => n === 1
    ? Response.json({ error: { code: -32000, message: 'busy' } }, { status: 429 }) : ok(), { retryDelay: 800 });
  assert.equal(await f.client.getChainId(), 1);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].url, f.calls[1].url);
  assert.ok(f.calls[1].time - f.calls[0].time >= 390);
});

test('rate messages retry a bounded number of times, then fail over in order', async () => {
  for (const message of ['requests limited to 15/sec', 'RATE exceeded']) {
    const f = fixture(`rate-${message.length}`, call => call.url.includes('primary')
      ? Response.json({ error: { code: -32000, message } }) : ok());
    assert.equal(await f.client.getChainId(), 1);
    assert.deepEqual(f.calls.map(c => c.url), [f.urls[0], f.urls[0], f.urls[0], f.urls[1]]);
  }
});

test('exhausted providers stop; ordinary RPC reverts never retry or fail over', async () => {
  const f = fixture('exhausted', () => new Response('requests limited', { status: 429 }), { retryCount: 1 });
  await assert.rejects(f.client.getChainId());
  assert.equal(f.calls.length, 4);
  const revert = fixture('revert', () => Response.json({ error: { code: 3, message: 'execution reverted' } }));
  await assert.rejects(revert.client.getChainId());
  assert.equal(revert.calls.length, 1);
  const badRequest = fixture('revert-400', () => Response.json({ error: { code: 3, message: 'execution reverted' } }, { status: 400 }));
  await assert.rejects(badRequest.client.getChainId(), (error: unknown) => (error as { code: number }).code === 3);
  assert.equal(badRequest.calls.length, 1);
});

test('403 Restricted permanently skips only that method, including other clients', async () => {
  const f = fixture('restricted', call => call.url.includes('primary') && call.method === 'eth_blockNumber'
    ? new Response('Restricted JSON RPC method', { status: 403 }) : ok());
  assert.equal(await f.client.getBlockNumber({ cacheTime: 0 }), 1n);
  const other = createPublicClient({ transport: f.transport });
  assert.equal(await other.getBlockNumber({ cacheTime: 0 }), 1n);
  assert.equal(await f.client.getChainId(), 1);
  assert.deepEqual(f.calls.map(c => c.url), [f.urls[0], f.urls[1], f.urls[1], f.urls[0]]);
  const separate = fixture('restricted', ok);
  await separate.client.getBlockNumber({ cacheTime: 0 });
  assert.deepEqual(separate.calls.map(c => c.url), [f.urls[1]]);
});

test('ambiguous raw transaction retries send identical bytes, including failover', async () => {
  const f = fixture('broadcast', call => call.url.includes('primary')
    ? new Response('unavailable', { status: 503 }) : ok(), { retryCount: 0 });
  await f.client.request({ method: 'eth_sendRawTransaction', params: ['0x1234'] });
  assert.deepEqual(f.calls.map(c => c.params), [['0x1234'], ['0x1234']]);
});

test('connection failures fail over and a queued caller can abort without sending', async () => {
  const f = fixture('offline', call => {
    if (call.url.includes('primary')) throw new TypeError('fetch failed');
    return ok();
  }, { retryCount: 0 });
  assert.equal(await f.client.getChainId(), 1);
  assert.equal(f.calls.length, 2);
  const controller = new AbortController();
  const request = f.client.request({ method: 'eth_chainId' }, { signal: controller.signal });
  controller.abort();
  await assert.rejects(request);
  assert.equal(f.calls.length, 2);
});

test('configured lower process budget applies across previously constructed transports', async () => {
  const earlier = fixture('earlier', ok);
  fixture('lower', ok, { rps: 2 });
  await Promise.all(Array.from({ length: 3 }, () => earlier.client.request({ method: 'eth_chainId' })));
  for (let i = 1; i < earlier.calls.length; i++) assert.ok(earlier.calls[i].time - earlier.calls[i - 1].time >= 480);
});

test('a failed in-flight request applies cooldown before admitting queued callers', async () => {
  let failedAt = 0;
  const f = fixture('queued-cooldown', async (_, n) => {
    if (n === 1) {
      await delay(600); // A token has refilled by the time the HTTP slot is released.
      failedAt = performance.now();
      return new Response('requests limited', { status: 429 });
    }
    return ok();
  }, { concurrency: 1, retryDelay: 1200 });
  await Promise.all([f.client.request({ method: 'eth_chainId' }), f.client.request({ method: 'eth_chainId' })]);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls[1].time - failedAt >= 590);
});
