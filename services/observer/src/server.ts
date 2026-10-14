import { createServer } from 'node:http';
import { Observer, loadRegistry } from './index.js';
import { storeFromEnv } from './store.js';
import { authorized } from './auth.js';
import type { Hex } from 'viem';

const { OBSERVER_REGISTRY, OBSERVER_PRIVATE_KEY, OBSERVER_API_TOKEN } = process.env;
if (
  !OBSERVER_REGISTRY ||
  !/^0x[0-9a-fA-F]{64}$/.test(OBSERVER_PRIVATE_KEY ?? '') ||
  !OBSERVER_API_TOKEN ||
  OBSERVER_API_TOKEN.length < 32
)
  throw new Error('Observer registry, signer and 32-character API token required');
const policies = await loadRegistry(OBSERVER_REGISTRY, process.env.BONDRAIL_ENV === 'local');
const store = storeFromEnv();
const observer = new Observer(
  policies,
  store,
  OBSERVER_PRIVATE_KEY as Hex,
  process.env.BONDRAIL_ENV === 'local',
);
const server = createServer(async (req, res) => {
  const reply = (status: number, data: unknown) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(data));
  };
  if (req.method === 'GET' && req.url === '/health') {
    try {
      await store.get('health');
      reply(200, {
        status: 'ready',
        signer: observer.signerAddress,
        watches: policies.length,
        trust: 'single immutable observer signer; CRE simulation is not DON consensus',
      });
    } catch {
      reply(503, { status: 'durable_store_unavailable' });
    }
    return;
  }
  if (req.method !== 'POST' || req.url !== '/observe') {
    reply(404, { error: 'not_found' });
    return;
  }
  if (!authorized(req.headers.authorization, OBSERVER_API_TOKEN)) {
    reply(401, { error: 'unauthorized' });
    return;
  }
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024) {
        reply(413, { error: 'too_large' });
        return;
      }
    }
    const d = JSON.parse(body) as Record<string, unknown>;
    if (
      Object.keys(d).some((k) => k !== 'watchId' && k !== 'epoch') ||
      typeof d.watchId !== 'string' ||
      typeof d.epoch !== 'number'
    ) {
      reply(400, { error: 'Only watchId and epoch accepted' });
      return;
    }
    reply(200, await observer.observe(d.watchId, d.epoch));
  } catch (e) {
    reply(409, {
      error: e instanceof Error ? e.message : 'observation_failed',
    });
  }
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.listen(Number(process.env.OBSERVER_PORT ?? 8787), process.env.OBSERVER_HOST ?? '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
