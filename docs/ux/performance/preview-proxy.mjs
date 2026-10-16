// Local measurement adapter: use the live public profile registry without copying production secrets.
// All /api/registry traffic is GET-only; other requests go to the local Next production server.
import http from 'node:http';
const port = Number(process.env.PERF_PROXY_PORT || 3215);
const target = process.env.PERF_APP_ORIGIN || 'http://127.0.0.1:3213';
http.createServer(async (req, res) => {
  try {
    const registry = req.url.startsWith('/api/registry?');
    if (registry && req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    const response = await fetch(`${registry ? 'https://bondrail.vercel.app' : target}${req.url}`, {
      method: req.method, signal: AbortSignal.timeout(30000),
      headers: registry ? { accept: req.headers.accept || '*/*' } : Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host', 'connection', 'accept-encoding', 'content-length'].includes(k))),
    });
    res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([k]) => !['content-encoding','transfer-encoding','content-length'].includes(k))));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) { res.writeHead(502); res.end(String(e)); }
}).listen(port, '127.0.0.1', () => console.log(`Read-only preview proxy ${port} → ${target}`));
