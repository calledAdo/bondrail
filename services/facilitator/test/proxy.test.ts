import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import handler from '../api/[action].ts';

test('preview facade pins the persistent writer and forwards payment bytes without a key', async () => {
  const original = globalThis.fetch;
  const prior = process.env.FACILITATOR_UPSTREAM_URL;
  const seen: { url: string; body: string; method?: string }[] = [];
  process.env.FACILITATOR_UPSTREAM_URL = 'https://next-writer.example/';
  globalThis.fetch = (async (url, options) => {
    seen.push({ url: String(url), body: options?.body?.toString() ?? '', method: options?.method });
    return Response.json({ success: true });
  }) as typeof fetch;
  const server = createServer((req, res) => {
    if (req.url?.endsWith('?parsed=1')) Object.assign(req, { body: { paymentPayload: {} } });
    void handler(req, res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    for (const action of ['verify', 'settle']) {
      const response = await original(`${origin}/api/${action}?url=https://wrong.example`, { method: 'POST', body: '{"paymentPayload":{}}' });
      assert.equal(response.status, 200);
      assert.deepEqual(seen.at(-1), { url: `https://next-writer.example/${action}`, body: '{"paymentPayload":{}}', method: 'POST' });
    }
    assert.equal((await original(`${origin}/api/verify?parsed=1`, { method: 'POST' })).status, 200);
    assert.equal(seen.at(-1)?.body, '{"paymentPayload":{}}');
    assert.equal((await original(`${origin}/supported`)).status, 200);
    assert.equal((await original(`${origin}/health`)).status, 200);
    assert.deepEqual(seen.at(-1), { url: 'https://next-writer.example/health', body: '', method: 'GET' });
    const count = seen.length;
    assert.equal((await original(`${origin}/settle`)).status, 404);
    assert.equal((await original(`${origin}/unknown`)).status, 404);
    assert.equal((await original(`${origin}/settle`, { method: 'POST', body: 'x'.repeat(16385) })).status, 413);
    assert.equal(seen.length, count);
    process.env.FACILITATOR_UPSTREAM_URL = 'http://wrong.example/';
    assert.equal((await original(`${origin}/supported`)).status, 502);
    assert.equal(seen.length, count);
  } finally {
    globalThis.fetch = original;
    if (prior === undefined) delete process.env.FACILITATOR_UPSTREAM_URL; else process.env.FACILITATOR_UPSTREAM_URL = prior;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
