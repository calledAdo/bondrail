# October 2026 production naming migration

This is an **operator procedure, not an executed migration**. Operator context dated
2026-10-16: `bondrail.vercel.app` runs `main` with the former `10143-next.json`
contracts. The current identity is now `10143.json` (`deployment: main`). The judged
manifest is archived byte-for-byte at `archive/10143-slice-metropolis.json`.
The deleted Slice web/agent and server services must not be restored.

Keep the existing agent and facilitator hostnames, contract addresses, signer keys,
agent Redis data, Envio project **bondrail-next**, release branch **envio-next** and
GraphQL endpoint `https://indexer.dev.hyperindex.xyz/1ac5720/v1/graphql` unchanged.
The old Envio Slice project is retained. This procedure needs no Vercel, Envio,
npm, DNS or chain deployment action.

## Cutover model and limits

The facilitator has one signing/recovery writer. Do **not** start both old and new
facilitators, even on different ports: startup and the 15-second monitor can
recover pending transactions. Preserve all journals and namespaces. Pausing HTTP
alone does not stop the old writer; wait for its entire systemd cgroup to exit.

The temporary loopback gate in `ops/migration-gate.mjs` keeps the public listener
available, finishes forwarded requests, then queues new requests while the writer
changes names. Resume only after the replacement is healthy. It forwards each
request once, without retrying POSTs. No second funded key or nonce stream is needed.
The observer can overlap briefly because both instances use the **same** CAS store,
signer and frozen policy; the new instance listens on 8792 during migration.

Zero downtime here means no rejected requests during a successful bounded cutover;
requests can be delayed. The gate holds at most 256 requests for 30 seconds. First
rehearse the restart and rollback on a disposable local deployment, and verify that
the full drain/restart is shorter than **every** upstream/client timeout and the
remaining signed authorization lifetime (leave the protocol's six-second margin).
The facilitator's RPC/startup can exceed that budget during an outage. If those
conditions cannot be met, defer the cutover: unbounded zero downtime cannot be
promised for a single writer. Queue exhaustion/expiry explicitly returns 503.
Do not call a failed or timed-out rehearsal zero downtime.

The proxy commands below assume **Caddy at `/etc/caddy/Caddyfile`**. Confirm the
actual service/config before executing; an Nginx alternative is below. No server
inspection was performed for this task. Use a graceful reload, never a proxy restart.
Do not log payment signatures, bearer tokens, keys, or complete environment files.

## 1. Prepare and snapshot while the old services keep running

Run in a root shell on the existing host. The reviewed release commit must already
be present locally; set `BONDRAIL_RELEASE` to its full hash. All subsequent shell
blocks use this same shell. Do not use an unreviewed moving branch name.

```sh
sudo -i
set -eu
umask 077
BONDRAIL_RELEASE=<reviewed-full-commit-hash>
BONDRAIL_BACKUP=/var/backups/bondrail/2026-10-16
BONDRAIL_OLD_KEY_DIR=/root/.slice
BONDRAIL_OLD_KEY_PREFIX=next
# Match the actual old deployer override/fallback if this file is elsewhere.
BONDRAIL_OLD_DEPLOYER=/root/.slice/deployer.key

test ! -e "$BONDRAIL_BACKUP"
install -d -m 700 "$BONDRAIL_BACKUP"
cp -a /etc/bondrail-next*.env "$BONDRAIL_BACKUP/"
cp -a /etc/systemd/system/bondrail-next-* "$BONDRAIL_BACKUP/"
cp -a /etc/caddy/Caddyfile "$BONDRAIL_BACKUP/Caddyfile"
systemctl cat bondrail-next-observer.service bondrail-next-worker.service \
  bondrail-next-facilitator.service bondrail-next-covenant.service \
  bondrail-next-attester.service > "$BONDRAIL_BACKUP/effective-units.txt"
systemctl list-timers 'bondrail-next-*' > "$BONDRAIL_BACKUP/timers.txt"
git -C /opt/bondrail-next rev-parse HEAD > "$BONDRAIL_BACKUP/old-commit.txt"
```

Inspect the private backup locally to resolve actual `EnvironmentFile` ordering,
key locations, `.service.d/` drop-ins and each service's `BONDRAIL_DATA_DIR`. Do not
paste it into logs or tickets. In particular, the running host has these overrides:

| Old override | New override | Values to retain |
| --- | --- | --- |
| `/etc/bondrail-next-observer.env` | `/etc/bondrail-observer.env` | `BONDRAIL_ENV=local`, `BONDRAIL_STORE=local`, observer data directory |
| `/etc/bondrail-next-worker.env` | `/etc/bondrail-worker.env` | Same flags, worker journal/lease directory |
| `/etc/bondrail-next-facilitator.env` | `/etc/bondrail-facilitator.env` | Same flags, settlement journal directory |

`BONDRAIL_ENV=local` permits local storage; it does **not** change the configured
chain from 10143. Missing these files would select Redis from the common env or
fail startup. New units load each override *after* `/etc/bondrail.env`.

Ensure no `bondrail-*` units already occupy the destination names. Inspect
`systemctl show <unit> -p LoadState -p FragmentPath` for all new service/timer names;
resolve any stale retired unit before proceeding. Do not overwrite another service.

Stage a separate checkout with a shared data-directory alias. This leaves both
rollback code and live state available. The `.data` alias points to the exact same
inode tree, so no live journal is copied and no CAS locks can diverge.

```sh
test ! -e /opt/bondrail
install -d -m 755 /opt/bondrail
git -C /opt/bondrail-next archive "$BONDRAIL_RELEASE" | tar -x -C /opt/bondrail
ln -s /opt/bondrail-next/.data /opt/bondrail/.data
cd /opt/bondrail
pnpm install --frozen-lockfile
pnpm --filter @bondrail/cre compile
# Preserve operator CRE settings/secrets; do not replace them with examples.
cp -a /opt/bondrail-next/cre/project.yaml cre/project.yaml
cp -a /opt/bondrail-next/cre/bondrail-covenant/secrets.yaml cre/bondrail-covenant/secrets.yaml
```

If a data directory is outside the checkout, retain its absolute path. If old
`BONDRAIL_CONFIG_DIR`, `CRE_ENV_FILE`, WASM path or CRE target settings are overridden,
carry those settings forward and review them. Keep the prior checkout and all old
env files throughout rollback retention. **Do not delete `/opt/bondrail-next`: the
new `.data` alias still uses it.** Moving durable state later is a separate backup
and quiescence operation, not part of this zero-downtime rename.

Copy existing role keys into the new key root without generating replacements:

```sh
test ! -e /root/.bondrail
install -d -m 700 /root/.bondrail
cp -a "$BONDRAIL_OLD_KEY_DIR/$BONDRAIL_OLD_KEY_PREFIX/." /root/.bondrail/
install -m 600 "$BONDRAIL_OLD_DEPLOYER" /root/.bondrail/deployer.key
```

If `/root/.bondrail` already exists, compare public identities and select a separate
reviewed destination; do not merge or overwrite unrelated keys. Adapt the paths in
the next block accordingly. The private keys themselves must not be printed.

Transform copies of **all** old env files, retaining credentials and per-service
settings. This script does not source shell code. The old launcher unconditionally
used `bondrail-10143-next`; preserve that effective namespace, including for Redis.
Only configuration-file paths change from `10143-next` to `10143-main`, never journal
identities. Per-service data paths replace only the checkout prefix, whose `.data`
is the same tree. Existing service-specific files are mandatory for the three stores.

```sh
python3 - <<'PY'
from pathlib import Path
for service in ('observer', 'worker', 'facilitator'):
    assert Path(f'/etc/bondrail-next-{service}.env').is_file(), service
for source in Path('/etc').glob('bondrail-next*.env'):
    target = source.with_name(source.name.replace('bondrail-next', 'bondrail', 1))
    assert not target.exists(), target
    lines = []
    for line in source.read_text().splitlines():
        key, sep, value = line.partition('=')
        if sep and not key.lstrip().startswith('#'):
            value = value.replace('/opt/bondrail-next', '/opt/bondrail')
            value = value.replace('/etc/bondrail-next', '/etc/bondrail')
            if key in ('OBSERVER_REGISTRY', 'WORKER_TARGETS_FILE', 'BONDRAIL_CONFIG_DIR'):
                value = value.replace('/10143-next', '/10143-main')
            if key == 'BONDRAIL_DEPLOYMENT': value = 'main'
            if key == 'BONDRAIL_KEY_DIR': value = '/root/.bondrail'
            if key == 'BONDRAIL_KEY_PREFIX': value = ''
            if key == 'BONDRAIL_DEPLOYER_KEY_FILE': value = '/root/.bondrail/deployer.key'
            if key == 'BONDRAIL_STORE_NAMESPACE': value = 'bondrail-10143-next'
            line = key + '=' + value
        lines.append(line)
    target.write_text('\n'.join(lines) + '\n')
    target.chmod(0o600)
with Path('/etc/bondrail.env').open('a') as out:
    out.write('\nBONDRAIL_DEPLOYMENT=main\nBONDRAIL_CHAIN_ID=10143\n'
              'BONDRAIL_KEY_DIR=/root/.bondrail\nBONDRAIL_KEY_PREFIX=\n'
              'BONDRAIL_DEPLOYER_KEY_FILE=/root/.bondrail/deployer.key\n'
              'BONDRAIL_STORE_NAMESPACE=bondrail-10143-next\n'
              'CRE_ENV_FILE=/etc/bondrail.env\n'
              'OBSERVER_REGISTRY=/opt/bondrail/.data/deployments/10143-main/registry.json\n'
              'WORKER_TARGETS_FILE=/opt/bondrail/.data/deployments/10143-main/targets.json\n')
with Path('/etc/bondrail-observer.env').open('a') as out:
    out.write('\nOBSERVER_PORT=8792\n')
PY
```

Compare any old unit drop-ins with the new units. Port/memory limits may be retained;
translate path/ExecStart/EnvironmentFile overrides deliberately. Do not copy a stale
`ExecStart` or old env-file override back over the new units. Check that every data
path resolves to its old inode (`stat -Lc '%d:%i' <old-dir> <new-dir>`), not an empty
replacement. Preserve the observer token and each per-service storage setting.

Verify keys and generate only public configuration:

```sh
cd /opt/bondrail
node --input-type=module <<'JS'
import fs from 'node:fs';
import { privateKeyToAccount } from 'viem/accounts';
const d = JSON.parse(fs.readFileSync('docs/deployments/10143.json'));
for (const role of ['deployer', 'observer', 'worker', 'facilitator', 'attester']) {
  let key = fs.readFileSync(`/root/.bondrail/${role}.key`, 'utf8').trim();
  if (!key.startsWith('0x')) key = `0x${key}`;
  if (privateKeyToAccount(key).address.toLowerCase() !== d.roles[role].toLowerCase())
    throw new Error(`Role mismatch: ${role}`);
}
console.log('All service/deployer identities match the current manifest');
JS
BONDRAIL_DEPLOYMENT=main BONDRAIL_CONFIG_DIR=/opt/bondrail/.data/deployments/10143-main \
  OBSERVER_URL=http://127.0.0.1:8792/observe \
  pnpm tsx demo/scripts/write-watch-config.ts --force
install -m 644 ops/bondrail-*.service ops/bondrail-*.timer /etc/systemd/system/
systemd-analyze verify /etc/systemd/system/bondrail-*.service /etc/systemd/system/bondrail-*.timer
systemctl daemon-reload
```

Check effective new files privately (`systemctl cat` redirected to the backup),
including `/etc/bondrail-{observer,worker,facilitator}.env`. Do not start the new
facilitator yet. Leave the production Envio release branch/config untouched.

## 2. Drain scheduled work and bring up the observer

Stop **only timers** first; let their already-started jobs finish naturally. Wait for
all three old oneshots to become inactive and check `Result=success` and
`ExecMainStatus=0`. Investigate failed or uncertain transactions before continuing.
Do not kill an in-flight CRE/worker/attester broadcast.

```sh
systemctl stop bondrail-next-covenant.timer bondrail-next-worker.timer bondrail-next-attester.timer
while systemctl is-active --quiet bondrail-next-covenant.service || \
      systemctl is-active --quiet bondrail-next-worker.service || \
      systemctl is-active --quiet bondrail-next-attester.service; do sleep 1; done
systemctl show bondrail-next-covenant.service bondrail-next-worker.service \
  bondrail-next-attester.service -p Result -p ExecMainStatus
systemctl start bondrail-observer.service
curl --fail --max-time 5 http://127.0.0.1:8792/health
```

Require the manifest observer signer and the same watch count as port 8790. The new
CRE config now uses 8792. Keep both observers until old report jobs have completed.
Take a consistent filesystem snapshot/backup using the host's existing storage
backup process; retain all three journals and attestation evidence. Do not restore
an older journal over newer state during rollback.

## 3. Put the temporary gate in front of the existing writer

```sh
install -d -m 700 /run/bondrail-migration
systemd-run --unit=bondrail-migration-gate --property=WorkingDirectory=/opt/bondrail \
  /usr/bin/env node /opt/bondrail/ops/migration-gate.mjs
curl --fail --max-time 5 http://127.0.0.1:8791/supported
curl --fail --unix-socket /run/bondrail-migration/control.sock http://localhost/status
```

The public facilitator currently proxies to `127.0.0.1:8789`. In its **existing
site block only**, replace that upstream with `127.0.0.1:8791`; retain hostname,
TLS, headers, rate limits and other sites. Keep the observer private. Confirm the
proxy response timeout exceeds the gate's 30 seconds plus normal settlement time.
No public route should expose the gate's Unix control socket.

```sh
sudoedit /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
curl --fail --max-time 10 https://bondrail-next.64-227-40-35.sslip.io/supported
```

For Nginx, instead back up the actual site file, change that site's
`proxy_pass http://127.0.0.1:8789` to port 8791, validate with `nginx -t`, then
`systemctl reload nginx`. Wait for old workers/connections to finish before the
next step. Never enable `proxy_next_upstream non_idempotent` to retry payments.
For either proxy, wait for all pre-reload requests to the old direct upstream to
finish; `ss -tnp '( dport = :8789 )'` plus proxy request metrics should show only
the gate's upstream requests. A graceful reload alone does not prove this drain.

## 4. Hand off the facilitator, then resume requests

Keep a second root shell ready to execute rollback. The following queue window
must fit the rehearsed client deadline; if draining is slow, **resume the old
writer immediately** and defer. Once stopped, never run old and new writers together.
The health check must show the expected wallet, chain 10143, factory and asset;
`blockedReason` must be null and `inFlightNonce` null before beginning this cutover.

```sh
curl --fail --max-time 5 http://127.0.0.1:8789/health
curl --fail -X POST --unix-socket /run/bondrail-migration/control.sock http://localhost/pause
# Poll this until active == 0 (queued may grow). Abort/resume if budget is insufficient.
curl --fail --unix-socket /run/bondrail-migration/control.sock http://localhost/status
```

After `active == 0`, stop the old service, verify it has no remaining processes,
and start the replacement on the **same port 8789**. Use the host's cgroup path
from `ControlGroup` to verify `cgroup.procs` is empty; `MainPID=0` alone does not
prove that a child writer has stopped. If stopping hangs, resume the old setup or
use rollback only after it has fully stopped; never force a second writer to start.

```sh
systemctl stop bondrail-next-facilitator.service
systemctl show bondrail-next-facilitator.service -p ActiveState -p MainPID -p ControlGroup
systemctl start bondrail-facilitator.service
# Retry readiness within the measured deadline; do not wait out the queue's timeout.
curl --fail --max-time 3 http://127.0.0.1:8789/health
curl --fail --max-time 3 http://127.0.0.1:8789/supported
# Verify health identities and blockedReason before releasing the queue.
curl --fail -X POST --unix-socket /run/bondrail-migration/control.sock http://localhost/resume
```

Watch gate status until `queued == 0`. Examine the facilitator journal/health and
normal receipts. Do not generate a new payment solely to test branding or retry
an ambiguous signed payment with a new nonce. The retained journal handles replay
of the original request. Use the recovery steps in [RUNBOOK.md](RUNBOOK.md).

## 5. Activate the canonical timers and remove the gate

```sh
systemctl enable bondrail-observer.service bondrail-facilitator.service
systemctl enable --now bondrail-covenant.timer bondrail-worker.timer bondrail-attester.timer
systemctl disable bondrail-next-covenant.timer bondrail-next-worker.timer bondrail-next-attester.timer
systemctl disable --now bondrail-next-observer.service
systemctl disable bondrail-next-facilitator.service
systemctl list-timers 'bondrail-*'
systemctl is-active bondrail-observer.service bondrail-facilitator.service
curl --fail --max-time 5 http://127.0.0.1:8792/health
```

Persistent timers may fire immediately; old oneshots must already be finished.
Check the first new covenant/worker/attester run's result and the expected report/
attestation evidence. This is continuation of existing operations, not a new
contract deployment. The observer remains on **8792** in its override and generated
CRE config; do not change only one of those two settings.

Change the public proxy upstream back to `127.0.0.1:8789`, validate, and gracefully
reload as in step 3. Wait for old proxy workers/connections and the gate's
`active == 0 && queued == 0` before stopping it:

```sh
curl --fail --max-time 10 https://bondrail-next.64-227-40-35.sslip.io/health
curl --fail --unix-socket /run/bondrail-migration/control.sock http://localhost/status
systemctl stop bondrail-migration-gate.service
```

Retain the backup, old env files, keys, unit files (disabled), and old checkout/data
through the rollback window. New unit working directories and configured paths are
`/opt/bondrail` and `/etc/bondrail*.env`; the shared `.data` alias and preserved
`bondrail-10143-next` namespace intentionally retain durable state identity.

## Rollback

Before step 4 stops the old writer: `POST /resume` on the control socket, leave old
facilitator running, stop the new observer, restart the old timers. Restore the
proxy's original upstream with a validated graceful reload and drain/stop the gate.

After the new writer starts: route through the gate again if it was removed, pause
it, wait for `active == 0`, then **stop the new facilitator completely** before
starting the old one. Use the same underlying journals, including new entries; do
not restore the snapshot or replace the namespace. The old code is the immediate
pre-rename Bondrail revision and uses the same journal format, not the judged tag.
Within the same measured queue deadline:

```sh
systemctl stop bondrail-covenant.timer bondrail-worker.timer bondrail-attester.timer
# Wait for new oneshots to finish, exactly as in step 2, before starting old ones.
curl --fail -X POST --unix-socket /run/bondrail-migration/control.sock http://localhost/pause
curl --fail --unix-socket /run/bondrail-migration/control.sock http://localhost/status
# Continue only once active == 0 and the remaining deadline covers the rollback.
systemctl stop bondrail-facilitator.service
systemctl show bondrail-facilitator.service -p ActiveState -p MainPID -p ControlGroup
# Require the cgroup empty before starting the old writer.
systemctl start bondrail-next-facilitator.service
curl --fail --max-time 3 http://127.0.0.1:8789/health
curl --fail -X POST --unix-socket /run/bondrail-migration/control.sock http://localhost/resume
systemctl enable --now bondrail-next-observer.service
curl --fail --max-time 5 http://127.0.0.1:8790/health
systemctl enable --now bondrail-next-covenant.timer bondrail-next-worker.timer bondrail-next-attester.timer
systemctl enable bondrail-next-facilitator.service
systemctl disable bondrail-covenant.timer bondrail-worker.timer bondrail-attester.timer
systemctl disable --now bondrail-observer.service
systemctl disable bondrail-facilitator.service
```

Restore the original public proxy upstream, validate and gracefully reload, then
drain/stop the gate as in step 5. Old observer/config paths remain intact and still
refer to port 8790. If a journal is unresolved, reconcile its nonce/hash using the
runbook before accepting new payments; rollback never deletes locks or guesses a
replacement nonce. If an outage exhausts the queue deadline, preserve original
signed requests and report the interruption rather than claiming zero downtime.

`ops/covenant-server` and `.github/workflows/covenant.yml` were removed because they
served the retired Slice configuration: `/opt/slice`, legacy static policy/observer,
and no selected-manifest launcher. The current `bondrail-covenant` timer and
`scripts/report-covenant.ts` replace that path. CI has no reporting credentials.
