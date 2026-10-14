import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { keccak256, recoverTypedDataAddress, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { creditAttestationDomain, creditAttestationTypes, creditLine } from '@bondrail/sdk/credit';
import { buildAttestation, canonicalJson, readIndexedInputs, type CreditInputs } from '../src/attestation.ts';
const fixture = (): CreditInputs => JSON.parse(readFileSync(new URL('./fixtures/mixed.json', import.meta.url), 'utf8'));
const options = { issuedAt: 1_800_000_000, expiresAt: 1_800_086_400, nonce: 42n };

test('fixture matches web attribution and SDK creditLine in asset base units', () => {
  const { attestation: a, evidence } = buildAttestation(fixture(), options);
  assert.equal(a.attributedRevenue, 800_000_000n);
  assert.equal(a.excludedRevenue, 200_000_000n);
  assert.equal(a.distinctPayers, 3n);
  assert.equal(a.topPayerShareBps, 3750);
  const expected = creditLine({ revenuePerDay: 800 / 7, ageDays: 40, uniquePayers: 3, topPayerShare: 0.375 }).maxRaise * 1e6;
  assert.ok(Math.abs(Number(a.creditLine) - expected) < 1);
  assert.equal(a.evidenceHash, keccak256(stringToHex(evidence)));
  assert.equal(evidence, canonicalJson(JSON.parse(evidence)));
});

test('canonical evidence ignores input/key order and changes on changed evidence', () => {
  const first = fixture();
  const second = fixture(); second.payers.reverse(); second.daily.reverse();
  assert.equal(buildAttestation(first, options).evidence, buildAttestation(second, options).evidence);
  assert.equal(canonicalJson({ b: 1, a: { d: 'x', c: 2 } }), '{"a":{"c":2,"d":"x"},"b":1}');
  second.payers[0].reasons.push('new evidence');
  assert.notEqual(buildAttestation(first, options).attestation.evidenceHash, buildAttestation(second, options).attestation.evidenceHash);
});

test('signed payload recovers disclosed signer and is bound to registry domain', async () => {
  const signer = privateKeyToAccount(`0x${'01'.repeat(32)}`);
  const inputs = fixture();
  const message = buildAttestation(inputs, options).attestation;
  const typed = { domain: creditAttestationDomain(inputs.chainId, inputs.registry), types: creditAttestationTypes,
    primaryType: 'CreditAttestation' as const, message };
  const signature = await signer.signTypedData(typed);
  assert.equal(await recoverTypedDataAddress({ ...typed, signature }), signer.address);
  assert.notEqual(await recoverTypedDataAddress({ ...typed, domain: { ...typed.domain, chainId: 1 }, signature }), signer.address);
});

test('empty and wholly excluded histories have no credit line', () => {
  const f = fixture(); f.payers.forEach(p => p.related = true); f.daily[0].verified = '0';
  const a = buildAttestation(f, options).attestation;
  assert.equal(a.attributedRevenue, 0n); assert.equal(a.creditLine, 0n); assert.equal(a.topPayerShareBps, 0);
  f.payers = []; f.daily = []; f.grossRevenue = '0'; f.firstRevenueAt = null;
  assert.equal(buildAttestation(f, options).attestation.distinctPayers, 0n);
});

test('rejects unreconciled, duplicate, foreign, invalid or future inputs', () => {
  for (const mutate of [
    (f: CreditInputs) => { f.grossRevenue = '1'; },
    (f: CreditInputs) => { f.payers.push(f.payers[0]); },
    (f: CreditInputs) => { f.payers[0].account = f.issuer; },
    (f: CreditInputs) => { f.payers[0].amount = '-1'; },
    (f: CreditInputs) => { f.daily.push(f.daily[0]); },
    (f: CreditInputs) => { f.daily[0].day++; },
    (f: CreditInputs) => { f.firstRevenueAt = options.issuedAt + 1; },
  ]) {
    const f = fixture(); mutate(f); assert.throws(() => buildAttestation(f, options));
  }
  assert.throws(() => canonicalJson({ invalid: Number.NaN }));
});

function indexerFetch(f: CreditInputs, mutate = false): typeof fetch {
  let accounts = 0;
  return (async (_url: unknown, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body));
    const data = query.includes('query Account') ? { Issuer: [{ id: f.account, chainId: f.chainId, issuer: f.issuer,
      asset: f.asset, firstRevenueAt: String(f.firstRevenueAt), grossRevenue: mutate && accounts++ ? '1' : f.grossRevenue }] }
      : query.includes('query Payers') ? { PayerTotal: [...f.payers].sort((a,b) => a.id.localeCompare(b.id)) }
      : { DailyRevenue: f.daily };
    return new Response(JSON.stringify({ data }));
  }) as typeof fetch;
}

test('indexer snapshot queries account and complete aggregate sets', async () => {
  const f = fixture();
  const result = await readIndexedInputs({ url: 'https://indexer.invalid/graphql', fetch: indexerFetch(f) }, f);
  assert.equal(buildAttestation(result, options).attestation.attributedRevenue, 800_000_000n);
});

test('indexer mutation or repeated pagination fails closed', async () => {
  const f = fixture();
  await assert.rejects(readIndexedInputs({ url: 'https://indexer.invalid/graphql', fetch: indexerFetch(f, true) }, f), /changed/);
  const base = indexerFetch(f);
  const repeated = (async (url: unknown, init: RequestInit) => {
    if (String(init.body).includes('query Payers')) return new Response(JSON.stringify({ data: { PayerTotal: Array(1000).fill(f.payers[0]) } }));
    return base(url as string, init);
  }) as typeof fetch;
  await assert.rejects(readIndexedInputs({ url: 'https://indexer.invalid/graphql', fetch: repeated }, f), /pagination/);
});

test('payer pagination reads beyond first page without dropping small payers', async () => {
  const f = fixture();
  let pages = 0;
  const base = indexerFetch(f);
  const paged = (async (url: unknown, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body));
    if (!query.includes('query Payers')) return base(url as string, init);
    pages++;
    const rows = variables.cursor ? [] : Array.from({ length: 1000 }, (_, i) => ({ ...f.payers[0], id: String(i).padStart(4, '0') }));
    return new Response(JSON.stringify({ data: { PayerTotal: rows } }));
  }) as typeof fetch;
  const result = await readIndexedInputs({ url: 'https://indexer.invalid/graphql', fetch: paged }, f);
  assert.equal(result.payers.length, 1000); assert.equal(pages, 4);
});
