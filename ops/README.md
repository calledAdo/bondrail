# Bondrail services

These units run the deployment selected by `BONDRAIL_DEPLOYMENT` (default `main`).
Production uses `docs/deployments/10143.json`, `/opt/bondrail`, and
`/etc/bondrail.env`. The web and agent remain on Vercel; the production Envio
project is `bondrail-next`, released from **`envio-next`**.

For the existing host, follow [the October migration](../docs/deployments/MIGRATION-2026-10.md).
Do not install these over running services without that drain/rollback procedure.
For ongoing checks and configuration, see [the runbook](../docs/deployments/RUNBOOK.md).

Each service loads `/etc/bondrail.env`, then optional `/etc/bondrail-<service>.env`.
The observer, worker and facilitator example overrides select a local durable
store. Their `BONDRAIL_ENV=local` is required by the store implementation; the
chain remains 10143. Use one writer and retain the same underlying state directory.
A Redis deployment instead needs its existing URL, token and namespace preserved.
The launcher honors an explicit `BONDRAIL_STORE_NAMESPACE` across deployment renames.

| Unit | Schedule / behavior |
| --- | --- |
| `bondrail-observer.service` | Continuous, loopback 8790; signs observations |
| `bondrail-facilitator.service` | Continuous, loopback 8789; one settlement/recovery writer |
| `bondrail-covenant.timer` | Every 30 minutes; CRE simulation with broadcast |
| `bondrail-worker.timer` | Every 10 minutes at :05; one maintenance cycle |
| `bondrail-attester.timer` | Every six hours at :15; registry relay |

`migration-gate.mjs` is a temporary loopback proxy for the single-writer cutover.
It drains requests already forwarded, queues new requests for at most 30 seconds,
and never retries an upstream POST. Its controls are on a mode-0600 Unix socket.
It is not part of the steady-state service stack. Queue overflow/expiry fails
explicitly; the migration guide defines the latency and rollback prerequisites.

The removed `ops/covenant-server` and manual `covenant.yml` workflow used the
retired Slice server layout, static legacy policies and observer port 8787. They
were not generic CI or the current production reporter. The canonical units and
manifest-scoped reporter replace them; `ci.yml` remains secret-free validation.
