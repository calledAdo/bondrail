# Bondrail indexer

Envio HyperIndex indexes protocol logs and block timestamps. **Handlers never call chain RPCs
or perform network I/O.** All indexed state must be reproducible from events. This also works
on Envio Cloud's free plan without custom environment variables or an archive RPC.

```sh
pnpm install --frozen-lockfile
pnpm codegen
pnpm typecheck
pnpm test
```

Run these commands from `indexer/`. Generate configuration from the selected deployment using
`node gen-config.mjs 10143 --force`; review the diff before any separately authorized release.
Keep the inception start block and legacy vault address to retain the complete accounting history.

`pnpm test` runs all simulated event suites with fetch, TCP and UDP blocked. A TypeScript AST guard
checks every file under `src/` and follows local imports: only the Envio framework import is allowed,
with no effects, RPC clients, network APIs or dynamic module loading. The network-effect allow-list
is empty. Viem is a dev dependency used only to construct test addresses.

See [Vault history](VAULTS.md) for accounting, schema changes and migration requirements. Live
valuation belongs in the web app, using current-block RPC reads. Indexer history is not NAV.
