# Task 19 identifier audit

Scope: tracked working files after the production-default migration. Vendored
`contracts/lib` and this report are excluded from the counts. Ignored build/cache
outputs, local credentials and `llmtimeline` are not product source. No remote
resources were queried or changed. The operator's production state dated 2026-10-16
is the source for retained endpoint/project names.

## Commands and results

```sh
git grep -n -i slice -- ':!contracts/lib' ':!docs/deployments/IDENTIFIER-AUDIT.md'
git grep -n -i -E '10143-next|31337-next|BONDRAIL_DEPLOYMENT.{0,4}next|bondrail-next|envio-next|next (deployment|manifest)|next-source|ops/next|report-next' -- ':!contracts/lib' ':!docs/deployments/IDENTIFIER-AUDIT.md'
git grep -n -E '@slice/|SLICE_|Slice[A-Z][a-zA-Z]*|[.]well-known/slice[.]json' -- apps scripts services packages demo/agent demo/scripts contracts/src contracts/test cre indexer examples
```

The last scan returns **zero matches**. Solidity remappings were already
`@bondrail/` and `@bondrail-demo/`; no remapping change was necessary. The legacy
agent document route was removed. Active key defaults now use `~/.bondrail`.
Media generation helpers also use Bondrail paths; no original exports were renamed.

The broad scans return **163 matching lines in 71 files** for `slice`,
and **132 matching lines in 21 files** for the deployment-oriented `next` pattern.
Counts are matching lines, not occurrences; one line can contain several names.

## Remaining `slice` matches

| Reason | Lines |
| --- | ---: |
| Historical records, evidence, designs or media provenance | 76 |
| Archive links/protection or retired-service/Envio explanation | 11 |
| Ordinary word: portion of revenue, pool, or graphic | 7 |
| Language/library method | 52 |
| Old-to-new migration inputs and retired-service explanation | 6 |
| Unmodified judged manifest | 5 |
| Third-party slice-ansi dependency | 6 |

The archive matches the pre-task `10143.json` exactly:
`sha256:4492e96c5005077416b09fe98ad3380a69c6c6826f2c3c91855c89d0dd85ab84`.
Its retired URLs and original policy/parser strings identify the judged deployment;
rewriting them would falsify that reference. The current loader never selects it.

`BUILD_LOG.md`, old benchmarks and validation reports, research snapshots,
`docs/demo-production-plan.md`, the financing-history implementation plan, archived
rollout runbook and recorded-media descriptions retain the names used when written.
Brand documents explain historical footage. `docs/deployments/FACILITATOR-GAS.md`
records an old credential-path non-access statement. The migration guide must name
old paths to migrate them. No current guide points users at a deleted web or agent URL.

The six lockfile matches are the unrelated `slice-ansi` npm dependency. Standard
`.slice()` calls and descriptive uses of “slice” are not product identifiers.

### Complete file inventory

| File | Matching lines | Reason(s) |
| --- | ---: | --- |
| `BUILD_LOG.md` | 2 | Historical records, evidence, designs or media provenance |
| `CONTRIBUTING.md` | 2 | Archive links/protection or retired-service/Envio explanation |
| `README.md` | 1 | Archive links/protection or retired-service/Envio explanation |
| `RELEASING.md` | 1 | Archive links/protection or retired-service/Envio explanation |
| `apps/web/DESIGN.md` | 2 | Ordinary word: portion of revenue, pool, or graphic |
| `apps/web/content/docs/reference/deployments.mdx` | 1 | Archive links/protection or retired-service/Envio explanation |
| `apps/web/src/app/api/nansen/route.ts` | 1 | Language/library method |
| `apps/web/src/app/api/registry/route.ts` | 2 | Language/library method |
| `apps/web/src/components/app/bond-actions.tsx` | 1 | Language/library method |
| `apps/web/src/components/app/console.tsx` | 2 | Language/library method |
| `apps/web/src/components/app/credit-profile.tsx` | 2 | Language/library method |
| `apps/web/src/components/app/details.tsx` | 5 | Language/library method |
| `apps/web/src/components/app/shell.tsx` | 1 | Language/library method |
| `apps/web/src/components/app/trade.tsx` | 2 | Language/library method |
| `apps/web/src/components/app/ui.tsx` | 1 | Language/library method |
| `apps/web/src/components/docs.tsx` | 4 | Language/library method |
| `apps/web/src/components/site/hero.tsx` | 1 | Ordinary word: portion of revenue, pool, or graphic |
| `apps/web/src/components/site/sections.tsx` | 1 | Language/library method |
| `apps/web/src/components/site/split.tsx` | 1 | Ordinary word: portion of revenue, pool, or graphic |
| `apps/web/src/lib/protocol.ts` | 1 | Language/library method |
| `apps/web/src/styles/site.css` | 1 | Ordinary word: portion of revenue, pool, or graphic |
| `brand/bondrail/MESSAGING.md` | 1 | Historical records, evidence, designs or media provenance |
| `brand/bondrail/README.md` | 3 | Historical records, evidence, designs or media provenance |
| `contracts/test/Vault.t.sol` | 1 | Ordinary word: portion of revenue, pool, or graphic |
| `demo/scripts/demo-default.ts` | 1 | Language/library method |
| `demo/scripts/erc8004.ts` | 2 | Language/library method |
| `demo/scripts/kuru-market.ts` | 2 | Language/library method |
| `demo/scripts/kuru-trade.ts` | 1 | Language/library method |
| `demo/scripts/setup-demo.ts` | 1 | Language/library method |
| `demo/scripts/traffic-agent.ts` | 2 | Language/library method |
| `demo/scripts/traffic-launchpad.ts` | 1 | Language/library method |
| `demo/video/PRESENTATION-DIRECTION.md` | 1 | Ordinary word: portion of revenue, pool, or graphic |
| `demo/video/README.md` | 6 | Historical records, evidence, designs or media provenance |
| `demo/video/capture-cre.mjs` | 1 | Language/library method |
| `demo/video/capture-technical.mjs` | 2 | Language/library method |
| `demo/video/capture.mjs` | 3 | Language/library method |
| `demo/video/cre-preflight.mjs` | 1 | Language/library method |
| `docs/bench/gas-baseline.txt` | 8 | Historical records, evidence, designs or media provenance |
| `docs/bench/task05-payment-gas.txt` | 6 | Historical records, evidence, designs or media provenance |
| `docs/bench/task05-validation.md` | 5 | Historical records, evidence, designs or media provenance |
| `docs/bench/validation.md` | 6 | Historical records, evidence, designs or media provenance |
| `docs/credit/VALIDATION.md` | 5 | Historical records, evidence, designs or media provenance |
| `docs/demo-production-plan.md` | 5 | Historical records, evidence, designs or media provenance |
| `docs/deployments/ENVIO-NEXT-DIAGNOSIS.md` | 4 | Historical records, evidence, designs or media provenance |
| `docs/deployments/FACILITATOR-GAS.md` | 1 | Historical records, evidence, designs or media provenance |
| `docs/deployments/MIGRATION-2026-10.md` | 6 | Old-to-new migration inputs and retired-service explanation |
| `docs/deployments/NEXT-VALIDATION.md` | 1 | Historical records, evidence, designs or media provenance |
| `docs/deployments/RUNBOOK.md` | 3 | Archive links/protection or retired-service/Envio explanation |
| `docs/deployments/archive/10143-slice-metropolis.json` | 5 | Unmodified judged manifest |
| `docs/deployments/archive/NEXT-RUNBOOK.md` | 2 | Historical records, evidence, designs or media provenance |
| `docs/deployments/archive/README.md` | 1 | Archive links/protection or retired-service/Envio explanation |
| `docs/plans/bondrail-financing-history-implementation.md` | 1 | Historical records, evidence, designs or media provenance |
| `docs/research/bondrail-execution-roadmap-2026-10-14.md` | 1 | Historical records, evidence, designs or media provenance |
| `docs/research/bondrail-product-strategy-2026-10-13.md` | 4 | Historical records, evidence, designs or media provenance |
| `docs/research/evidence/2026-10-14/snapshot.json` | 1 | Historical records, evidence, designs or media provenance |
| `docs/task08/VALIDATION.md` | 7 | Historical records, evidence, designs or media provenance |
| `docs/vault/VALIDATION.md` | 7 | Historical records, evidence, designs or media provenance |
| `indexer/gen-config.mjs` | 1 | Language/library method |
| `ops/README.md` | 1 | Archive links/protection or retired-service/Envio explanation |
| `packages/contracts/scripts/verify-pack.mjs` | 1 | Language/library method |
| `packages/sdk/scripts/generate-abis.ts` | 1 | Language/library method |
| `packages/sdk/scripts/verify-pack.mjs` | 1 | Language/library method |
| `pnpm-lock.yaml` | 6 | Third-party slice-ansi dependency |
| `scripts/bench/parallel.ts` | 1 | Language/library method |
| `scripts/dev-indexer.ts` | 1 | Language/library method |
| `scripts/e2e-local.ts` | 2 | Archive links/protection or retired-service/Envio explanation; Language/library method |
| `scripts/service.ts` | 1 | Language/library method |
| `services/attester/src/main.ts` | 1 | Language/library method |
| `services/facilitator/test/facilitator.test.ts` | 1 | Language/library method |
| `services/observer/src/auth.ts` | 1 | Language/library method |
| `services/worker/src/main.ts` | 1 | Language/library method |

## Remaining deployment-oriented `next` matches

There are **no active `BONDRAIL_DEPLOYMENT=next` defaults, `10143-next.json` consumers,
`ops/next` paths or `report-next.ts` calls**. Named deployments still work generically;
unit fixtures use `staging`, the isolated rehearsal uses `e2e`, and production uses
`main`/`10143.json`.

| Files / identifiers | Why retained |
| --- | --- |
| `10143.json`, observer registry, CRE config, agent registration, ERC-8004/profile helpers, env exporter; live URL tables | The agent and facilitator retain their existing `bondrail-next` hostnames. Changing those would require remote resources outside this task. |
| README, CONTRIBUTING, RELEASING, web/indexer docs, ops/runbook, generator comment | Production Envio project **bondrail-next**, release branch **envio-next** and endpoint `…/1ac5720/v1/graphql` remain unchanged. |
| `MIGRATION-2026-10.md` | Exact old unit/env/path names are needed for migration and rollback. Existing `bondrail-10143-next` storage namespace is preserved to prevent journal/lock loss. |
| `archive/NEXT-RUNBOOK.md`, `NEXT-VALIDATION.md`, `ENVIO-NEXT-DIAGNOSIS.md` | Historical rollout, local-test evidence and cloud-diagnosis records; the old runbook is clearly marked superseded. |
| Agent README “Next deployment” | Refers to the Next.js framework, not a deployment selector. |

Other ordinary `next` matches outside this deployment-oriented scan are Next.js
packages/build directories, CI and Git source branch `next`, variable/parameter names
(e.g. CAS `next` or `proposeAttester(next)`), and prose describing a next step. These
are not live deployment names and were retained.

## Validation

Final acceptance used Node **24.22.0**, pnpm **10.32.0** and Foundry **1.8.4** in a
clean source copy at `/private/tmp/bondrail-task19-check`, excluding ignored env files,
keys and existing build artifacts. The tested executable source matches the final tree.

- `pnpm check:all`: **PASS** — 149 Solidity tests; 182 workspace tests; 6 scripts tests;
  9 indexer tests; all typechecks/codegen; SDK's 10 plain-Node entry points; 10 byte-identical
  Solidity package sources and 2 external consumer tests; agent/web production builds.
- `pnpm e2e:local`: **PASS, 10 checks** — local deployment and overwrite protection,
  Native/x402 settlement/replay, Watched activation, trigger and vault accounting, reruns,
  attestation/evidence, browser markets/vault/credit, and both public manifest hashes.
- Built default deployment docs contain the current factory/vault/registry, without the
  judged factory. The promoted manifest differs from its predecessor only by `deployment`.
- `actionlint .github/workflows/ci.yml`, migration shell syntax, unit/timer/script path
  consistency, changed JS/Python helper syntax and `git diff --check`: **PASS**.

The first E2E attempt exposed an existing local-adapter readiness problem: each probe
started a full chain snapshot, exceeding its deadline under the production RPC pace and
queuing further scans. The adapter now has `/health`; the rehearsal explicitly uses
100 RPS on its private Anvil endpoint. Production limits and correctness assertions were
unchanged. The final full check ran again after this fix and passed.

Existing Foundry lint, Next CSS/tracing and package-manager notices remain nonfatal.
No live service or systemd cutover was tested. The migration guide assumes Caddy's
standard config path, includes an Nginx alternative, and requires measured queue/client
latency conditions for zero rejected requests. No push, tags, publish, deployment,
remote settings/resource changes or external service messages occurred.

Raw logs and browser artifacts are retained locally under `llmtimeline/task19/` (ignored).
