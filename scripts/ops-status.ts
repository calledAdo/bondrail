// Read-only host status. No deployment keys, application env file, or RPC client required.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

type Command = (command: string, args: string[]) => Promise<string>;
const exec = promisify(execFile);
const runCommand: Command = async (command, args) => {
  try {
    const { stdout, stderr } = await exec(command, args, {
      timeout: 5000, maxBuffer: 512 * 1024, encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C', SYSTEMD_COLORS: '0' },
    });
    if (stderr.trim()) throw new Error('Incomplete output'); // Includes journal permission warnings.
    return stdout;
  } catch {
    throw new Error(`${command} unavailable, timed out, or returned incomplete output; check host permissions`);
  }
};

// systemd sd-messages.h: successful oneshot start emits "Finished" (UNIT_STARTED).
// These IDs are stable across locales; application log text is deliberately not parsed.
const STARTED = '39f53479d3a045ac8e11786248231fbf';
const FAILED = 'be02cf6855d2428ba40df7e9d022f03d';
const jobs = [
  { name: 'covenant', intervalSeconds: 1800 },
  { name: 'worker', intervalSeconds: 600 },
  { name: 'attester', intervalSeconds: 21600 },
] as const;

function properties(output: string): Record<string, string> {
  return Object.fromEntries(output.trim().split('\n').filter(Boolean).map(line => {
    const split = line.indexOf('=');
    if (split < 1) throw new Error('Malformed systemctl properties');
    return [line.slice(0, split), line.slice(split + 1)];
  }));
}

function journalTime(output: string, unit: string, messageId: string): string | null {
  if (!output.trim()) return null;
  const entry = JSON.parse(output.trim());
  if (entry.UNIT !== unit || entry.MESSAGE_ID !== messageId || !/^\d+$/.test(entry.__REALTIME_TIMESTAMP)) {
    throw new Error('Malformed journal entry');
  }
  return new Date(Number(BigInt(entry.__REALTIME_TIMESTAMP) / 1000n)).toISOString();
}

async function timerStatus(job: typeof jobs[number], run: Command, now: number) {
  const service = `bondrail-${job.name}.service`;
  const timer = `bondrail-${job.name}.timer`;
  const errors: string[] = [];
  async function read<T>(label: string, args: string[], parse: (out: string) => T): Promise<T | null> {
    const command = label.startsWith('journal') ? 'journalctl' : 'systemctl';
    try { return parse(await run(command, args)); }
    catch (error) { errors.push(`${label}: ${error instanceof Error ? error.message : 'unavailable'}`); return null; }
  }
  const journalArgs = (id: string) => ['--quiet', '--no-pager', '--output=json', '--lines=1', `UNIT=${service}`, `MESSAGE_ID=${id}`];
  const [schedule, state, lastSuccessAt, lastFailureAt] = await Promise.all([
    read('timer', ['show', timer, '--property=LoadState,ActiveState,UnitFileState,NextElapseUSecRealtime,LastTriggerUSec'], properties),
    read('service', ['show', service, '--property=LoadState,ActiveState,Result,ExecMainStatus'], properties),
    read('journal success', journalArgs(STARTED), out => journalTime(out, service, STARTED)),
    read('journal failure', journalArgs(FAILED), out => journalTime(out, service, FAILED)),
  ]);
  // Two missed periods plus the units' 600-second execution budget is overdue.
  const stale = lastSuccessAt === null || now - Date.parse(lastSuccessAt) > (2 * job.intervalSeconds + 600) * 1000;
  const failedSinceSuccess = lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt >= lastSuccessAt);
  return {
    timer, service,
    timerState: schedule?.ActiveState ?? null, enabled: schedule?.UnitFileState ?? null,
    nextRunAt: schedule?.NextElapseUSecRealtime || null, lastTriggeredAt: schedule?.LastTriggerUSec || null,
    serviceState: state?.ActiveState ?? null, result: state?.Result ?? null, exitStatus: state?.ExecMainStatus ?? null,
    lastSuccessAt, lastFailureAt, stale,
    ok: errors.length === 0 && schedule?.LoadState === 'loaded' && state?.LoadState === 'loaded'
      && schedule?.ActiveState === 'active' && ['enabled', 'enabled-runtime'].includes(schedule?.UnitFileState ?? '')
      && state?.ActiveState !== 'failed' && state?.Result === 'success' && !stale && !failedSinceSuccess,
    errors,
  };
}

async function facilitatorStatus(url: string, fetch: typeof globalThis.fetch) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${response.status}`); }
    const data = await response.json() as Record<string, unknown>;
    if (!data || typeof data.balanceNative !== 'string' || !/^\d+(\.\d+)?$/.test(data.balanceNative)
      || !(data.settlementsRemaining === null || (typeof data.settlementsRemaining === 'string' && /^\d+$/.test(data.settlementsRemaining)))
      || typeof data.lowBalance !== 'boolean' || !(data.blockedReason === null || typeof data.blockedReason === 'string')) {
      throw new Error('Invalid health response');
    }
    return {
      ok: !data.lowBalance && data.blockedReason === null && data.settlementsRemaining !== null && BigInt(data.settlementsRemaining as string) > 0n,
      balanceNative: data.balanceNative, settlementsRemaining: data.settlementsRemaining,
      lowBalance: data.lowBalance, blockedReason: data.blockedReason,
      error: null,
    };
  } catch (error) {
    // Never expose URL credentials or a provider's response body to a dashboard.
    const message = error instanceof Error && /^(HTTP \d{3}|Invalid health response)$/.test(error.message)
      ? error.message : 'Health unavailable or timed out';
    return { ok: false, balanceNative: null, settlementsRemaining: null, lowBalance: null, blockedReason: null, error: message };
  }
}

export async function collectOpsStatus({
  run = runCommand, fetch = globalThis.fetch, now = Date.now(),
  healthUrl = process.env.BONDRAIL_FACILITATOR_HEALTH_URL ?? 'http://127.0.0.1:8789/health',
}: { run?: Command; fetch?: typeof globalThis.fetch; now?: number; healthUrl?: string } = {}) {
  const [timers, facilitator] = await Promise.all([
    Promise.all(jobs.map(job => timerStatus(job, run, now))), facilitatorStatus(healthUrl, fetch),
  ]);
  return { schemaVersion: 1, generatedAt: new Date(now).toISOString(),
    ok: timers.every(timer => timer.ok) && facilitator.ok, historySource: 'retained system journal', timers, facilitator };
}

export function formatOpsStatus(status: Awaited<ReturnType<typeof collectOpsStatus>>): string {
  const lines = [`Bondrail ${status.ok ? 'OK' : 'NEEDS ATTENTION'} — ${status.generatedAt}`];
  for (const timer of status.timers) {
    lines.push(`${timer.timer}: ${timer.ok ? 'OK' : 'ATTENTION'} (${timer.timerState ?? 'unknown'}, ${timer.enabled ?? 'unknown'}; service ${timer.serviceState ?? 'unknown'}, result ${timer.result ?? 'unknown'}, exit ${timer.exitStatus ?? '?'})`,
      `  last success: ${timer.lastSuccessAt ?? 'unknown'}; last failure: ${timer.lastFailureAt ?? 'unknown'}; overdue/unknown: ${timer.stale}`,
      `  last trigger: ${timer.lastTriggeredAt ?? 'unknown'}; next: ${timer.nextRunAt ?? 'unknown'}`,
      ...timer.errors.map(error => `  ${error}`));
  }
  const f = status.facilitator;
  lines.push(`Facilitator: ${f.ok ? 'OK' : 'ATTENTION'}; balance ${f.balanceNative ?? 'unknown'} MON; settlements remaining ${f.settlementsRemaining ?? 'unknown'}; low balance ${f.lowBalance ?? 'unknown'}; blocked ${f.blockedReason ?? 'none'}`);
  if (f.error) lines.push(`  ${f.error}`);
  lines.push('History is limited to retained system journal entries; unknown does not mean success.');
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node --import tsx scripts/ops-status.ts [--json]\nReads local systemd/journal and BONDRAIL_FACILITATOR_HEALTH_URL (default http://127.0.0.1:8789/health). Exit 1 means attention or incomplete status.');
  } else if (args.some(arg => arg !== '--json')) {
    console.error('Usage: node --import tsx scripts/ops-status.ts [--json]'); process.exitCode = 2;
  } else {
    collectOpsStatus().then(status => {
      console.log(args.includes('--json') ? JSON.stringify(status, null, 2) : formatOpsStatus(status));
      process.exitCode = status.ok ? 0 : 1;
    }).catch(() => { console.error('Unable to collect Bondrail operations status'); process.exitCode = 1; });
  }
}
