import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGwei } from 'viem';
import { defaultGasPolicy as policy, feesForBlock, gasLimit, gasPolicyFromEnv } from '../src/gas.js';
import { lowBalanceHook } from '../src/telemetry.js';

test('gas limit rounds up a 15% margin and refuses an estimate above the cap', () => {
  assert.equal(gasLimit(190_000n, policy), 218_500n);
  assert.equal(gasLimit(120_000n, policy), 138_000n);
  assert.equal(gasLimit(21_001n, policy), 24_152n);
  assert.equal(gasLimit(371_475n, policy), 427_197n); // observed first/cold settlement
  assert.equal(gasLimit(434_782n, policy), 500_000n);
  assert.throws(() => gasLimit(434_783n, policy), /gas_limit_exceeded/);
  assert.throws(() => gasLimit(0n, policy), /invalid_gas_estimate/);
});

test('fees use latest base plus a modest tip, bounded headroom and an absolute env cap', () => {
  assert.deepEqual(feesForBlock(parseGwei('100'), policy), {
    maxFeePerGas: parseGwei('112'), maxPriorityFeePerGas: parseGwei('2'),
  });
  assert.equal(feesForBlock(parseGwei('140'), policy).maxFeePerGas, parseGwei('150'));
  assert.equal(feesForBlock(parseGwei('148'), policy).maxFeePerGas, parseGwei('150'));
  assert.throws(() => feesForBlock(parseGwei('149'), policy), /gas_fee_cap_exceeded/);
  assert.throws(() => feesForBlock(null, policy), /base_fee_unavailable/);
  const replacement = feesForBlock(parseGwei('100'), policy, feesForBlock(parseGwei('100'), policy));
  assert.equal(replacement.maxFeePerGas, parseGwei('126') + 1n);
  assert.equal(replacement.maxPriorityFeePerGas, parseGwei('2.25') + 1n);
  assert.throws(() => feesForBlock(parseGwei('100'), policy, {
    maxFeePerGas: parseGwei('150'), maxPriorityFeePerGas: parseGwei('2'),
  }), /gas_fee_cap_exceeded/);
});

test('gas env settings reject invalid, rounded-away or unsafe limits', () => {
  assert.deepEqual(gasPolicyFromEnv({}), policy);
  assert.equal(gasPolicyFromEnv({ FACILITATOR_MAX_FEE_GWEI: '125.000000001' }).maxFeePerGas, 125_000_000_001n);
  for (const env of [
    { FACILITATOR_MAX_FEE_GWEI: '-1' }, { FACILITATOR_MAX_FEE_GWEI: '0.0000000001' },
    { FACILITATOR_GAS_MARGIN_BPS: '9999' }, { FACILITATOR_MAX_GAS: '1000001' },
    { FACILITATOR_LOW_BALANCE_SETTLEMENTS: 'NaN' }, { FACILITATOR_STUCK_SECONDS: '0' },
  ]) assert.throws(() => gasPolicyFromEnv(env));
});

test('low-balance hook posts bounded JSON to an operator HTTPS endpoint and surfaces delivery failure', async () => {
  assert.equal(lowBalanceHook(), undefined);
  assert.throws(() => lowBalanceHook('http://alerts.example'), /Invalid gas alert URL/);
  const event = { event: 'facilitator_low_gas_balance', wallet: '0x1111111111111111111111111111111111111111' as const };
  let received: unknown;
  const hook = lowBalanceHook('https://alerts.example/hook', async (_url, options) => {
    received = JSON.parse(String(options?.body));
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    return Response.json({ ok: true });
  });
  await hook!(event);
  assert.deepEqual(received, event);
  await assert.rejects(lowBalanceHook('https://alerts.example', async () => new Response('', { status: 503 }))!(event),
    /gas_alert_delivery_failed/);
});
