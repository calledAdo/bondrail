import test from 'node:test';
import assert from 'node:assert/strict';
import { collectOpsStatus, facilitatorHealthUrl, formatOpsStatus } from './ops-status.ts';

test('health URL follows the facilitator bind address unless explicitly overridden', () => {
  assert.equal(facilitatorHealthUrl({}), 'http://127.0.0.1:8789/health');
  assert.equal(facilitatorHealthUrl({ FACILITATOR_HOST: '172.18.0.1', FACILITATOR_PORT: '8788' }), 'http://172.18.0.1:8788/health');
  assert.equal(facilitatorHealthUrl({ FACILITATOR_HOST: '172.18.0.1' }), 'http://172.18.0.1:8789/health');
  assert.equal(facilitatorHealthUrl({ FACILITATOR_HOST: '::1', FACILITATOR_PORT: '9000' }), 'http://[::1]:9000/health');
  assert.equal(facilitatorHealthUrl({ FACILITATOR_HOST: '172.18.0.1', BONDRAIL_FACILITATOR_HEALTH_URL: 'https://health.example/health' }), 'https://health.example/health');
});

const now = Date.parse('2026-10-16T12:00:00.000Z');
const success = '2026-10-16T11:45:00.000Z';
const failure = '2026-10-16T11:30:00.000Z';
const healthy = { balanceNative: '4.5', settlementsRemaining: '100', lowBalance: false, blockedReason: null };
const health = (body: unknown = healthy, status = 200): typeof globalThis.fetch => async () => Response.json(body, { status });

function fixture({ successAt = success as string | null, failureAt = failure as string | null, enabled = 'enabled' } = {}) {
  return async (command: string, args: string[]): Promise<string> => {
    if (command === 'systemctl') return args[1].endsWith('.timer')
      ? `LoadState=loaded\nActiveState=active\nUnitFileState=${enabled}\nNextElapseUSecRealtime=Fri 2026-10-16 12:05:00 UTC\nLastTriggerUSec=Fri 2026-10-16 11:45:00 UTC\n`
      : 'LoadState=loaded\nActiveState=inactive\nResult=success\nExecMainStatus=0\n';
    assert.equal(command, 'journalctl');
    assert(args.includes('--lines=1')); // Bound history without parsing application logs.
    const id = args.find(arg => arg.startsWith('MESSAGE_ID='))!.slice('MESSAGE_ID='.length);
    const unit = args.find(arg => arg.startsWith('UNIT='))!.slice('UNIT='.length);
    const time = id === '39f53479d3a045ac8e11786248231fbf' ? successAt : failureAt;
    return time === null ? '' : JSON.stringify({ MESSAGE_ID: id, UNIT: unit,
      __REALTIME_TIMESTAMP: String(BigInt(Date.parse(time)) * 1000n), MESSAGE: 'Localized message ignored' }) + '\n';
  };
}

test('status keeps both failure and recovery history; inactive successful oneshots are healthy', async () => {
  const status = await collectOpsStatus({ run: fixture(), fetch: health(), now });
  assert.equal(status.schemaVersion, 1);
  assert.equal(status.ok, true);
  assert.equal(status.timers.length, 3);
  for (const timer of status.timers) {
    assert.equal(timer.lastSuccessAt, success);
    assert.equal(timer.lastFailureAt, failure);
    assert.equal(timer.ok, true);
  }
  assert.equal(status.facilitator.balanceNative, '4.5');
  assert.equal(status.facilitator.settlementsRemaining, '100');
  assert.match(formatOpsStatus(status), /balance 4.5 MON; settlements remaining 100/);
  assert.deepEqual(JSON.parse(JSON.stringify(status)), status);
});

test('latest failure, missing history, overdue success and disabled timers require attention', async () => {
  for (const options of [
    { failureAt: '2026-10-16T11:50:00.000Z' },
    { successAt: null, failureAt: null },
    { successAt: '2026-10-14T12:00:00.000Z' },
    { enabled: 'disabled' },
  ]) {
    const status = await collectOpsStatus({ run: fixture(options), fetch: health(), now });
    assert.equal(status.ok, false);
    assert(status.timers.every(timer => !timer.ok));
  }
});

test('systemd and journal read errors yield explicit partial status with health still available', async () => {
  const run = fixture();
  const status = await collectOpsStatus({ now, fetch: health(), run: async (command, args) => {
    if (command === 'journalctl' || args[1] === 'bondrail-worker.timer') throw new Error('permission denied');
    return run(command, args);
  } });
  assert.equal(status.ok, false);
  assert.equal(status.facilitator.ok, true);
  assert.equal(status.timers[1].timerState, null);
  for (const timer of status.timers) {
    assert.equal(timer.lastSuccessAt, null);
    assert.equal(timer.lastFailureAt, null);
    assert(timer.errors.some(error => error.includes('journal success: permission denied')));
  }
});

test('low funds, blocked writer, unavailable and malformed health never report healthy', async () => {
  for (const fetch of [
    health({ ...healthy, lowBalance: true, settlementsRemaining: '5' }),
    health({ ...healthy, blockedReason: 'wallet_nonce_blocked' }),
    health({ ...healthy, settlementsRemaining: '0' }),
    health({ ...healthy, settlementsRemaining: null }),
    health({ error: 'gas_health_unavailable' }, 503),
    health({ ok: true }), health(null),
    async () => { throw new Error('request to https://secret-provider.invalid/token failed'); },
  ]) {
    const status = await collectOpsStatus({ run: fixture(), fetch, now });
    assert.equal(status.ok, false);
    assert.equal(status.facilitator.ok, false);
    assert.doesNotMatch(JSON.stringify(status), /secret-provider/);
  }
});
