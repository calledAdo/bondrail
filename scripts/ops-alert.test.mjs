import test from 'node:test';
import assert from 'node:assert/strict';
import { alertFailure } from './ops-alert.mjs';

const unit = 'bondrail-covenant.service';
const context = { host: 'test-host', now: () => '2026-10-16T12:00:00.000Z',
  describe: async () => ({ Result: 'exit-code', ExecMainCode: '1', ExecMainStatus: '1' }) };

test('failure is logged even without systemctl or a configured webhook', async () => {
  const logs = [];
  await alertFailure(unit, { ...context, webhook: '', log: line => logs.push(line),
    describe: async () => { throw new Error('systemctl unavailable'); },
    fetch: async () => assert.fail('must skip unset webhook'),
  });
  assert.equal(JSON.parse(logs[0]).event, 'bondrail_service_failed');
  assert.match(logs.join('\n'), /bondrail_alert_status_unavailable/);
  assert.match(logs.join('\n'), /bondrail_alert_webhook_skipped/);
  assert.match(logs.join('\n'), /journalctl -u bondrail-covenant.service/);
});

test('Slack/Discord payload contains failure identity without journal or webhook secrets', async () => {
  const logs = [];
  let sent = 0;
  await alertFailure(unit, { ...context, webhook: 'https://alerts.invalid/secret-token', log: line => logs.push(line),
    fetch: async (url, options) => {
      sent++;
      assert.equal(url.href, 'https://alerts.invalid/secret-token');
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'error');
      assert(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.equal(body.text, body.content);
      assert.match(body.text, /bondrail-covenant.service on test-host.*result=exit-code/);
      assert.deepEqual(body.allowed_mentions, { parse: [] });
      return new Response(null, { status: 204 });
    },
  });
  assert.equal(sent, 1);
  assert.match(logs.join('\n'), /bondrail_alert_webhook_sent/);
  assert.doesNotMatch(logs.join('\n'), /secret-token/);
});

test('webhook rejection or network failure stays visible and never leaks the URL/error body', async () => {
  for (const fetch of [async () => new Response('secret-body', { status: 429 }),
    async () => { throw new Error('https://alerts.invalid/secret-token'); }]) {
    const logs = [];
    await assert.rejects(alertFailure(unit, { ...context, webhook: 'https://alerts.invalid/secret-token',
      log: line => logs.push(line), fetch }), /webhook delivery failed/);
    assert.equal(JSON.parse(logs[0]).event, 'bondrail_service_failed');
    assert.match(logs.join('\n'), /bondrail_alert_webhook_failed/);
    assert.doesNotMatch(logs.join('\n'), /secret-token|secret-body/);
  }
});
