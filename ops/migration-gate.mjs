// Temporary loopback HTTP gate for a single-writer service rename. No POST retries.
// Run only during the operator procedure in docs/deployments/MIGRATION-2026-10.md.
import http from 'node:http';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export function migrationGate({ upstreamPort = 8789, queueTimeoutMs = 30_000, maxQueued = 256 } = {}) {
  let paused = false;
  let active = 0;
  const pending = new Set();
  const status = () => ({ paused, active, queued: pending.size });
  const reply = (res, code, value) => {
    if (res.destroyed) return;
    res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  const proxy = http.createServer(async (req, res) => {
    if (!['/health', '/supported', '/verify', '/settle'].includes(req.url) || !['GET', 'POST'].includes(req.method)) {
      reply(res, 404, { error: 'not_found' });
      return;
    }
    // Bound buffered payment bodies and never log their contents or authorization headers.
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) { reply(res, 413, { error: 'too_large' }); return; }
        chunks.push(chunk);
      }
    } catch { return; }
    if (res.destroyed) return;
    const body = Buffer.concat(chunks);
    const forward = () => {
      active++;
      let finished = false;
      const finish = () => { if (!finished) { finished = true; active--; } };
      const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}`, connection: 'close', 'content-length': body.length };
      delete headers['transfer-encoding'];
      const upstream = http.request({ host: '127.0.0.1', port: upstreamPort, method: req.method, path: req.url, headers }, response => {
        if (!res.destroyed) res.writeHead(response.statusCode, response.headers);
        response.on('data', chunk => { if (!res.destroyed) res.write(chunk); });
        response.on('end', () => { if (!res.destroyed) res.end(); finish(); });
        response.on('error', () => { res.destroy(); finish(); });
      });
      // A disconnected caller does not end the drain accounting for an upstream write.
      upstream.on('error', () => { reply(res, 502, { error: 'upstream_unavailable' }); finish(); });
      upstream.end(body);
    };
    if (!paused) { forward(); return; }
    if (pending.size >= maxQueued) { reply(res, 503, { error: 'migration_queue_full' }); return; }
    const entry = { resume: () => { remove(); if (!res.destroyed) forward(); } };
    const remove = () => { clearTimeout(timer); pending.delete(entry); res.off('close', remove); };
    const timer = setTimeout(() => { remove(); reply(res, 503, { error: 'migration_queue_timeout' }); }, queueTimeoutMs);
    pending.add(entry);
    res.once('close', remove);
  });
  proxy.requestTimeout = 15_000;
  proxy.headersTimeout = 10_000;
  // Control is a root-owned Unix socket, never part of the public proxy route.
  const control = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/pause') paused = true;
    else if (req.method === 'POST' && req.url === '/resume') {
      paused = false;
      for (const entry of [...pending]) entry.resume();
    } else if (req.method !== 'GET' || req.url !== '/status') { reply(res, 404, { error: 'not_found' }); return; }
    reply(res, 200, status());
  });
  return { proxy, control, status };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const socket = process.env.BONDRAIL_GATE_SOCKET ?? '/run/bondrail-migration/control.sock';
  const port = Number(process.env.BONDRAIL_GATE_PORT ?? 8791);
  const upstreamPort = Number(process.env.BONDRAIL_GATE_UPSTREAM_PORT ?? 8789);
  process.umask(0o077);
  const { proxy, control } = migrationGate({ upstreamPort });
  control.listen(socket, () => fs.chmodSync(socket, 0o600));
  proxy.listen(port, '127.0.0.1', () => console.log(`Migration gate listening on 127.0.0.1:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { proxy.close(); control.close(); });
}
