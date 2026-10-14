# Independent `next` deployment

The original judged deployment is `docs/deployments/10143.json`. Keep that file, its addresses, Vercel projects, Envio project, Redis data and service units intact. This runbook creates `10143-next.json`, new roles and independent services. **Only the owner executes the testnet section.** The automated rehearsal sends transactions only to an anvil process it starts on loopback.

## Local proof — one command

Prerequisites: Node 22+, pnpm 10.32.0, Foundry at `~/.foundry/bin/{forge,anvil}`, installed workspace dependencies, and Playwright Chromium or Google Chrome. Install once:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium  # unnecessary if Google Chrome is installed
pnpm e2e:local
```

The command builds contracts, starts an isolated anvil on a free port, forces chain 31337 / deployment `next`, generates temporary role keys, deploys the EIP-3009 test token and full protocol, and approves PumpLab. It creates all three businesses, starts the real facilitator plus an SDK-backed paid endpoint, sends Native and x402 traffic, advances history, funds/activates bonds, and checks same-transaction repayment. It allocates 0.5 USDC of a 2-USDC vault deposit while PumpLab is Funding. After a complete zero-revenue UTC day it fires the trigger and checks entry/exit NAV and idle-limited withdrawal. It records every bond, runs the actual attester with the local indexer, builds the web app from `31337-next.json`, and checks populated markets/vault/credit pages in a browser.

It checks overwrite refusal and resumability, compares the judged manifest byte for byte, prints address/check tables, and stops its child services even on failure. Temporary keys are deleted. No operator keys or public RPC are used. Local outputs are ignored by Git:

- `docs/deployments/31337-next.json` — addresses from this run (the chain stops afterward).
- `.data/e2e-local/result.json`, `*.log`, `*.png`, `web.env`, `evidence/` — assertions, logs, browser screenshots, public build settings, signed evidence inputs.
- `apps/web/.next-e2e/` — isolated production build. The harness restores Next's generated tracked files.

Rerunning replaces only the ignored `31337-next` rehearsal manifest and starts a fresh chain. This is a local adapter for app/attester queries, not an Envio correctness test. CRE's testnet forwarder is represented by the local deployer; a real observer signature and a fetched manifest/offer are still required. Model output is deterministic local work; payment verification, settlement and accounting are real.

## Naming, keys and restart behavior

Every operational manifest consumer honors `BONDRAIL_DEPLOYMENT` (default `main`): `main` uses `<chainId>.json`; other names use `<chainId>-<name>.json`. Names permit lowercase letters, digits, `_` and `-`, up to 32 characters; traversal is rejected. Scripts that replace a manifest require `--force`, including incremental demo updates. Refusal happens before deployment/setup broadcasts.

`BONDRAIL_KEY_DIR` defaults to the operator's `~/.slice`. `BONDRAIL_KEY_PREFIX` defaults to the named deployment (empty for `main`), so `next` roles resolve to `~/.slice/next/<role>.key`. These include issuer, payer, reviewer, observer, milestone, attester, curator, facilitator, worker, investor, trader and vault depositor keys. The deployer remains `~/.slice/deployer.key`, with the existing `~/.zeitgeist/testnet-deployer.key` fallback; `BONDRAIL_DEPLOYER_KEY_FILE` can select it explicitly. Keys are generated mode 0600 and never printed. Local role keys require an explicit temporary directory. Do not reuse live reviewer/issuer/payer/attester keys for `next`.

`deploy.ts --force` **resumes the same deployment**, validates role addresses/history/template and reuses deployed code. It does not silently create a replacement factory. `<manifest>.pending` checkpoints confirmed contracts if deployment is interrupted. Keep the journal and identical build/keys to resume. A crash after a transaction is mined but before its address is journaled can leave an orphan; inspect receipts before retrying. To intentionally make a third deployment, use a new name and key prefix instead of deleting the testnet manifest.

## Owner preparation and funding

Use a **separate checkout of this exact `next` commit** at `/opt/bondrail-next` on the service host; never install into `/opt/slice`. Provision the shared deployer and fresh scoped keys through the owner's normal secure credential process on that host. Keep all protocol commands on that checkout/host so generated keys need not be moved. Install Node 22+, pnpm, Foundry, Bun and the CRE CLI/Javy dependencies there; sign into CRE as the owner. No private keys belong in Vercel's web/agent projects.

Before anything, record a baseline on that host:

```sh
cd /opt/bondrail-next
git branch --show-current                         # next (or detached at the reviewed next commit)
git rev-parse HEAD
mkdir -p .data/next-baseline
sha256sum docs/deployments/10143.json > .data/next-baseline/manifest.sha256
cp docs/deployments/10143.json .data/next-baseline/10143.json
systemctl is-active bondrail-covenant.timer bondrail-worker.timer
systemctl show bondrail-covenant.service bondrail-worker.service \
  -p FragmentPath -p ExecStart > .data/next-baseline/live-units.txt
pnpm install --frozen-lockfile
~/.foundry/bin/forge build --root contracts
```

Set these values for **every command** below (also used in `/etc/bondrail-next.env`). Replace the three example URLs with your new project's actual URLs. Do not use the judged agent or facilitator URL.

```sh
export BONDRAIL_DEPLOYMENT=next BONDRAIL_CHAIN_ID=10143
export BONDRAIL_RPC_URL=https://rpc-testnet.monadinfra.com
export BONDRAIL_KEY_PREFIX=next
export BONDRAIL_MIN_HISTORY=600
export RAISE_USDC=2 CAP_USDC=2.4 STAKE_USDC=0.5
export FUNDING_DAYS=4 MATURITY_DAYS=9
export TRIGGER_BOND=pumplab TRIGGER_REVENUE_USDC=0.01 TRIGGER_DAYS=1 STEP_UP_BPS=4000
export VAULT_BOND=pumplab VAULT_ALLOCATE_USDC=0.5 VAULT_DEPOSIT_USDC=2
export WALLETS=3 PER_WALLET_USDC=0.3 PER_PAYER_USDC=0.2
export AGENT_PUBLIC_URL=https://agent-next.example.com
export AGENT_URL="$AGENT_PUBLIC_URL/api/oracle"
export X402_FACILITATOR_URL=https://facilitator-next.example.com
# Set INDEXER_URL after provisioning the independent Envio endpoint.
```

Fresh-role funding for the exact commands below is computed from `deploy.ts`, `setup-demo.ts`, `traffic-launchpad.ts` and `traffic-agent.ts`. The deployer transfers these amounts; separately faucet-funding every role is unnecessary.

| Role / count | Test USDC per role | MON balance target per role | Use |
| --- | ---: | ---: | --- |
| `pumplab-issuer`, `curvelab-issuer`, `agent-issuer` (3) | 0.5 | 1 | Stakes; account/project/bond creation |
| `investor` (1) | 3.5 total | 0.5 | PumpLab remaining 1.5 + Oracle Agent 2 |
| `vault-depositor` (1) | 2 | 0.2 | Vault deposit; 0.5 allocated, 1.5 idle |
| `pumplab-organic-0..2`, `curvelab-organic-0..2` (6) | 0.3 | 0.3 | Native buys/sells; gross buy = 0.06 per round |
| `payer-0..4` (5) | 0.2 | 0 | Twenty 0.01-USDC calls in each of two traffic runs; signing only |
| `reviewer` | 0 | 0.2 | Template approval |
| `attester` | 0 | 0.2 | Registry attestation |
| `curator` | 0 | 0.2 | Vault allocation |
| `facilitator` | 0 | 0.5 | Pays settlement gas |
| `worker` | 0 | 0.5 | Maintenance / trigger checks |
| `observer`, `milestone` | 0 | 0 | Signatures only |
| **Deployer starting wallet** | **9.8 minimum; provision 12** | **7.1 role top-ups + deployment/report gas; provision 20** | Shared deployer, fresh recipients |

USDC arithmetic: `3×0.5 + (2−0.5)+2 + 2 + 6×0.3 + 5×0.2 = 9.8`. The vault's allocation is included in its deposit, not counted twice. CurveLab's **2-USDC open raise remains unfunded**; funding it later needs another 2 USDC from investors. At 1% fees, Native traffic produces small but real revenue; principal backing remains in PumpLab. Claims have a 2.4-USDC full-release cap; activation releases 50%, so the initial effective cap is 1.2.

MON arithmetic: `3×1 + 0.5 + 0.2 + 6×0.3 + 3×0.2 + 2×0.5 = 7.1`. These are balance targets, not gas estimates. Reruns can replenish gas spent since the prior run. Actual fee costs depend on RPC gas prices and gas limits (Monad charges the limit); 20 MON is an operating reserve, not a guaranteed ceiling. Stop and replenish if simulations/funding report insufficient funds. Longer operation, additional traffic and CRE reports need ongoing gas. Obtain Circle test USDC at the asset address recorded by the deployment; never substitute a lookalike token.

## Owner deployment and initial traffic

```sh
pnpm tsx scripts/deploy.ts
# Only if resuming an existing next deployment: pnpm tsx scripts/deploy.ts --force
pnpm tsx demo/scripts/setup-demo.ts --force
pnpm tsx scripts/export-env.ts agent > .data/agent-next.env
pnpm tsx scripts/export-env.ts facilitator > .data/facilitator-next.env
```

The first setup creates the Native projects and Watched account and stops before issuance because there is no history. It prints the agent account/payTo. All addresses, roles, factory start block and reviewed creation-code hash are in `10143-next.json`. Keep that manifest backed up with the deployment's operational records; it contains no private keys.

Start the facilitator and agent before paid traffic. Install the independent service environment and persistent facilitator on the host:

```sh
sudo install -m 600 ops/next/bondrail-next.env.example /etc/bondrail-next.env
sudoedit /etc/bondrail-next.env
# Fill next-only Redis URL/token, observer API token, key paths and later the next Envio URL.
# No role key bytes are placed here: scripts/service.ts loads the named role itself.
sudo install -m 644 ops/next/bondrail-next-*.service ops/next/bondrail-next-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now bondrail-next-facilitator.service
curl -fsS http://127.0.0.1:8789/supported
```

Expose that service at a **new HTTPS origin** (e.g. `https://facilitator-origin-next.example.com`) with a reverse proxy to `127.0.0.1:8789`; allow a 120-second response timeout. Run only one persistent facilitator process for its gas key. Do not restart/reconfigure the live facilitator.

Create three separate Vercel projects with the following root directories and **Preview** variables, scoped to branch `next`. Disable preview protection for these public demo/API hosts (or use custom domains without protection); otherwise unpaid observers receive the login page instead of HTTP 402. Use project-specific Redis storage, or the exact independent namespaces below. No production aliases or live environment variables are changed.

| Project / root | Preview variables |
| --- | --- |
| `bondrail-next-web` / `apps/web` | All values from `scripts/export-env.ts web` after issuance/indexer setup: `BONDRAIL_DEPLOYMENT=next`, `NEXT_PUBLIC_CHAIN_ID=10143`, RPC, indexer, USDC, factory, vault, registry and both featured bond addresses. Separate `KV_REST_API_URL`, `KV_REST_API_TOKEN` for signed profiles; optional `NANSEN_API_KEY`. Leave `DRIP_PRIVATE_KEY` unset unless provisioning a fresh dedicated drip key. |
| `bondrail-next-agent` / `demo/agent` | All values from `.data/agent-next.env`; `BONDRAIL_ENV=testnet`, `BONDRAIL_STORE=redis`, `BONDRAIL_STORE_NAMESPACE=bondrail-10143-next-agent`, separate `REDIS_REST_URL`, `REDIS_REST_TOKEN`, fresh `AGENT_ADMIN_TOKEN` (32+ random characters), `MODEL_API_KEY`, `MODEL_BASE_URL`, `MODEL_ID`. `AGENT_INITIAL_PAY_TO` is the **next agent account** and `X402_FACILITATOR_URL` the **next facade**. |
| `bondrail-next-facilitator` / `services/facilitator` | `FACILITATOR_UPSTREAM_URL=https://facilitator-origin-next.example.com/`. Framework Other; supplied `vercel.json` serves `/supported`, `/verify`, `/settle`. This facade forwards to the single persistent next writer; **no private key on Vercel**. The host writer receives its `FACILITATOR_FACTORY`, `FACILITATOR_ASSET`, RPC and scoped gas key via `scripts/service.ts`. |

Vercel requires this exact commit and the new public manifest at build time (the docs render selected addresses). The owner publishes these commits/manifests through their usual review/deploy process. There is no push or remote deployment in the rehearsal. For a CLI Preview from each configured project, use `vercel deploy` without `--prod`; assign only the new `*-next` aliases. Refresh the agent's Preview deployment after changing its initial environment. A previously initialized Redis config overrides `AGENT_INITIAL_PAY_TO`, so start with empty next storage and check the served manifest.

```sh
curl -fsS "$X402_FACILITATOR_URL/supported"
curl -fsS "$AGENT_PUBLIC_URL/api/health"
curl -fsS "$AGENT_PUBLIC_URL/.well-known/bondrail.json"
curl -sS -D - -o /dev/null "$AGENT_URL"          # must be 402, payTo in header = next account
pnpm tsx demo/scripts/traffic-launchpad.ts pumplab organic 1
pnpm tsx demo/scripts/traffic-launchpad.ts curvelab organic 1
TRAFFIC_STRICT=1 pnpm tsx demo/scripts/traffic-agent.ts 20 5
sleep 600                                                 # actual testnet history, no time warp
pnpm tsx demo/scripts/setup-demo.ts --force
```

PumpLab is now funded (including the vault allocation) and Active; CurveLab is Funding with an open raise. Oracle Agent is funded and waits for a fresh compliant CRE report. All three bonds are recorded in the registry. Rerunning setup reuses records, skips activation when already active, and does not repeat the vault deposit/allocation. `TRIGGER_*` only affects the selected `TRIGGER_BOND` at issuance; it cannot change an existing bond.

## Separate Envio project / `envio-next` branch

Generate config only into an independent checkout. This leaves `indexer/config.yaml` and `indexer/src/deployment.ts` in the live project untouched:

```sh
cd /opt/bondrail-next
git worktree add -b envio-next ../bondrail-envio-next next
cp docs/deployments/10143-next.json ../bondrail-envio-next/docs/deployments/10143-next.json
BONDRAIL_DEPLOYMENT=next BONDRAIL_INDEXER_DIR=/opt/bondrail-envio-next/indexer \
  node indexer/gen-config.mjs 10143 --force
cd /opt/bondrail-envio-next/indexer
pnpm install --frozen-lockfile
pnpm codegen
pnpm typecheck
```

The generated project is `bondrail-next`, starts at the new deployment's `startBlock`, pins the new factory/covenant/registry, and indexes the shared Circle USDC asset. Factory events dynamically register only next accounts and bonds. Review/commit the generated `indexer/config.yaml`, `indexer/src/deployment.ts` and public manifest on `envio-next`; connect a **new Envio Cloud project to that branch**. Supply its own `ENVIO_API_TOKEN` and database/endpoint. Do not reconnect the live Envio project or replace its branch. Owner publication is a separate action.

Set `INDEXER_URL` to the new GraphQL endpoint in the operator shell and `/etc/bondrail-next.env`. Wait until Envio has indexed all three accounts/bonds and its head catches up. Verify counts and compare addresses with `10143-next.json`:

```sh
export INDEXER_URL=https://YOUR-NEXT-ENVIO-ENDPOINT/v1/graphql
curl -fsS "$INDEXER_URL" -H 'content-type: application/json' \
  --data '{"query":"{ Issuer { id } Bond { id account phase } }"}'
cd /opt/bondrail-next
pnpm tsx scripts/export-env.ts web > .data/web-next.env
```

Import `.data/web-next.env` into the web project's Preview settings, and rebuild that Preview. The docs page also selects `10143-next.json`; it never substitutes the judged manifest.

## Independent covenant, worker and attester units

The new units are in `ops/next/`. They use `/opt/bondrail-next`, `/etc/bondrail-next.env`, next keys, Redis namespace `bondrail-10143-next`, observer port **8790**, facilitator port **8789**, and new evidence/config paths. The original `ops/covenant-server/` units are not edited.

```sh
cd /opt/bondrail-next
OBSERVER_URL=http://127.0.0.1:8790/observe pnpm tsx demo/scripts/write-watch-config.ts --force
pnpm --filter @bondrail/cre compile
# Configure cre/project.yaml in THIS checkout with the next operator RPC, and CRE login on this host.
sudo systemctl enable --now bondrail-next-observer.service
curl -fsS http://127.0.0.1:8790/health
sudo systemctl start bondrail-next-covenant.service
journalctl -u bondrail-next-covenant.service -n 60 --no-pager
# Require a fresh compliant report and BONDRAIL_REPORT_TX before activation (90-second freshness).
pnpm tsx scripts/activate-watched.ts
sudo systemctl enable --now bondrail-next-covenant.timer bondrail-next-worker.timer bondrail-next-attester.timer
TRAFFIC_STRICT=1 pnpm tsx demo/scripts/traffic-agent.ts 20 5
pnpm tsx demo/scripts/traffic-launchpad.ts pumplab organic 1
# Wait for the new indexer to catch up, then produce the first real attestation:
sudo systemctl start bondrail-next-attester.service
journalctl -u bondrail-next-attester.service -n 30 --no-pager
```

`report-next.ts --broadcast` supplies the selected shared deployer to CRE only in its child environment, explicitly pins next config and runs the testnet CRE forwarder. The observer token in `/etc/bondrail-next.env` is shared with CRE's existing `secrets.yaml` mapping. No direct-to-covenant testnet fallback exists. A violation is retried in adjacent 30-second epochs. The covenant timer checks every 30 minutes; it does not promise continuous compliance.

The maintenance unit enables `WORKER_CHECK_TRIGGERS=1` and runs one cycle every ten minutes. The earliest trigger check is UTC day `floor(activationTime/86400) + 2` for this one-day window. Leave a complete day below 0.01 USDC revenue; the trigger changes the investor share from 25% to 40%, and the vault's exit NAV reflects impairment. No testnet time manipulation is used. The attester runs every six hours with a 24-hour TTL, defaults to PumpLab, and records/backfills bonds before attesting. Set `CREDIT_ACCOUNT` in the next env for a different account. Evidence persists under `.data/attestations/`; retain it with operational backups.

## Final checks and rollback

- Compare every next contract to `10143.json`: factory, covenant, both implementations, Native projects/accounts/bonds must be different. Shared USDC and CRE forwarder are expected. Registry/vault must point to the next factory; attester/curator/reviewer must be the scoped roles.
- Check 402 payTo and settled transaction **destination = next account**, function `settle`, plus `Settled` and `Revenue` in the same receipt. A token transfer followed by a later sweep does not meet this rollout's payment flow.
- Check all three bonds are recorded; PumpLab's profile says `1 of 1`, the attestation is valid/current and its evidence hash matches the saved bytes. Verify CurveLab remains open, PumpLab and agent Active, vault holding 0.5 and idle 1.5 USDC before later lifecycle operations.
- Confirm the new web Preview shows the new addresses and its network/indexer requests use only next endpoints. Confirm the judged Preview/production alias and agent still resolve to their original deployments.

```sh
cd /opt/bondrail-next
sha256sum -c .data/next-baseline/manifest.sha256
cmp docs/deployments/10143.json .data/next-baseline/10143.json
systemctl is-active bondrail-covenant.timer bondrail-worker.timer
systemctl show bondrail-covenant.service bondrail-worker.service \
  -p FragmentPath -p ExecStart | diff - .data/next-baseline/live-units.txt
systemctl is-active bondrail-next-observer.service bondrail-next-facilitator.service \
  bondrail-next-covenant.timer bondrail-next-worker.timer bondrail-next-attester.timer
journalctl -u bondrail-covenant.service -u bondrail-worker.service --since '2 hours ago' --no-pager
```

Check the live app/agent health URLs and latest live report/worker timestamps as well; a oneshot service can be inactive between successful runs, so inspect its timer and latest exit status. Read the live factory/covenant code and role getters over RPC and compare them to the original manifest/baseline. The rehearsal proves the live file is untouched; only this owner checklist can prove remote live service continuity.

Rollback means removing the new Preview aliases and stopping/disabling **only** `bondrail-next-*.timer` and `bondrail-next-{observer,facilitator}.service`. Stop pending oneshot next jobs as needed. Leave original units/aliases/Envio/storage intact. Already deployed contracts and recorded attestations cannot be erased; retain the next manifest/journal/evidence and service logs. Unfunded/open raises can be withdrawn/cancelled through their normal lifecycle; an Active vault position is not instantly liquid. Keep maintenance/reporting funded if obligations remain. For local cleanup only, remove `.data/e2e-local`, `apps/web/.next-e2e` and `docs/deployments/31337-next.json` after services have stopped. Never delete the judged manifest or operator key directories.
