import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceGuard, SliceGuardError } from './x402-guard';

const ACCOUNT = '0x3333333333333333333333333333333333333333';
const OTHER = '0x4444444444444444444444444444444444444444';
const USDC = '0x534b2f3A21130d7a60830c2Df862319e593943A3';
const offer = (...payTos: string[]) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: 'https://agent.example/api/oracle' },
      accepts: payTos.map((payTo) => ({ scheme: 'exact', network: 'eip155:10143', asset: USDC, payTo, amount: '10000' })),
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

test('a pinned buyer refuses a host that swapped both manifest and offer to another real Bondrail account', async () => {
  const swapped = server([OTHER], { version: 1, chainId: 10143, account: OTHER, endpoints: [] });
  const guard = sliceGuard(swapped, { verifyAccount: async () => true, pin: { 'https://agent.example': { account: ACCOUNT } } });
  await assert.rejects(guard('https://agent.example/api/oracle'), /pinned account/);
  // Unpinned, the same host passes: the manifest alone can't protect a financed claim.
  const r = await sliceGuard(swapped, { verifyAccount: async () => true })('https://agent.example/api/oracle');
  assert.equal(r.status, 402);
});

test('a pinned buyer pays the pinned account and refuses another chain or asset', async () => {
  const pin = (p: object) => ({ pin: { 'https://agent.example': { account: ACCOUNT, ...p } as never } });
  const ok = await sliceGuard(server([ACCOUNT]), pin({ chainId: 10143, asset: USDC }))('https://agent.example/api/oracle');
  assert.equal(ok.status, 402);
  await assert.rejects(sliceGuard(server([ACCOUNT]), pin({ chainId: 143 }))('https://agent.example/api/oracle'), /pinned chain/);
  await assert.rejects(
    sliceGuard(server([ACCOUNT]), pin({ asset: '0x5555555555555555555555555555555555555555' }))('https://agent.example/api/oracle'),
    /pinned asset/,
  );
});

test('an offer served from a redirect to another origin is refused', async () => {
  const redirected = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/.well-known/slice.json')) return Response.json({ version: 1, chainId: 10143, account: ACCOUNT, endpoints: [] });
    const r = new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': offer(ACCOUNT) } });
    Object.defineProperty(r, 'redirected', { value: true });
    Object.defineProperty(r, 'url', { value: 'https://elsewhere.example/pay' });
    return r;
  }) as typeof fetch;
  await assert.rejects(sliceGuard(redirected)('https://agent.example/api/oracle'), /redirected/);
});
