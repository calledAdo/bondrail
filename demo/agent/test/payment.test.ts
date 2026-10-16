import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStore } from '@bondrail/observer/store';
import { decodeBase64Json } from '@bondrail/observer/protocol';
import { handlePaidRequest, requirements, resourceURL, type PaymentBackend } from '../src/lib/payment';
import { updateConfig, getConfig, type AgentEnvironment, type AgentConfig } from '../src/lib/config';
const env: AgentEnvironment = {
  chainId: 10143,
  asset: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
  publicURL: 'https://agent.example',
  facilitatorURL: 'https://facilitator.example',
  modelBaseURL: 'https://api.groq.com/openai/v1',
  model: 'llama-3.1-8b-instant',
  apiKey: 'test-only',
};
const config: AgentConfig = {
  revision: 0,
  payTo: '0x1111111111111111111111111111111111111111',
  updatedAt: '2026-01-01',
  audit: [],
};
const payer = '0x2222222222222222222222222222222222222222';
function header(question: string | null = 'hello') {
  return Buffer.from(
    JSON.stringify({
      x402Version: 2,
      resource: { url: resourceURL(env, question) },
      accepted: requirements(env, config),
      payload: {
        signature: `0x${'44'.repeat(65)}`,
        authorization: {
          from: payer,
          to: config.payTo,
          value: '10000',
          validAfter: '0',
          validBefore: '9999999999',
          nonce: `0x${'55'.repeat(32)}`,
        },
      },
    }),
  ).toString('base64');
}
const backend = (
  counters: { verify: number; answer: number; settle: number },
  failSettle = false,
): PaymentBackend => ({
  verify: async () => {
    counters.verify++;
    return { isValid: true, payer };
  },
  answer: async () => {
    counters.answer++;
    return 'Real backend substituted by deterministic test double';
  },
  settle: async () => {
    counters.settle++;
    if (failSettle) throw new Error('timeout');
    return {
      success: true,
      payer,
      transaction: `0x${'66'.repeat(32)}`,
      network: 'eip155:10143',
    };
  },
});
async function withStore(fn: (s: LocalStore) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'bondrail-payment-'));
  try {
    await fn(new LocalStore(dir));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
test('unpaid probes skip model and verification, reflect current runtime payTo', async () =>
  withStore(async (s) => {
    const counters = { verify: 0, answer: 0, settle: 0 },
      b = backend(counters);
    const one = await handlePaidRequest('hello', null, env, config, s, b);
    assert.equal(one.status, 402);
    const changed = {
      ...config,
      payTo: '0x3333333333333333333333333333333333333333' as const,
    };
    const two = await handlePaidRequest('hello', null, env, changed, s, b);
    const challenge = decodeBase64Json(two.headers.get('PAYMENT-REQUIRED')!) as {
      accepts: { payTo: string }[];
    };
    assert.equal(challenge.accepts[0]!.payTo, changed.payTo);
    assert.deepEqual(counters, { verify: 0, answer: 0, settle: 0 });
  }));
test('replay returns cached answer and authorization cannot purchase different request', async () =>
  withStore(async (s) => {
    const counters = { verify: 0, answer: 0, settle: 0 },
      b = backend(counters),
      h = header();
    const first = await handlePaidRequest('hello', h, env, config, s, b),
      again = await handlePaidRequest('hello', h, env, config, s, b);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), await again.json());
    assert.equal(counters.answer, 1);
    assert.equal(counters.settle, 1);
    assert.equal((await handlePaidRequest('different', header('different'), env, config, s, b)).status, 409);
  }));
test('paid base resource answers health once and remains distinct from the explicit health resource', async () =>
  withStore(async (s) => {
    const counters = { verify: 0, answer: 0, settle: 0 };
    const b = backend(counters);
    const questions: string[] = [];
    const answer = b.answer;
    b.answer = async (question) => { questions.push(question); return answer(question); };
    const first = await handlePaidRequest(null, header(null), env, config, s, b);
    const replay = await handlePaidRequest(null, header(null), env, config, s, b);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), await replay.json());
    assert.deepEqual(questions, ['health']);
    assert.equal(counters.settle, 1);
    assert.equal((await handlePaidRequest('health', header('health'), env, config, s, b)).status, 409);
  }));
test('concurrent authorization use elects one paid/model operation', async () =>
  withStore(async (s) => {
    const counters = { verify: 0, answer: 0, settle: 0 },
      b = backend(counters);
    const results = await Promise.all([
      handlePaidRequest('hello', header(), env, config, s, b),
      handlePaidRequest('hello', header(), env, config, s, b),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    assert.equal(counters.answer, 1);
    assert.equal(counters.settle, 1);
  }));
test('ambiguous settlement never retries charge or model; missing credentials fail before verification', async () =>
  withStore(async (s) => {
    const counters = { verify: 0, answer: 0, settle: 0 },
      b = backend(counters, true);
    assert.equal(
      (await handlePaidRequest('hello', header(), { ...env, apiKey: undefined }, config, s, b)).status,
      503,
    );
    assert.equal(counters.verify, 0);
    assert.equal((await handlePaidRequest('hello', header(), env, config, s, b)).status, 202);
    assert.equal((await handlePaidRequest('hello', header(), env, config, s, b)).status, 202);
    assert.equal(counters.answer, 1);
    assert.equal(counters.settle, 1);
  }));
test('durable admin mutation requires matching revision and keeps history', async () =>
  withStore(async (s) => {
    process.env.AGENT_INITIAL_PAY_TO = config.payTo;
    const initial = await getConfig(s);
    const next = await updateConfig(s, initial.revision, '0x3333333333333333333333333333333333333333');
    assert.equal(next.revision, 1);
    assert.equal(next.audit.length, 2);
    await assert.rejects(updateConfig(s, 0, config.payTo));
    assert.equal((await getConfig(s)).payTo, next.payTo);
  }));

test('funding refusal is an uncharged retryable 503; concurrent same-request retries reuse the cached answer', async () =>
  withStore(async s => {
    const counters = { verify: 0, answer: 0, settle: 0 };
    const b = backend(counters);
    const settle = b.settle;
    b.settle = async () => ({ success: false, payer, transaction: '', network: 'eip155:10143',
      errorReason: 'insufficient_gas_funds' });
    const first = await handlePaidRequest('hello', header(), env, config, s, b);
    assert.equal(first.status, 503);
    const body = await first.json();
    assert.equal(body.error, 'insufficient_gas_funds');
    assert.equal(body.charged, false);
    assert.equal(body.retryable, true);
    assert.equal((await handlePaidRequest('different', header('different'), env, config, s, b)).status, 409);
    b.settle = settle;
    const retries = await Promise.all([
      handlePaidRequest('hello', header(), env, config, s, b),
      handlePaidRequest('hello', header(), env, config, s, b),
    ]);
    assert.ok(retries.some(r => r.status === 200));
    assert.deepEqual(counters, { verify: 1, answer: 1, settle: 1 });
    assert.equal((await handlePaidRequest('hello', header(), env, config, s, b)).status, 200);
  }));

test('a funding error carrying a transaction hash remains ambiguous and never claims no charge', async () =>
  withStore(async s => {
    const counters = { verify: 0, answer: 0, settle: 0 };
    const b = backend(counters);
    b.settle = async () => {
      counters.settle++;
      return { success: false, payer, transaction: `0x${'66'.repeat(32)}`, network: 'eip155:10143',
        errorReason: 'insufficient_gas_funds' };
    };
    const response = await handlePaidRequest('hello', header(), env, config, s, b);
    assert.equal(response.status, 202);
    assert.equal((await response.json()).charged, undefined);
    assert.equal((await handlePaidRequest('hello', header(), env, config, s, b)).status, 202);
    assert.equal(counters.settle, 1);
  }));
