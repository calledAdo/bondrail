# Bondrail web

Production: https://bondrail.vercel.app, branch `main`, Monad testnet 10143.
The current contracts are in `../../docs/deployments/10143.json`.
`BONDRAIL_DEPLOYMENT=main` is the default; named deployments remain supported.
The docs address table reads the selected manifest at build time.

Install from the workspace root, copy `.env.example` to `.env.local`, then run
`pnpm dev`. The example contains current public production addresses and the
Envio endpoint. For local development, follow the root README and generate the
matching environment with `scripts/export-env.ts web`. Keep chain, factory,
asset, vault, registry and indexer consistent. Never put provider secrets or keys
in `NEXT_PUBLIC_*` values.

Markets, account pages, bond details, portfolio and the issuer console read
configured contracts and indexer data. Wallet writes are restricted to chain 10143
and local 31337; actions simulate before requesting signatures and verify receipts.
Claims and monetary values use BigInt/decimal strings. Signed profiles and market
records use server-side Redis; the in-memory fallback is for local development.
Optional Nansen screening and the gas drip use server-only credentials.

`/vault` is read-only. It shows entry/exit NAV and prices, idle assets, unvested
income, holdings, impairment, limits and curator state directly at a single block.
It refreshes every 30 seconds without a wallet or indexer. Missing configuration
shows an unavailable state, and failed refreshes identify the last successful block.
The current production vault is configured in `.env.example`.

Account credit profiles separate onchain counters, repayment coverage, signed
assessments and unsigned estimates. Current-signer validity, expiry and the 64-bond
coverage bound are evaluated from registry state. The current registry is configured
in `.env.example`; stale or incomplete assessments are explicitly labelled.

The production indexer is Envio project `bondrail-next`, release branch **envio-next**.
Keep that release branch unchanged when updating the app. Archived judged contracts
are documented separately and require their historical ABIs.

Run `pnpm check:all` and `pnpm e2e:local` from the repository root before submitting
changes. The E2E builds the app with isolated local addresses and exercises markets,
vault and credit views in Chromium.
