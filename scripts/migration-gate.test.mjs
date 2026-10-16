import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { migrationGate } from '../ops/migration-gate.mjs';

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

test('migration gate drains an in-flight write and forwards queued POST bytes once after resume', async t => {
  const bodies = [];
  let release;
  let received;
  const firstRequest = new Promise(resolve => { received = resolve; });
  const upstream = http.createServer(async (req, res) => {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    bodies.push(Buffer.concat(parts).toString());
    if (bodies.length === 1) {
      await new Promise(resolve => { release = resolve; received(); });
    }
    res.end('settled');
  });
  await listen(upstream);
  const gate = migrationGate({ upstreamPort: upstream.address().port });
  const proxyURL = await listen(gate.proxy);
  const controlURL = await listen(gate.control);
  t.after(() => { for (const server of [gate.proxy, gate.control, upstream]) { server.closeAllConnections(); server.close(); } });
  const command = async name => (await fetch(`${controlURL}/${name}`, { method: 'POST' })).json();
  const first = fetch(`${proxyURL}/settle`, { method: 'POST', body: 'original signed authorization' });
  await firstRequest;
  assert.deepEqual(await command('pause'), { paused: true, active: 1, queued: 0 });
  const second = fetch(`${proxyURL}/settle`, { method: 'POST', body: 'queued signed authorization' });
  // Observe a state transition using event-loop turns, with only the test runner's failure deadline.
  while (gate.status().queued !== 1) await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(bodies, ['original signed authorization']);
  release();
  assert.equal(await (await first).text(), 'settled');
  assert.deepEqual(gate.status(), { paused: true, active: 0, queued: 1 });
  await command('resume');
  assert.equal(await (await second).text(), 'settled');
  assert.deepEqual(bodies, ['original signed authorization', 'queued signed authorization']);
  assert.deepEqual(gate.status(), { paused: false, active: 0, queued: 0 });
});

test('migration gate never retries an ambiguous upstream POST failure', async t => {
  let calls = 0;
  const upstream = http.createServer(req => { calls++; req.socket.destroy(); });
  await listen(upstream);
  const gate = migrationGate({ upstreamPort: upstream.address().port });
  const url = await listen(gate.proxy);
  t.after(() => { for (const server of [gate.proxy, upstream]) { server.closeAllConnections(); server.close(); } });
  const response = await fetch(`${url}/settle`, { method: 'POST', body: 'signed once' });
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
  assert.equal(gate.status().active, 0);
});
