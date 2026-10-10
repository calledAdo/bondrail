# Frontend and listing: adopted recommendations (10 Oct 2026)

## Frontend
- One Next app, three route groups: `(site)` landing, `(docs)` Fumadocs under `/docs`, `(app)` markets/bonds/accounts/console/portfolio. Wallet providers load only in `(app)`.
- Demo code (`app/demo`, `api/demo/*`, `lib/demo-auth.ts`, `components/demo.tsx`) moves out of `apps/web` into `demo/`.
- Docs: Overview / Concepts / Guides (projects, investors) / Reference. Addresses, ABIs, schema and SDK reference are generated; every snippet is a real compiled file.

## Listing
- A listing is two objects: the **profile** (account, exists from the first payment) and the **offering** (bond). Closed bonds stay on the profile as track record.
- Marketplace tabs: Raising (Funding), Trading (Active/Closing, Kuru), Track record (accounts without a live bond, finished series).
- Trust layers: protocol gates (on-chain), evidence (computed for everyone), opinion (reviewer, Native code only). Slice does not approve businesses.
- Default view is evidence-filtered with a visible "show all": healthy source, valid signed profile, account age >= N, more than one payer.
- Investor metrics: multiple, coverage (verified trailing revenue x revenueBps x days to maturity / repayCap), est. payback, principal at risk now, Kuru price vs backingPerToken.
- Raw vs verified revenue shown side by side; verified excludes issuer-funded payers.
- Identity: EIP-712 profile signed by `account.issuer()`, stored in KV; offering notes commit to the `termsHash` in `BondCreated`; domain proof via `/.well-known/slice.json` (automatic for Watched agents).
- Contract hardening: `deposit` checks source health; minimum account age before `createBond`. Redeploy.
- Kuru market creation is an issuer step in `/console`.
- Console terms builder suggests a cap from verified revenue and warns below 1.2x coverage; validates `_validateTerms` client-side.
