# Bondrail production operations

Operator state recorded 2026-10-16: https://bondrail.vercel.app serves `main`
using `10143.json`. The contracts are on **Monad testnet, chain 10143**.
The live agent is https://bondrail-next-agent.vercel.app and facilitator is
https://bondrail-next.64-227-40-35.sslip.io. These retained hostnames are intentional.
The production Envio project is **bondrail-next**, release branch **envio-next**,
endpoint https://indexer.dev.hyperindex.xyz/1ac5720/v1/graphql. Keep that branch
and cloud resource as-is; generating config on a development checkout does not deploy it.
The old Envio Slice project is retained for history and is not the app's data source.

## Deployment and generated configuration

`BONDRAIL_DEPLOYMENT` defaults to `main`, selecting `docs/deployments/<chainId>.json`.
Other names select `<chainId>-<name>.json`. New deployments need their own name;
never overwrite the current production identity or anything in `archive/`.
`archive/10143-slice-metropolis.json` is the read-only judged reference.

Keys default to `~/.bondrail`, with named roles under `<name>/` and the deployer
at the root. `BONDRAIL_KEY_DIR`, `BONDRAIL_KEY_PREFIX` and
`BONDRAIL_DEPLOYER_KEY_FILE` can preserve an existing layout. The service launcher
checks each role's address against the manifest before starting the service.
Do not regenerate keys during a rename. The October naming migration is complete;
its [procedure and incident record](MIGRATION-2026-10.md) are retained as history.

To generate local public configuration for the selected deployment (no chain writes):

```sh
BONDRAIL_DEPLOYMENT=main OBSERVER_URL=http://127.0.0.1:8792/observe \
  pnpm tsx demo/scripts/write-watch-config.ts --force
BONDRAIL_DEPLOYMENT=main node indexer/gen-config.mjs 10143 --force
```

The first command writes `.data/deployments/10143-main/{registry,cre-config,targets}.json`.
`BONDRAIL_CONFIG_DIR` can override that directory. The second regenerates local
indexer files from the current factory/start block/covenant/registry. Run it in a
review checkout, not on the Envio release branch unless preparing a separately
reviewed indexer release. Do not recreate or reconnect the existing cloud project.

## Server units and overrides

Use `ops/bondrail-*.service` and `ops/bondrail-*.timer`. Each application service reads
`/etc/bondrail.env` then its optional service-specific env file. Units explicitly set
`HOME=/root` and a PATH containing `/root/.cre/bin`, `/root/.bun/bin`, and standard
system directories. The env files can override those defaults. Observer, worker,
facilitator and attester also use home-relative role keys through the launcher;
they need the same explicit home even though only covenant invokes CRE.
Existing local-mode overrides for observer/worker/facilitator must keep `BONDRAIL_ENV=local`, `BONDRAIL_STORE=local`
and the same durable `BONDRAIL_DATA_DIR`; this storage flag does not change chain 10143.
Preserve the explicit namespace when using Redis. Do not copy example credentials
or empty journals over live ones. Production local storage is a single-host setup
requiring backups and one facilitator writer; CAS lock directories require inspection
following a crash, never automatic deletion.

The reporter is `scripts/report-covenant.ts --broadcast`, using the selected manifest,
matching deployer, `.data/deployments/10143-main/cre-config.json`, and `/etc/bondrail.env`
(`CRE_ENV_FILE` overrides the last path). It supplies the deployer only in the child
environment. Before RPC or key access it requires an absolute `HOME` and a readable
regular file at `$HOME/.cre/cre.yaml`. It reports the expected path if that check
fails, without reading or printing credential contents. CRE still validates the
login itself; a present file can contain an expired or invalid login. Restore login
with `cre login` as the service user when necessary. Keep the operator's existing
`HOME=/root` in `/etc/bondrail-covenant.env`; it agrees with the unit default.
CRE secrets and provider config remain operator-managed. The 30-minute timer is
bounded monitoring, not continuous coverage or DON consensus.

```sh
systemctl is-active bondrail-observer.service bondrail-facilitator.service \
  bondrail-covenant.timer bondrail-worker.timer bondrail-attester.timer
systemctl show bondrail-covenant.service bondrail-worker.service bondrail-attester.service \
  -p Result -p ExecMainStatus
journalctl -u bondrail-covenant.service -u bondrail-worker.service --since '2 hours ago'
curl -fsS http://127.0.0.1:8792/health
curl -fsS https://bondrail-next.64-227-40-35.sslip.io/health
```

A oneshot can be inactive between successful runs: check its timer and last result.
Compare observer signer and facilitator wallet/factory/asset/network to `10143.json`.
Retain attestation evidence and worker/observer/facilitator journals in backups.

## Scheduled jobs, failure alerts and status

The 2026-10-16 migration uncovered **24 covenant failures in 12 hours**: systemd
had no `HOME`, so CRE could not find `/root/.cre/cre.yaml` and reported
`Credential validation failed … unable to retrieve organization info`. No reports
means no default by design; it also meant covenant monitoring was off. The operator
restored `HOME=/root` in `/etc/bondrail-covenant.env`. Do not interpret an absence of
defaults, or a timer being active, as evidence that reports are succeeding.

All five application services now specify `OnFailure=bondrail-alert@%n.service`.
Install `ops/bondrail-alert@.service` alongside them when rolling out these changes;
it runs `scripts/ops-alert.mjs` using Node alone, even if tsx/app dependencies fail.
It logs `bondrail_service_failed` with host/unit/time before looking up the current
exit result. The instance name includes the failed unit suffix, for example
`bondrail-alert@bondrail-covenant.service.service`. The template deliberately has no
`OnFailure` of its own, preventing recursive alerts. No daemon reload or server
installation was performed by this source change.

The handler reads optional `/etc/bondrail.env`. To deliver notifications, configure
`ALERT_WEBHOOK_URL` there (keep the file mode 0600) with the operator's Slack,
Discord, or other JSON webhook. Each alert invocation sends at most one POST with both
`text` (Slack) and `content` (Discord). It includes service identity and exit details,
never the journal, env contents, credential contents, or webhook URL. Unset means
journal-only, logged as `bondrail_alert_webhook_skipped`. Delivery has a five-second
timeout, no redirects or retries; errors log `bondrail_alert_webhook_failed` and
fail the alert unit. Review those errors locally if the external receiver is down.

```sh
journalctl -t bondrail-alert --since '12 hours ago'
journalctl -u bondrail-alert@bondrail-covenant.service.service --since '12 hours ago'
cd /opt/bondrail
node --import tsx scripts/ops-status.ts
node --import tsx scripts/ops-status.ts --json
# Optional alternate facilitator health endpoint, including the full /health path:
FACILITATOR_HOST=172.18.0.1 FACILITATOR_PORT=8789 \
  node --import tsx scripts/ops-status.ts --json
```

Run status on the host with permission to read the **system** journal (root or the
appropriate journal group). It only reads systemd/journal and the facilitator's
`/health`; it does not source `/etc/bondrail.env`, load signing keys, start jobs, or
send transactions. When the explicit health URL is unset, it uses `FACILITATOR_HOST` and `FACILITATOR_PORT` from the process environment (fallback `127.0.0.1:8789`). Production binds `172.18.0.1`; pass that host when running status without the service environment.
Each command/HTTP read has a five-second timeout; failures yield partial output
with errors. Exit 0 means all checks are healthy; exit 1 means attention or unknown
data; exit 2 means invalid arguments. JSON has `schemaVersion: 1`, `generatedAt`,
`ok`, `historySource`, `timers[]`, and `facilitator`, suitable for a future dashboard.

Each timer includes its enabled/active state, next/last trigger, service result and
exit code, and **separate last successful completion and last failure timestamps**.
Those two ISO timestamps come from stable systemd journal message IDs, so a later
success does not erase the last failure. Trigger/next timestamps use systemd's host
time format. A completed oneshot being inactive is normal. Missing journal history
is `null`/unknown, never assumed success. Disabled/inactive timers, a failure since
the last success, and success older than two schedule periods plus the 600-second
job budget require attention (covenant 70 minutes, worker 30 minutes, attester
12 hours 10 minutes). Facilitator output includes `balanceNative`,
`settlementsRemaining`, `lowBalance`, and `blockedReason`; low funds, a blocked
writer, or an unavailable/malformed health response also require attention.

History only covers retained journal entries. Provision persistent journal storage
and adequate retention through normal host administration if history must survive
reboots; this command does not configure journald. Journal-only alerts require an
operator to inspect them. A disabled timer or stopped host cannot emit a service
failure: check status regularly and use an external availability check for host
outages. Service alerts complement the facilitator's separate low-gas hook below.

## Facilitator gas budget and alerting

The deployment script's 0.5 MON facilitator seed is only a rehearsal seed. The [October 15 chain diagnosis](./FACILITATOR-GAS.md) found 32 successful mined settlements, no reverts, and **0.0284941505 MON per warm settlement after the top-up**. The 0.341929806 MON spend funded **12** settlements, although only three HTTP successes were reported. Pending HTTP responses may already be paid.

Monad charges the submitted gas limit. New quotes use estimate ×1.15 (rounded up), a 500,000 gas cap, latest base fee +2 gwei tip, 10% base-fee headroom and a 150 gwei max-fee cap. At 100 gwei base, an estimate of 190k costs ~0.022287 MON; repeating the observed 279,369 RPC estimate with the margin costs ~0.03277005 MON and requires ~0.0359828 MON funding at the initial 112 gwei cap. RPC estimates may already include padding. Budget **~4 MON including reserve for 100 warm settlements**; all-cap commitments would need 7.5 MON plus reserve. Count every consumer sharing the key. Two twenty-call traffic runs need more than the 0.5 MON seed.

Before paid traffic, top up the facilitator to its chosen operating target through the owner's funding process. A fresh 4 MON target adds 3.5 MON to the script's 7.1 MON role-funding total (**10.6 MON**, before deployment/report gas); the script is not changed to transfer this automatically. Check:

```sh
curl -fsS "$X402_FACILITATOR_URL/health"
```

Watch `balanceNative`, `estimatedSettlementCostWei`, `settlementsRemaining`, `reservedWei`, `inFlightNonce`, and `blockedReason`. The estimate is conservative at restart (500k gas), then follows the last quoted settlement. It subtracts the maximum outstanding-attempt commitment before counting available settlements. Positive balance does not guarantee affordability. `/settle` refuses an initially unaffordable transaction **before signing/journaling/sending** as `insufficient_gas_funds` with an empty hash. The agent returns a retryable 503 with `charged:false`; retry its **same signed request**, which reuses the cached generated answer. A response carrying a hash remains ambiguous even if recovery later runs out of gas.

Configure the writer's `/etc/bondrail.env` using the settings in `services/facilitator/.env.example` (defaults shown):

```sh
FACILITATOR_GAS_MARGIN_BPS=11500
FACILITATOR_MAX_GAS=500000
FACILITATOR_MAX_FEE_GWEI=150
FACILITATOR_PRIORITY_FEE_GWEI=2
FACILITATOR_STUCK_SECONDS=30
FACILITATOR_LOW_BALANCE_SETTLEMENTS=10
# Optional operator-owned HTTPS JSON receiver:
# FACILITATOR_LOW_BALANCE_WEBHOOK_URL=https://alerts.example.com/facilitator-gas
```

The writer checks recovery/balance every 15 seconds, logs `facilitator_low_gas_balance` below ten remaining settlements and optionally posts the health fields to that hook, at most once per five minutes per process. The request has a five-second timeout; failure logs `low_balance_alert_failed`. Configure the receiver to page the operator. No hook is contacted by installing this code or by its mocked tests. Retain gateway request limits: the gas cap bounds individual transactions, not total public demand.

## RPC budget and provider configuration

Monad's public `https://testnet-rpc.monad.xyz` endpoint limits **15 requests/second per IP**. All host processes, CRE, indexers and operator scripts share this public allowance. The retired Slice services have been removed. A per-process limiter cannot coordinate separate processes or deployments. Six requests/second in four processes is already over budget. `https://rpc-testnet.monadinfra.com` is **not a drop-in alternative**: some methods and batched requests return HTTP 403 “Restricted JSON RPC method”.

`createRpcTransport` in `@bondrail/shared` is used by facilitator, worker, attester, scripts through `scripts/lib.ts`, and agent receipt reconciliation. The observer only probes unpaid web endpoints and signs locally; it has no RPC client. CRE and indexers have separate RPC configuration and must be included in the host budget.

| Setting | Default | Behavior |
| --- | --- | --- |
| `BONDRAIL_RPC_URLS` | unset | Ordered, comma-separated URLs; overrides the singular setting. All must serve the same chain. |
| `BONDRAIL_RPC_URL` | caller's existing default | Single-URL fallback; facilitator's legacy `FACILITATOR_RPC_URL` and attester's `RPC_URL` remain supported after these two shared settings. |
| `BONDRAIL_RPC_RPS` | `6` | Process-wide token bucket, capacity **1**: paced starts, no idle burst. All public/wallet clients, URLs, retries and failover consume the same budget. |
| `BONDRAIL_RPC_CONCURRENCY` | `2` | At most two in-flight HTTP requests per process. If transports request different limits, the lowest wins. |

Six RPS leaves headroom below the public 15-RPS limit for a single busy service; concurrency two avoids tying up a small host while a request is slow. These defaults are **not** a shared-host aggregate guarantee. The host example uses **2 RPS per process** as a conservative starting point. Count every active process on the IP, include operator and CRE traffic, keep the sum comfortably below 15, and avoid overlapping manual scripts with timer jobs. Without measuring aggregate demand, even two RPS is not a guarantee. Worker bonds and their reads remain sequential and the transport spaces every request.

Requests are never JSON-RPC batched. HTTP 429 and RPC messages containing “limited” or “rate” trigger exponential backoff with jitter: 500 ms base, five-second cap, two retries per URL (three total attempts), then the next URL. The process pauses queued requests during backoff. Transport/network timeouts and HTTP 5xx also retry/fail over; ordinary reverts do not. Each HTTP attempt times out after ten seconds. HTTP 403 “Restricted” permanently excludes that URL for the failing method for the process lifetime; other methods still try the ordered primary. Failover sends identical raw signed transaction bytes. It does not prepare a new transaction.

For production-like paid traffic, use a dedicated provider key, for example Alchemy's **Monad testnet** endpoint, with provider capacity sized for the aggregate workload:

```sh
# Server-only environment; provision the real key through the owner's credential process.
export BONDRAIL_RPC_URLS='https://monad-testnet.g.alchemy.com/v2/YOUR_KEY,https://testnet-rpc.monad.xyz'
export BONDRAIL_RPC_RPS=6 BONDRAIL_RPC_CONCURRENCY=2
```

A public fallback still shares the IP limit when the dedicated primary fails. Use a second dedicated endpoint if public capacity cannot cover that case. Configure these variables in `/etc/bondrail.env`, operator script shells, and the agent's server environment; restart the affected Bondrail services after an owner configuration change. `scripts/export-env.ts agent|facilitator` preserves the ordered URLs and budget. Exported server files can contain provider keys: keep them private, and use a separate restricted browser RPC credential for the web's `NEXT_PUBLIC_*` settings. Configure CRE's provider separately. No provider or service configuration is changed merely by committing this code.


## Recovering `settlement_pending` payments

The facilitator journals signed bytes and a wallet slot (`facilitator-wallet:<chainId>:<lowercase gas address>`) before sending, then mirrors the authorization record. Keep the existing namespace and one writer per gas key. A new request never advances beyond an unresolved nonce. Startup and the 15-second monitor repair a crash before send and rebroadcast identical bytes. A stalled transaction gets a same-nonce/calldata fee bump after 30 seconds, bounded by the configured cap and available balance. Near authorization expiry it gets a bounded zero-value self-transfer cancellation; cancellation is **not** payment. Only successful receipts for saved settlement attempts can complete a payment. All attempt hashes are checked, so an older one may still prove success.

If `blockedReason` is `gas_fee_cap_exceeded` or `insufficient_gas_funds`, fund the wallet or review the fee cap deliberately. Recovery cannot override either budget. `wallet_busy` prevents new authorizations while a known slot resolves. If there is **no wallet slot** but pending nonce exceeds latest, `wallet_nonce_blocked` refuses new work: pause other writers, locate the transaction at the latest nonce using the original sender/journal or the provider's mempool tools, and have the operator replace/cancel that exact nonce with sufficient funding and both fees bumped. Do not fill later nonces, erase journals, or reuse the key in a second namespace. The October 15 diagnosis found no unknown pending transaction (latest=pending=32); inspect current state before recovery.

Legacy `{binding,transaction}` entries keep their receipt-only behavior, including the three bounded 20-second waits. Their signed bytes/nonce were never saved, so an unbroadcast legacy hash cannot be repaired automatically by this code. Investigate it with the original request, RPC transaction/receipt and sender records. Do not delete it or issue another authorization simply because `/settle` says pending.

An agent HTTP 202 includes the `paymentKey`; preserve the original signed request. Obtain the transaction hash from the facilitator `/settle` response, its durable journal (`facilitator:<chainId>:<lowercase asset>:<lowercase payer>:<lowercase nonce>` inside its store namespace), or the gas wallet's transaction history (v2 journal: `attempts[].transaction`, final `result.transaction`). Wait for the successful receipt and one additional block. With the **agent's** admin token configured in your shell:

```sh
export PAYMENT_KEY='payment:0x...64-hex-digits...'
export SETTLEMENT_TX='0x...64-hex-digits...'
curl --fail-with-body -sS "$AGENT_PUBLIC_URL/api/admin/reconcile" \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  --data "{\"paymentKey\":\"$PAYMENT_KEY\",\"transaction\":\"$SETTLEMENT_TX\"}"
```

A 200 response `{ "status": "complete", "transaction": "0x..." }` means the agent checked its configured chain, the successful/confirmed receipt, the exact token `Transfer` and `AuthorizationUsed` logs, the account's exact `Settled(payer,value,nonce)` event, and the token's `authorizationState(payer,nonce)` at that receipt block. It atomically changes the existing `settlement_pending` journal entry to `complete`, preserving the generated answer. Retry the **original signed oracle request** to retrieve that cached answer and `PAYMENT-RESPONSE`; reconciliation does not run the model or send a transaction.

HTTP 401 means the admin token is wrong/missing. HTTP 409 leaves the record pending: check chain/provider configuration, confirmations, hash, nonce and account event, then retry reconciliation after the underlying issue resolves. A token transfer without the account `Settled` event, a reverted receipt, or an unused nonce cannot be marked paid. This endpoint does not repair `processing` records without a journaled result.
