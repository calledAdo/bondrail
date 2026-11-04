import test from 'node:test';
import assert from 'node:assert/strict';
import { chain, walletConfig } from './wallet';

test('web RPC transport sends independent JSON-RPC requests, not batch arrays', async () => {
  const bodies: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; jsonrpc: string } | Array<{ id: number; jsonrpc: string }>;
    bodies.push(body);
    const response = (request: { id: number; jsonrpc: string }) => ({ jsonrpc: request.jsonrpc, id: request.id, result: '0x279f' });
    return Response.json(Array.isArray(body) ? body.map(response) : response(body));
  };

  try {
    const client = walletConfig.getClient({ chainId: chain.id });
    await Promise.all([
      client.request({ method: 'eth_chainId' }),
      client.request({ method: 'eth_blockNumber' }),
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(bodies.length, 2);
  assert.ok(bodies.every(body => !Array.isArray(body)));
  const batch = walletConfig.getClient({ chainId: chain.id }).batch;
  const multicall = batch && typeof batch === 'object' ? batch.multicall : undefined;
  assert.equal(multicall && typeof multicall === 'object' ? multicall.wait : undefined, 32);
  assert.equal(chain.contracts?.multicall3?.address.toLowerCase(), '0xca11bde05977b3631167028862be2a173976ca11');
});
