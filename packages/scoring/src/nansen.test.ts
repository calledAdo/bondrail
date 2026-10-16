import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NansenClient } from './nansen.ts';
const address = '0x1111111111111111111111111111111111111111';
test('testnet never leaks into a mainnet provider lookup', async () => {
  const client = new NansenClient({
    apiKey: 'test',
    fetch: async () => {
      throw new Error('must not call');
    },
  });
  const r = await client.inspect('labels', address, 10143);
  assert.equal(r.status, 'unavailable');
});
test('empty response is no-labels, not clean; bounded cache/request count', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: 1_800_000_000_000 });
  let calls = 0;
  const client = new NansenClient({
    apiKey: 'test',
    maxRequests: 1,
    fetch: async (_url, options) => {
      calls++;
      assert.equal(JSON.parse(String(options?.body)).wallet_address, address);
      return new Response(JSON.stringify({ data: [], pagination: { is_last_page: false } }), { status: 200 });
    },
  });
  const r = await client.inspect('related-wallets', address, 143);
  assert.equal(r.status, 'no_labels');
  assert.equal(r.truncated, true);
  assert.equal(await client.inspect('related-wallets', address, 143), r);
  assert.equal(calls, 1);
  assert.equal((await client.inspect('labels', address, 143)).status, 'unavailable');
});
