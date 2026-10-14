import { createServer } from 'node:http';
import type { VerifyRequest } from '@x402/core/types';
import type { createFacilitator } from './index.js';

export function facilitatorServer(facilitator: ReturnType<typeof createFacilitator>) {
  const server = createServer(async (req, res) => {
    const reply = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    if (req.method === 'GET' && req.url === '/supported') {
      reply(200, facilitator.supported());
      return;
    }
    if (req.method !== 'POST' || !['/verify', '/settle'].includes(req.url ?? '')) {
      reply(404, { error: 'not_found' });
      return;
    }
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 16_384) { reply(413, { error: 'too_large' }); return; }
        chunks.push(Buffer.from(chunk));
      }
      const body = JSON.parse(Buffer.concat(chunks).toString()) as VerifyRequest;
      if (!body || body.x402Version !== 2 || !body.paymentPayload || !body.paymentRequirements) {
        reply(400, { error: 'invalid_request' });
        return;
      }
      reply(200, await facilitator[req.url === '/verify' ? 'verify' : 'settle'](body.paymentPayload, body.paymentRequirements));
    } catch {
      reply(400, { error: 'invalid_request' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
