# Contributing

Use Node.js **24** (`nvm use` reads `.nvmrc`), pnpm **10.32.0** (the root and indexer
`packageManager`), and Foundry **1.8.4** (`foundryup --install v1.8.4`). Put `forge` on
`PATH`; the Solidity package verifier also accepts `FORGE=/absolute/path/to/forge`.

## Run the CI checks locally

From the repository root:

```sh
pnpm check:all
```

This stops on the first failure and runs these commands in order:

```sh
pnpm install --frozen-lockfile
pnpm --dir indexer install --frozen-lockfile
pnpm contracts:check
pnpm check:typescript
pnpm sdk:verify
pnpm contracts:verify
pnpm build:apps
```

`contracts:check` runs `forge build --root contracts --sizes` then
`forge test --root contracts`. Tests use `contracts/foundry.toml` unchanged: 256 fuzz
runs, 128 invariant runs, depth 64, and `fail_on_revert = true`. All execute in the
local EVM without forks or public RPC requests.

**Formatting exception:** baseline commit `0a7c4ed` already fails
`forge fmt --check --root contracts` across existing sources and tests. CI and
`check:all` omit that gate. A dedicated formatting change should first format the
repository, then add the check to both `contracts:check` and the `contracts` job.
Do not turn a formatting failure into an unconditional success once the gate is enabled.

`check:typescript` expands to:

```sh
pnpm -r --if-present test
pnpm scripts:test
pnpm typecheck:all
pnpm --dir indexer test
```

`typecheck:all` covers every TypeScript workspace package, the root project,
`scripts/tsconfig.json`, `scripts/bench/tsconfig.json`, and the standalone indexer:

```sh
pnpm typecheck
pnpm exec tsc --noEmit
pnpm scripts:typecheck
pnpm exec tsc -p scripts/bench/tsconfig.json
pnpm --dir indexer codegen
pnpm --dir indexer typecheck
```

The indexer has its own workspace and lockfile; the root recursive commands do
not include it. Codegen reads the checked-in event signatures and schema locally;
tests use fixtures. Do not run `envio dev`, `envio start`, live RPC/HyperSync tests,
or deployment scripts as part of CI. Add local mocks or Anvil coverage for new
network-dependent behavior. No `.env` file, wallet, API token or CI secret is needed.

The package verifiers pack locally, install the tarballs in temporary consumers,
and check SDK imports and Solidity interfaces/behavior. Public registry downloads
are required; publishing and registry write credentials are not used. `build:apps`
runs production builds for both Next apps, including their generated route types.

`pnpm check` remains a narrower workspace check for quick iteration. Run
`check:all` before submitting a PR.

## GitHub Actions and merge checks

[CI](.github/workflows/ci.yml) runs on pushes and pull requests targeting `main`
or `next`, and can be dispatched manually once available on the default branch.
Superseded runs of the same event/ref are cancelled. All four jobs run independently,
with no path filters, secrets, deployment steps or write permissions. Checkout does
not persist credentials. Third-party actions are pinned to full commit SHAs, with
the release version beside each pin.

The [active CI ruleset](https://github.com/calledAdo/bondrail/rules/25195429)
requires all four GitHub Actions check names on **both** branches:

| Required check | Coverage | Expected warm / cold duration |
| --- | --- | --- |
| `contracts` | Solidity sizes, unit, fuzz and invariant tests | 1–3 / 3–7 min |
| `typescript` | Workspace/scripts tests, every TS project, indexer codegen and tests | 1–2 / 2–4 min |
| `packages` | SDK tarball imports, Solidity tarball and external consumer | 2–4 / 4–8 min |
| `apps` | Both production Next builds | 2–4 / 3–6 min |

These are estimates for GitHub-hosted Ubuntu runners; the first hosted run will
establish actual timings. With jobs in parallel, expect roughly 4–8 minutes total
on a cold run. Jobs time out after 15 minutes (10 for TypeScript). pnpm's store,
Foundry compiler/artifacts and both Next build caches are cached; caches never
replace a check. The indexer lockfile is included in the TypeScript store cache key.

A workflow file alone does **not** block merging. The repository's branch rules
must require `contracts`, `typescript`, `packages`, and `apps` from the GitHub
Actions app, require the branch to be up to date, and grant no bypass actors.
Keep these job names stable. A new rule can be bootstrapped by pushing these
commits to a PR source branch and opening a PR into `next`/`main`; the PR runs
the new workflow before merging it. Until the workflow reaches GitHub, its
required checks remain pending. Never add a deployment/publishing secret to CI.

The reviewable ruleset payload is [.github/required-checks.json](.github/required-checks.json).
It binds checks to the GitHub Actions app (ID `15368`), applies to both branches,
and has no bypass actors. Repository administrators manage this rule in
**Settings → Rules → Rulesets**; updating the JSON file alone does not change the
GitHub setting. CI itself has no permission to edit rules.

The retired Slice `covenant.yml` workflow was removed. Operational reporting uses
[`ops/bondrail-covenant.service`](ops/bondrail-covenant.service); `ci.yml` and
`check:all` never invoke it. See the [migration procedure](docs/deployments/MIGRATION-2026-10.md).

## Validate workflow changes

```sh
actionlint .github/workflows/ci.yml
# Optional, when act and Docker are available:
act -n pull_request
```

`act -n` checks the execution plan; it does not execute the checks. Run
`pnpm check:all` as well. Review updated action SHAs against their upstream release
tags, and keep the local scripts and job commands in sync.

## Deployment fixtures and local E2E

`BONDRAIL_DEPLOYMENT` defaults to `main`, selecting `docs/deployments/10143.json`
for production Monad testnet. Named deployments use `<chainId>-<name>.json`.
The archived `docs/deployments/archive/10143-slice-metropolis.json` is a read-only
judged reference and must never be regenerated. Match app addresses and indexer
configuration to the selected manifest. Envio production remains on `envio-next`.

Run `pnpm e2e:local` for the full local contract/payment/vault/attestation/browser
rehearsal. It owns `31337-e2e.json`, temporary keys and loopback services; both public
manifests are checked unchanged. Install Playwright Chromium with
`pnpm exec playwright install chromium` if Chromium/Chrome is unavailable.
This is separate from `check:all` and makes no testnet transactions.
