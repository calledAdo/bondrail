import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceGuard, SliceGuardError } from './x402-guard';

const ACCOUNT = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
const offer = (...payTos: string[]) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: 'https://agent.example/api/oracle' },
      accepts: payTos.map((payTo) => ({ scheme: 'exact', network: 'eip155:10143', payTo, amount: '10000' })),
    }),
  ).toString('base64');

function server(payTos: string[], manifest: unknown = { version: 1, chainId: 10143, account: ACCOUNT, endpoints: [] }) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/.well-known/slice.json'))
      return manifest ? Response.json(manifest) : new Response('not found', { status: 404 });
    return new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': offer(...payTos) } });
  }) as typeof fetch;
}

test('an offer paying the published account passes through to the x402 client', async () => {
  const r = await sliceGuard(server([ACCOUNT]))('https://agent.example/api/oracle');
  assert.equal(r.status, 402);
});

test('an offer paying anyone else, even as a second option, is refused before signing', async () => {
  await assert.rejects(sliceGuard(server([OTHER]))('https://agent.example/api/oracle'), SliceGuardError);
  await assert.rejects(sliceGuard(server([ACCOUNT, OTHER]))('https://agent.example/api/oracle'), SliceGuardError);
});

test('hosts without a manifest, or whose account fails the on-chain check, are refused by default', async () => {
  await assert.rejects(sliceGuard(server([ACCOUNT], null))('https://agent.example/api/oracle'), SliceGuardError);
  const r = await sliceGuard(server([ACCOUNT], null), { allowUnlisted: true })('https://agent.example/api/oracle');
  assert.equal(r.status, 402);
  const notOnChain = sliceGuard(server([ACCOUNT]), { verifyAccount: async () => false });
  await assert.rejects(notOnChain('https://agent.example/api/oracle'), SliceGuardError);
});
