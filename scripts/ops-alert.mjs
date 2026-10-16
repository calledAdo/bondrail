import { execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);

export async function alertFailure(unit, {
  webhook = process.env.ALERT_WEBHOOK_URL,
  host = hostname(),
  now = () => new Date().toISOString(),
  log = console.log,
  fetch = globalThis.fetch,
  describe = async name => {
    const { stdout } = await exec('systemctl', ['show', name, '--property=Result,ExecMainCode,ExecMainStatus'],
      { timeout: 5000, maxBuffer: 16 * 1024 });
    return Object.fromEntries(stdout.trim().split('\n').map(line => line.split('=')));
  },
} = {}) {
  if (!/^bondrail-(covenant|worker|attester|observer|facilitator)\.service$/.test(unit)) {
    throw new Error('Expected a Bondrail application service name');
  }
  // Log first, even if systemctl or webhook delivery is unavailable.
  log(JSON.stringify({ event: 'bondrail_service_failed', unit, host, at: now() }));
  let details;
  try { details = await describe(unit); }
  catch { log(JSON.stringify({ event: 'bondrail_alert_status_unavailable', unit })); }
  const message = `Bondrail service failed: ${unit} on ${host}.`
    + (details ? ` Current result=${details.Result ?? 'unknown'}, exit=${details.ExecMainCode ?? '?'}/${details.ExecMainStatus ?? '?'}.` : '')
    + ` Inspect journalctl -u ${unit}.`;
  log(message);
  if (!webhook?.trim()) {
    log(JSON.stringify({ event: 'bondrail_alert_webhook_skipped', unit }));
    return;
  }
  try {
    const url = new URL(webhook);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid webhook protocol');
    const response = await fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      // Slack consumes text; Discord consumes content. Never forward journal/env contents.
      body: JSON.stringify({ text: message, content: message, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(5000), redirect: 'error',
    });
    await response.body?.cancel();
    if (!response.ok) throw new Error('Webhook returned non-2xx');
    log(JSON.stringify({ event: 'bondrail_alert_webhook_sent', unit }));
  } catch {
    // Webhook URLs contain secrets. Do not log fetch errors, response bodies, or the URL.
    log(JSON.stringify({ event: 'bondrail_alert_webhook_failed', unit }));
    throw new Error('Bondrail alert webhook delivery failed; inspect the local failure journal.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  alertFailure(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
