# Task 12 — Envio Cloud diagnosis for `envio-next`

Investigated **2026-10-15**. Public chain-height probes were collected at **09:39–09:45 UTC** (10:39–10:45 Lagos).

## Finding

**The evidence points primarily to a deployment-specific Envio Cloud startup/provisioning or serving problem. It does not establish a platform-wide incident, nor identify a guaranteed source-code fix for the 503.** The application passes code generation, full TypeScript checking, and Envio's actual handler loading/registration. Monad testnet HyperSync is supported and its public height endpoint was advancing during this investigation.

The strongest finding is in **v3.14.0's database initialization**: a new chain row starts with `block_height = 0`, `latest_processed_block = -1`, and `is_hyper_sync = false`, regardless of the configured source. Thus the reported zero-height deployment and its “Source: RPC” label are consistent with untouched initialization data. They are **not evidence that a no-RPC config selected RPC**, or that adding an RPC URL was necessary. They show that progress was not persisted; they do not prove that no chain-head request was ever attempted. [S1]

There is also a real, separately reproducible repository defect: **all nine indexer tests fail because their simulated block 70,000,000 precedes `start_block: 71189277`**. Correcting the fixture blocks makes them pass. This explains a build failure **only if the Cloud pipeline invokes `pnpm test`**; neither the checked-in startup script nor the public deployment documentation establishes that it does.

Recommended next setup: remove the explicit `rpc: ... for: sync` block to restore HyperSync, fix the two test fixtures, retain the existing handler filename and startup scripts, and obtain Cloud build/runtime logs using the separate authenticated **`envio-cloud`** CLI. These changes were tested in a temporary copy, not applied to `envio-next` or Cloud.

## Scope and evidence boundaries

- Source worktree: `/Users/adokiye/Nervos_Development/bondrail-envio-next`, branch `envio-next`, clean at `65b9682a5fb41b32ee08e8a341b098a17fff37d9` before and after research.
- Compared local remote-tracking refs `origin/envio` (`17492ed383fbd9b858b87e6345216fd4314ac768`) and `origin/envio-next` (same SHA as HEAD) with `git diff origin/envio origin/envio-next -- indexer`. No fetch or source edits.
- Report destination: `slice-next`, branch `next`, initially `4dffe9a`. Only this report is intended for the commit.
- No push, deployment, restart, deletion, promotion, Cloud setting change, authentication attempt, database startup, or chain transaction. `envio codegen` regenerated ignored local types as explicitly allowed. Experimental edits and downloaded research material went under `/private/tmp/`.
- Cloud project states and GraphQL responses in the following table are **owner-provided observations**, not independently re-read from an authenticated Cloud session. The public network probes, local checks, CLI help, documentation, and versioned source inspection are independently observed.

| Deployment / project | Supplied observation | What it establishes |
|---|---|---|
| Slice, branch `envio`, root `indexer`, v3.14.0, Development | Four days old; synced using HyperSync; endpoint 200 | Useful same-repository/version/network control; multiple indexers per repository are supported |
| `3d91cba` | Deploying for about 37 minutes; no build/indexer logs; endpoint never answered | Startup or provisioning did not become observable; no error identifies the stage |
| `a200609` | Active; RPC label; 0% synced; GraphQL returned height 0 / processed -1; no `rpc` in config | Database/GraphQL were reachable, but metadata remained at initialization values |
| `42d03c0` | Explicit public RPC with 100-block windows; stuck Deploying | Switching the data source did not resolve the deployment symptom |
| `65b9682` | Same RPC config; Active; Events Processed “–”; Loading logs; GraphQL 503 | “Active” does not establish serving readiness or successful indexing |

An HTTP 503 does not by itself distinguish an unavailable GraphQL upstream, an unready database, a failed container, or a routing/provisioning fault. No response body, request ID, or container/build logs were available to make that distinction.

## Ranked causes

| Rank | Candidate | Evidence and confidence | How to decide / remedy |
|---|---|---|---|
| 1 | Cloud deployment initialization, scheduling, or service readiness/routing failure affecting this project | Best fit, moderate confidence: four attempts across two source configurations, missing logs, initialized-but-idle metadata, and an Active deployment that returns 503. Local configuration and handler startup checks pass. | Envio must correlate deployment/build IDs with provisioning state, container exits, database readiness, and GraphQL routing. A source patch cannot repair those services. |
| 2 | Cloud-only install/start failure or resource problem hidden by unavailable logs | Still plausible. Cloud resolves dependencies afresh and its Node/build environment was not inspected. A failing test suite is a concrete blocker **if** tests are run. | Retrieve build logs and launch command. If tests are invoked, apply the fixture fix below. If logs show module/engine/package errors, fix that specific error; no evidence supports deleting `tsx` or renaming handlers speculatively. |
| 3 | Public RPC failure, throttling, or slow catch-up introduced by `for: sync` | The source override is confirmed for the last two attempts. A 100-block window limits request size, not requests per second. It cannot explain the first two no-RPC deployments, nor by itself explain missing build logs. | Restore HyperSync. If RPC is deliberately required later, use a suitable provider and explicit limits; inspect source errors before tuning. |
| 4 | HyperSync-wide outage or missing network support | Low confidence for the observed period: 10143 is supported by both docs and v3.14.0; two public heights advanced; an existing indexer reportedly works. Earlier/transient or Cloud-specific connectivity/authentication failures remain possible. | Have Envio test source access from the failing deployment and confirm its managed HyperSync credentials. Public height availability does not verify that deployment's authenticated log access. |

Neither a missing user `ENVIO_API_TOKEN`, the filename `bondrail.ts`, an absent per-contract `handler`, nor the presence of an updated lockfile is supported as the root cause.

## Local validation and branch comparison

Local runtime: **Node v26.8.1**, Envio **3.14.0**, TypeScript **5.9.3**, pnpm **10.32.0**. `pnpm` was absent from PATH; `/private/tmp/task11-bin/pnpm` invokes an already cached installation of exactly 10.32.0. No dependency installation in the source worktree was needed.

| Command / check, in `indexer/` | Result |
|---|---|
| `npx --no-install envio --version` | Installed version 3.14.0 |
| `npx --no-install envio codegen` | Exit 0; no diagnostic output; generates `.envio/types.d.ts` / ambient type wiring |
| `npx --no-install tsc --noEmit` | Exit 0; no diagnostic output, including `test/**` |
| `npx --no-install envio config view` | Exit 0; output below |
| v3.14.0 `HandlerLoader.getAutoLoadFiles`, `typeCheck`, `registerAllHandlers` | Finds only `src/handlers/bondrail.ts`; startup handler typecheck passes; registers 32 events on 10143, all with handlers; two also have contract registration |
| `/private/tmp/task11-bin/pnpm test` | Exit 1; 9 tests, 0 passed, 9 failed with the block-range error below |
| Temporary copy: remove RPC override and change both test block fixtures to 71,189,277 | Codegen, full typecheck, handler audit pass; tests: 9 passed, 0 failed; resolved source is `https://10143.hypersync.xyz` |

`config view` prints only:

```json
{
  "version": "3.14.0",
  "storage": { "postgres": true }
}
```

Despite its help describing “resolved indexer config,” v3.14.0 deliberately exposes only version/storage through this command. The restricted output does **not** mean chains or handlers are missing. The native config parser and runtime audit separately resolved chain 10143, all addresses, all events, and the expected source. There is no dedicated `envio validate` or `envio cloud` command in this version's help. Codegen and config inspection work without Docker. [S2]

The test failure is:

```text
Error: Invalid block range for chain 10143: startBlock (70000000)
is less than config.startBlock (71189277).
Either use startBlock >= 71189277 or create a new test indexer with createTestIndexer().
```

Both files already call `createTestIndexer()`, so constructing another instance alone will not fix this config-bound fixture. Node 26 also prints a `module.register()` deprecation warning from the test loader; it is not the failure and the corrected tests pass with that warning.

The temporary copy contained only tracked `indexer/` files, with a symlink to the existing dependencies and regenerated types. This checks the source layout and proposed changes, **not a fresh Linux/Cloud dependency installation or a live database/indexing run**.

Actual comparison: 10 changed files, 698 insertions / 86 deletions. Contract names change from `Slice*` to `Bondrail*`; deployment addresses/start block change; the handler is renamed; schema, generator, tests, package and lockfile change. The event count is **28 → 32**. Specifically, `Settled`, `TriggerChanged`, and the registry's `BondRecorded` / `Attested` are added. **`Withdrawn`, `NativeTemplate`, and `NativeDeployed` already exist in `origin/envio`**; they are not new relative to this baseline.

### Handler discovery and every configured event

The v3 schema's top-level **`handlers`** property defaults to `src/handlers`. The actual loader recursively globs `./src/handlers/**/*.{js,mjs,ts}`, excluding names containing `.test.`, `.spec.`, or `_test.`. A contract-level **`handler`** is an optional explicit file path. No filename must match a contract name, and no `index.ts`, `EventHandlers.ts`, `generated` import, or per-contract file is needed here. The general event-handlers prose loosely calls this field `handler`; the schema and runtime distinguish the directory `handlers` from contract-level `handler`. [S3]

`bondrail.ts` imports `indexer` from `envio`, and registers callbacks at module top level. All 32 config events have matching `indexer.onEvent` registrations:

| Contract | Configured events, all confirmed registered |
|---|---|
| BondrailFactory (6) | AccountCreated, NativeApproval, NativeTemplate, NativeDeployed, BondCreated, SecondReleaseApproved |
| BondrailAccount (6) | Revenue, Settled, Collected, ProjectBound, Attached, Detached |
| BondrailBond (14) | Deposited, Withdrawn, Activated, PrincipalReleased, UndrawnRecovered, RevenueReceived, TriggerChanged, DefaultRecorded, CollectionClosed, SettlementFinalized, FundingCancelled, Refunded, Redeemed, Transfer |
| BondrailCovenant (2) | ObservationAccepted, CovenantDefault |
| BondrailCreditRegistry (2) | BondRecorded, Attested |
| USDC (2) | Transfer, AuthorizationUsed |

The two factory `indexer.contractRegister` callbacks correctly call `context.chain.BondrailAccount.add(event.params.account)` and `context.chain.BondrailBond.add(event.params.bond)`. Addressless Account/Bond entries in config are appropriate for those dynamic contracts. The runtime combines each factory registration with its event handler; these are 32 event registrations, not 34 independent event types. Factory, covenant, USDC, and registry addresses match the committed `10143-next.json`; the start block matches too. [S4]

The only application import from the handler is `../deployment`, which stays inside `indexer/src`. Its extensionless TypeScript import resolves successfully through Envio's native loader. There are no top-level RPC calls or external application imports blocking handler registration.

`gen-config.mjs` **does** import `../scripts/deployment-path.mjs` and read `../docs/deployments/...`, outside the uploaded indexer directory. This would fail if run inside the isolated Cloud upload. However, it is only the manually invoked `config:testnet` script: `start` is `envio start`, and `codegen` is `envio codegen`, neither of which invokes that generator. Keep generating config locally and committing its outputs; do not add that repository-level generator to Cloud startup unless its inputs are moved into the uploaded directory.

## HyperSync, RPC, and the misleading initial metadata

The official supported-network tables list **Monad Testnet, chain 10143**, at `https://10143.hypersync.xyz` and `https://monad-testnet.hypersync.xyz`. The v3.14.0 chain registry includes `MonadTestnet = 10143`. Removing the RPC block in the temporary copy resolved:

```json
{
  "monadTestnet": {
    "id": 10143,
    "startBlock": 71189277,
    "hypersync": "https://10143.hypersync.xyz"
  }
}
```

Addresses are omitted from this excerpt only. With the committed config, the native parser instead resolves the public RPC with `for: "sync"`, `initialBlockInterval: 100`, `intervalCeiling: 100`, and no primary HyperSync endpoint. This is an intentional source change, not an extra connection setting. On supported chains, a URL with omitted `for` defaults to **fallback**; explicit `for: sync` selects RPC for historical indexing. Do not combine an explicit `hypersync_config` with an RPC marked `for: sync`: v3.14.0 rejects the conflicting historical sources. [S5]

Public read-only probes:

| UTC time | Probe | Observed result |
|---|---|---|
| 09:39:18 | `GET https://10143.hypersync.xyz/height` | HTTP 200, height **71,218,821** |
| 09:39:18 | Monad public RPC `eth_blockNumber` | HTTP 200, `0x43eb68a` = **71,218,826** |
| 09:43:23 | HyperSync `/query`, no token | HTTP 401, “Your token is malformed” |
| 09:45:13 | Monad public RPC `eth_chainId` | HTTP 200, `0x279f` = **10143** |
| 09:45:13 | Factory `eth_getLogs`, inclusive blocks **71,189,293–71,189,392** | HTTP 200, one factory log at **71,189,370** |
| 09:45:14 | HyperSync `/height` again | HTTP 200, height **71,220,000** |

These establish supported, advancing public infrastructure and available historical factory data. They do not reproduce Cloud's network path, establish authenticated HyperSync log availability, or rule out an earlier incident. The unauthenticated query's 401 is expected: local HyperSync queries need a token. **Cloud indexers have their own HyperSync access and do not need a user `ENVIO_API_TOKEN`.** Do not treat that external 401 as a reason to inject a personal token into Cloud. [S6]

The metadata explanation is exact, versioned implementation evidence:

```text
InternalTable.Chains.initialFromConfig:
  blockHeight: 0
  latestFetchedBlockNumber: -1
  progressBlockNumber: -1
  isHyperSync: false
  numEventsProcessed: 0

chain_metadata view:
  source_block   AS block_height
  progress_block AS latest_processed_block
  _is_hyper_sync AS is_hyper_sync
```

Later, `ChainState.toChainMetadata` derives `isHyperSync` from the active source. Before successful metadata updates, its initial false value cannot identify the real selected source. The observed “RPC” UI label is consistent with that initial false flag; the Cloud UI implementation itself was not inspected. [S1]

## Cloud requirements, packages, and relevant upstream reports

The deployment guide requires a package/config in the selected root, an explicit Envio version, pnpm **10.32.0** compatibility, and a repository below **100 MB**; it strongly recommends Node **24 or higher**. It expressly supports multiple indexers on one repo with different branches/directories/configs. The supplied 4.4 MB size, two projects, root `indexer`, exact `envio: "3.14.0"`, and `packageManager: "pnpm@10.32.0"` meet those documented constraints. Actual Cloud settings still need authenticated confirmation. [S7]

The installed Envio package requires **Node >=22.15.0**. The project's `engines.node: ">=22"` is slightly too permissive for early Node 22, but permits Node 24. Tightening it to `>=24` is useful documentation/compatibility hygiene, not an established fix for these deployments. No evidence shows the Cloud runtime used an unsupported Node version.

Cloud uploads only the selected indexer folder, skips `generated`, `node_modules`, and dotfiles/directories other than `.npmrc`, and **does not use `pnpm-lock.yaml`**; it resolves dependencies on each build. Therefore:

- The committed indexer lockfile is useful locally but is not a Cloud frozen-lockfile requirement. Its 303 added lines mostly introduce `tsx` / esbuild's platform packages; their presence does not mean every platform binary gets installed.
- Keep `indexer/pnpm-workspace.yaml` (`packages: []`) and the standalone package layout. Nothing requires widening Cloud's root to the full monorepo.
- Envio, TypeScript, `@types/node`, and `tsx` direct versions are exact already. Transitive resolution can still differ in Cloud; build logs are needed to diagnose that.
- `test` is not an install lifecycle hook. There is no `preinstall`, `install`, `postinstall`, `prepare`, or `prestart` in this project's package. Public evidence says Cloud launches `pnpm start`; this package correctly maps it to `envio start`.
- v3.14.0 removed Envio's runtime dependency on `tsx`, using native TypeScript module hooks instead. A separate `tsx` devDependency for tests is not prohibited. The pnpm 11 ignored-esbuild-build failure discussed upstream is different: Cloud documents pnpm 10.32.0, where the referenced issue says ignored builds warn rather than fail.
- v3.14.0 adds startup typechecking of handler files. Including `test/**` in tsconfig does not execute tests; both full `tsc` and the actual runtime handler typecheck pass here. [S8–S11]

Free-plan limits are **3 development indexers per organisation** and **3 deployments per indexer**, not one project per repo. Four attempts over time do not prove four concurrent deployments. Confirm the active deployment count; do not delete anything as a speculative fix. The documented age/inactivity/usage policies also do not naturally explain a fresh deployment that never recorded any events. [S7]

Relevant public findings, distinguishing their applicability:

| Source | Finding | Relevance here |
|---|---|---|
| HyperIndex issue #1666 | Cloud determines Envio version from the selected root package | Correct with root `indexer`; repo-root misconfiguration remains something to verify |
| Issue #1667 | Cloud launches root `pnpm start`; custom script selection requested | Existing `start: envio start` is correct; no evidence `test` is automatically run |
| Issue #1668 | Cloud pnpm 10.32 rejects `engines.pnpm >=11` despite `packageManager` | This project has no such restriction and pins 10.32.0 |
| Issue #575 | Request for a custom pre-deployment build command; generated configs need committing | Supports keeping this repo's config generator local; not an established 503 fix |
| Issue #1671 | A failed chain source can still look 100% synced; metadata can be stale | Dashboard labels alone are insufficient. Maintainer points to progress-block-time metrics added in v3.12 |
| Issue #1225 | Request for a readiness endpoint distinct from basic health | An HTTP health check and complete indexing are different conditions; not a report matching this GraphQL 503 |
| Issue #1691 | TUI can show “searching” for chains at head without events | Cosmetic local TUI case; does not explain unavailable GraphQL or zero initialized metadata |
| Discussion #763 | Maintainer says failed HyperSync sources continue polling and resume when available | Older general behavior, not evidence of a current Monad/Cloud incident |
| v3.13.0 | RPC source rewritten in Rust; fixes bad-provider-response crashes | Already included in 3.14.0 |
| v3.14.0 | Native TS loading, handler typechecks, Node minimum raised to 22.15 | These paths passed locally |
| v3.14.1, latest stable release found, 2026-10-08 | Optional RPC URL interpolation; stale-replica failover grace; TypeScript 7 checker compatibility | No release note identifies these Cloud startup/503 symptoms as a fixed bug; upgrade is optional follow-up, not a proven remedy |

GitHub issue searches covered `deploying`, `503`, `block_height`, `Monad`, `cloud`, and `tsx`; discussions were checked for deployment/source failures. Some initial unauthenticated search requests returned 403; subsequent narrower searches succeeded. **No directly matching, confirmed Envio incident or maintainer diagnosis for these four deployments was found.** This is a bounded public search, not proof that no incident exists. The general troubleshooting page still contains older `generated/` and Node 22 guidance; for v3, prefer the versioned runtime/schema and current Cloud deployment requirements. [S9–S15]

## Exact proposed changes and verification

These are recommendations for a later implementation/deployment task. They were not applied to either Cloud project or the source branch.

### 1. Restore the default HyperSync configuration

Delete only this block from `indexer/config.yaml`:

```diff
 chains:
   - id: 10143
     start_block: 71189277
-    rpc:
-      - url: https://testnet-rpc.monad.xyz
-        for: sync
-        # Monad's public RPC caps eth_getLogs at 100 blocks.
-        initial_block_interval: 100
-        interval_ceiling: 100
     contracts:
```

Preserve all existing addresses, events, start block, schema, and the `bondrail-next` name. No explicit HyperSync URL or personal API token is required for Cloud. Alternatively, if operationally justified, `for: fallback` preserves HyperSync as primary, but a public RPC fallback is not needed to diagnose this startup failure.

The generator already defaults to HyperSync when `MONAD_RPC` is unset. If regenerating instead of editing YAML, run it **locally in the full repo** with `BONDRAIL_DEPLOYMENT=next`, `MONAD_RPC` unset, and the intended output/registry environment; existing outputs require its explicit `--force` flag. Review the resulting addresses and `src/deployment.ts` before any future commit. Do not run `config:testnet` in Cloud's isolated uploaded folder.

### 2. Fix the test fixture blocks

In **both** `indexer/test/credit.test.ts` and `indexer/test/settlement.test.ts`:

```diff
-const block = { number: 70_000_000, timestamp: 1_800_000_000, hash: `0x${'cd'.repeat(32)}` };
+const block = { number: 71_189_277, timestamp: 1_800_000_000, hash: `0x${'cd'.repeat(32)}` };
```

This is the minimal fix verified against the current deployment. For future generated start-block changes, derive fixtures from the configured start or use a dedicated test config. Do not lower the production start block just to accommodate tests. Retain `test`, `tsx`, `test/**`, and `src/handlers/bondrail.ts`.

### 3. Confirm the Cloud inputs and validate

Expected settings: repository `calledAdo/bondrail`, release branch `envio-next`, root/indexer directory `indexer`, **config path `config.yaml` relative to that root**, exact Envio version 3.14.0, and entrypoint `pnpm start` → `envio start`. `indexer/config.yaml` as the config path would be wrong when the root is already `indexer`.

For the proposed source patch, run in `indexer/` with supported Node and pnpm 10.32.0:

```sh
pnpm exec envio codegen
pnpm exec tsc --noEmit
pnpm exec envio config view
pnpm test
```

Do not infer successful service startup from these checks. After an owner-authorized deployment, verification must also establish:

1. Build logs show the intended commit, uploaded root, install result, Node/pnpm versions, and launch command. Determine whether tests run.
2. Runtime logs show successful handler loading, database initialization, and source requests. If absent again, escalate the missing logs alongside deployment state.
3. Query the **deployment-specific endpoint returned by the CLI**, then the intended production endpoint. Require HTTP 200 **and no GraphQL `errors`**.
4. Query `chain_metadata` twice: `chain_id=10143`, `start_block=71189277`, positive/current `block_height`, `latest_processed_block >= start_block` and advancing toward head, and ultimately `is_hyper_sync=true` for the default source. Known factory events should produce entities; do not rely only on a dashboard percentage.
5. Compare progress to public chain height/time. A frozen source height can falsely appear synced; use progress-block time/metrics when available. A raw health response alone is insufficient.

Suggested GraphQL body (the compatibility view is implemented in v3.14.0):

```json
{
  "query": "{ chain_metadata { chain_id start_block block_height latest_fetched_block_number latest_processed_block num_events_processed is_hyper_sync } Issuer(limit: 5) { id } Bond(limit: 5) { id } }"
}
```

If the same zero-initialized metadata / 503 persists after successful Cloud startup checks, stop changing source selection and ask Envio to diagnose the deployment infrastructure. This report does not authorize redeploying or deleting anything.

## Cloud CLI: confirmed, authentication boundary, exact owner commands

It is **`envio-cloud`**, a separate npm package, not `envio cloud`. The registry's published version was **1.0.0**. I downloaded its public package and platform binary into `/private/tmp` and ran only version/help commands:

```text
envio-cloud 1.0.0
commit: 2bea4b5550f31b3ad3ed427636fde637f9736310
built: 2026-08-13T14:30:14Z
```

Actual help confirms `deployment status`, `metrics`, `info`, `endpoint`, and `logs`; **all require authentication**, including metrics. `logs` supports `--build`, `--since`, `--level`, `--limit`, and `-o json`. The docs still label the CLI alpha and say metrics need no authentication; that differs from the published 1.0.0 binary. Follow the binary for these commands. `info` reports aggregator configuration, so do not assume it contains container diagnostics. [S16]

I stopped at help. No login, token inspection, or authenticated status/log request was attempted.

Owner commands, using `calledAdo` as the expected personal organisation; replace it with the actual organisation ID if different:

```sh
# The owner performs this login; the research agent did not.
npx --yes envio-cloud@1.0.0 login

ENVIO_DIAG_ORG='calledAdo'
ENVIO_DIAG_INDEXER='bondrail-next'
ENVIO_DIAG_COMMIT='65b9682'

npx --yes envio-cloud@1.0.0 indexer list --org "$ENVIO_DIAG_ORG" -o json
npx --yes envio-cloud@1.0.0 indexer get "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_ORG" -o json
npx --yes envio-cloud@1.0.0 indexer settings get "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_ORG" -o json
npx --yes envio-cloud@1.0.0 deployment status "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_COMMIT" "$ENVIO_DIAG_ORG" -o json
npx --yes envio-cloud@1.0.0 deployment metrics "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_COMMIT" "$ENVIO_DIAG_ORG" -o json
npx --yes envio-cloud@1.0.0 deployment info "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_COMMIT" "$ENVIO_DIAG_ORG" -o json
npx --yes envio-cloud@1.0.0 deployment logs "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_COMMIT" "$ENVIO_DIAG_ORG" --build --since 24h --limit 100 -o json
npx --yes envio-cloud@1.0.0 deployment logs "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_COMMIT" "$ENVIO_DIAG_ORG" --since 12h --limit 100 -o json
npx --yes envio-cloud@1.0.0 deployment endpoint "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_COMMIT" "$ENVIO_DIAG_ORG"
```

Repeat the deployment commands with `ENVIO_DIAG_COMMIT` set to `a200609`, `42d03c0`, and `3d91cba` if those deployments are still retained. Use the exact slug from `indexer list`, rather than a display name. The wider runtime lookback matters: the default is only 30 minutes and could omit the original startup failure; build logs default to 24 hours. For a later investigation, adjust `--since` to include the deployment time (binary caps runtime at 7 days / build at 30 days).

To probe the resolved deployment endpoint, after the owner's login:

```sh
ENVIO_DIAG_ENDPOINT="$(npx --yes envio-cloud@1.0.0 deployment endpoint "$ENVIO_DIAG_INDEXER" "$ENVIO_DIAG_COMMIT" "$ENVIO_DIAG_ORG")"
curl --max-time 30 -i "$ENVIO_DIAG_ENDPOINT" \
  -H 'Content-Type: application/json' \
  --data '{"query":"{ chain_metadata { chain_id start_block block_height latest_processed_block num_events_processed is_hyper_sync } }"}'
```

These are login plus read-only diagnostics, with no deployment/restart/settings mutations. Capture response headers/body, endpoint URL, timestamp, and CLI errors. Do not replace the endpoint with a guessed cluster hostname.

## Support-ready summary

> **Subject:** New Development indexer cannot start/serve reliably; existing indexer on same repo/version/network works
>
> Repository: `github.com/calledAdo/bondrail`. Existing working project: Slice, branch `envio`, root `indexer`, Envio 3.14.0, Development plan, Monad testnet 10143, HyperSync. New failing project: bondrail-next, branch `envio-next`, same root/version/plan/network. Created 2026-10-15.
>
> Four attempts: `3d91cba` Deploying ~37 minutes without logs/endpoint; `a200609` Active but GraphQL chain metadata remained `block_height=0`, `latest_processed_block=-1`, UI showed RPC despite no RPC config; `42d03c0` with explicit public RPC stayed Deploying; `65b9682` Active but Events Processed “–”, logs stuck Loading, GraphQL HTTP 503. These are owner observations; please correlate with your deployment records.
>
> Local v3.14.0 codegen, full typecheck, native handler loading, startup handler typecheck, and all 32 registrations pass. v3.14.0 initializes metadata to height 0 / processed -1 / `is_hyper_sync=false`, so the apparent RPC label may be initial metadata rather than actual source selection. Removing the RPC override resolves `https://10143.hypersync.xyz`. Public HyperSync height advanced from 71,218,821 at 09:39 UTC to 71,220,000 at 09:45 UTC; public RPC was within five blocks at the first probe. No personal HyperSync token should be required on Cloud.
>
> One local defect: test fixtures at block 70,000,000 fail against start block 71,189,277; changing both fixture blocks gives 9/9 passing tests. Please confirm whether your build pipeline runs `pnpm test`; checked-in startup is only `envio start`.
>
> Please inspect the upload/build/provisioning stage, actual image and Node/pnpm versions, launch command, process exit/restart reasons, database readiness, managed HyperSync access, and GraphQL upstream/routing for this project. Please also explain Active without a serving endpoint and unavailable build/runtime logs, and confirm quota/capacity state. A cluster-wide incident is not established; this may be specific to this project's provisioning. No project changes were made during research.

Attach the real organisation/project/deployment IDs, full deployment URLs, exact UTC failure times, endpoint response headers/body, and authenticated CLI outputs. Ask support for a concrete fault/recovery action before another speculative source or project change. Nothing was sent to support by this task.

## Sources and reproducibility

All web sources accessed 2026-10-15. GitHub source links below are pinned to **v3.14.0**; documentation is the current published site, so version-specific differences are identified above.

- **S1:** [Initial metadata and compatibility view](https://github.com/enviodev/hyperindex/blob/v3.14.0/packages/envio/src/db/InternalTable.res), especially `Chains.initialFromConfig` and `makeChainMetadataViewQuery`; [active-source metadata](https://github.com/enviodev/hyperindex/blob/v3.14.0/packages/envio/src/ChainState.res), `toChainMetadata`.
- **S2:** [CLI reference](https://docs.envio.dev/docs/HyperIndex/cli-commands); [restricted config-view serialization](https://github.com/enviodev/hyperindex/blob/v3.14.0/packages/cli/src/config_parsing/public_config.rs), `to_view_json`; [start/codegen execution](https://github.com/enviodev/hyperindex/blob/v3.14.0/packages/cli/src/executor/mod.rs).
- **S3:** [v3 config schema reference](https://docs.envio.dev/docs/HyperIndex/config-schema-reference#handlers), [event handlers](https://docs.envio.dev/docs/HyperIndex/event-handlers), [versioned handler loader](https://github.com/enviodev/hyperindex/blob/v3.14.0/packages/envio/src/HandlerLoader.res).
- **S4:** [Dynamic contract registration](https://docs.envio.dev/docs/HyperIndex/dynamic-contracts).
- **S5:** [RPC source reference](https://docs.envio.dev/docs/HyperIndex/rpc-sync), [Rpc schema](https://docs.envio.dev/docs/HyperIndex/config-schema-reference#def-rpc), [versioned source selection](https://github.com/enviodev/hyperindex/blob/v3.14.0/packages/cli/src/config_parsing/system_config.rs), `default_rpc_for` / `DataSource::from_evm_network_config`.
- **S6:** [HyperIndex networks](https://docs.envio.dev/docs/HyperIndex/supported-networks), [HyperSync networks](https://docs.envio.dev/docs/HyperSync/hypersync-supported-networks), [Cloud token exemption](https://docs.envio.dev/docs/HyperSync/api-tokens), [versioned chain registry](https://github.com/enviodev/hyperindex/blob/v3.14.0/packages/cli/src/config_parsing/chain_helpers.rs), [HyperSync troubleshooting](https://docs.envio.dev/docs/HyperSync/troubleshooting).
- **S7:** [Cloud deployment requirements, limits and workflow](https://docs.envio.dev/docs/HyperIndex/hosted-service-deployment), [billing](https://docs.envio.dev/docs/HyperIndex/hosted-service-billing).
- **S8:** [Cloud troubleshooting: uploads, dependencies and lockfiles](https://docs.envio.dev/docs/HyperIndex/envio-cloud-troubleshooting), [configuration](https://docs.envio.dev/docs/HyperIndex/configuration-file), [v3 migration](https://docs.envio.dev/docs/HyperIndex/migrate-to-v3).
- **S9:** [#1666 root version detection](https://github.com/enviodev/hyperindex/issues/1666), [#1667 start command](https://github.com/enviodev/hyperindex/issues/1667), [#1668 pnpm engine](https://github.com/enviodev/hyperindex/issues/1668), [#575 build command](https://github.com/enviodev/hyperindex/issues/575).
- **S10:** [v3.14.0 release](https://github.com/enviodev/hyperindex/releases/tag/v3.14.0), [#1558 native TS loader](https://github.com/enviodev/hyperindex/pull/1558), [#1680 pnpm ignored-build behavior](https://github.com/enviodev/hyperindex/pull/1680).
- **S11:** [v3.14.1 release](https://github.com/enviodev/hyperindex/releases/tag/v3.14.1), [v3.13.0 release](https://github.com/enviodev/hyperindex/releases/tag/v3.13.0), [v3.12.0 release](https://github.com/enviodev/hyperindex/releases/tag/v3.12.0).
- **S12:** [#1671 stale-source progress](https://github.com/enviodev/hyperindex/issues/1671), [#1225 readiness vs health](https://github.com/enviodev/hyperindex/issues/1225), [#1691 TUI searching label](https://github.com/enviodev/hyperindex/issues/1691).
- **S13:** [Discussion #763: HyperSync failure and recovery](https://github.com/enviodev/hyperindex/discussions/763).
- **S14:** [Common issues](https://docs.envio.dev/docs/HyperIndex/common-issues), [Cloud monitoring](https://docs.envio.dev/docs/HyperIndex/hosted-service-monitoring).
- **S15:** [GitHub issues](https://github.com/enviodev/hyperindex/issues), [discussions](https://github.com/enviodev/hyperindex/discussions), [release history](https://github.com/enviodev/hyperindex/releases). Search scope and limitations are stated above.
- **S16:** [Cloud CLI docs](https://docs.envio.dev/docs/HyperIndex/envio-cloud-cli), [published npm metadata](https://registry.npmjs.org/envio-cloud/1.0.0), plus locally executed 1.0.0 `--help`, `deployment logs --help`, `status --help`, `metrics --help`, `info --help`, `endpoint --help`, and `indexer settings get --help`.

To reproduce the handler-only startup audit without Docker, save the following as a temporary `.mjs` file and run `node /path/to/audit.mjs` **with `indexer/` as the working directory**. It uses v3.14.0 internals, not a stable public validation API. Running a real file also avoids passing `--input-type=module` into Envio's typechecker worker.

```js
import { pathToFileURL } from 'node:url';
const base = pathToFileURL(`${process.cwd()}/node_modules/envio/src/`);
const Config = await import(new URL('Config.res.mjs', base));
const Loader = await import(new URL('HandlerLoader.res.mjs', base));
const config = Config.load();
const files = await Loader.getAutoLoadFiles(config);
console.log('Handlers:', files);
await Loader.typeCheck(config, files);
const registrations = await Loader.registerAllHandlers(config, files);
for (const [chain, result] of Object.entries(registrations)) {
  for (const r of result.onEventRegistrations) {
    console.log(chain, r.eventConfig.contractName, r.eventConfig.name,
      { handler: !!r.handler, contractRegister: !!r.contractRegister });
  }
}
```

Temporary evidence on the research machine (not required to understand this report and not committed): `/private/tmp/envio-task12-docs/`, `envio-task12-tests.log`, `envio-task12-tests-fixed.log`, `envio-task12-handler-audit.mjs`, `envio-task12-handler-audit.log`, `envio-task12-handler-audit-hypersync.log`, and the public probe JSON files with the same prefix. Temporary source/candidate copies: `/private/tmp/hyperindex-3.14.0/` and `/private/tmp/envio-task12-project/`.
