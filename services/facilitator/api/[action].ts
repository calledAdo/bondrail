// Optional Vercel preview facade. All transactions stay with one persistent next gas-wallet process.
import type { IncomingMessage, ServerResponse } from 'node:http';
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  const action = new URL(req.url ?? '/', 'http://localhost').pathname.split('/').pop();
  const expected = ['supported', 'health'].includes(action ?? '') ? 'GET' : ['verify', 'settle'].includes(action ?? '') ? 'POST' : undefined;
  if (!expected || req.method !== expected) { res.writeHead(404).end(); return; }
  try {
    const origin = new URL(process.env.FACILITATOR_UPSTREAM_URL ?? '');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/') throw new Error('Invalid origin');
    const chunks: Buffer[] = [];
    let size = 0;
    if (req.body !== undefined) {
      const parsed = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      size = parsed.length;
      if (size > 16384) { res.writeHead(413).end(); return; }
      chunks.push(parsed);
    } else for await (const chunk of req) {
      size += chunk.length;
      if (size > 16384) { res.writeHead(413).end(); return; }
      chunks.push(Buffer.from(chunk));
    }
    const upstream = await fetch(new URL(action!, origin), { method: expected,
      headers: { 'content-type': 'application/json' }, body: expected === 'POST' ? Buffer.concat(chunks) : undefined,
      signal: AbortSignal.timeout(90_000), redirect: 'error' });
    res.writeHead(upstream.status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(await upstream.text());
  } catch { res.writeHead(502, { 'content-type': 'application/json' }).end('{"error":"facilitator_unavailable"}'); }
}
