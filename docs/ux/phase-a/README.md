# Frontend Phase A

Local Task 21 changes on `next`. No push, tags, publication, deployment, remote configuration/resource changes or transactions.

## Findings and behavior

The live landing query succeeds against the manifest's current Envio deployment. `Issuer`, `Bond` and their fields still match the schema. The zero values came from `Ticker`: it rendered literal zero until an intersection observer started its count-up animation. Headless Chrome reproduced zero **before scrolling**, followed by the correct values after scrolling into view. Values now render directly when data arrives, including offscreen and with reduced motion.

The captured public response contains three accounts/bonds, two Active bonds, 58 booked payments, `464494` base units of revenue and `77500` base units collected for investors. With six decimals these display as **$0.46 / 58 / $0.08 / 2**. Actual `Bond.redeemed` values were zero, so the pool-allocation label is now **Collected for investors**. Native PumpLab's pool was zero and Oracle Agent's pool was `77500` at capture. These are observations of the supplied public endpoint, not assumptions about production balances.

Dollar totals include only the configured USD asset, compared case-insensitively. Counts cover all indexed accounts/bonds. Profiles do not gate aggregation; unrelated assets and unknown-account receipts cannot be displayed as dollars. The old schema fallback that could omit asset identity was removed. A fixture test uses the captured GraphQL response shape and values.

Native source labels read `nativeApproved`, `templateOf` and `nativeTemplate` from the factory. A revoked template can still be authorized by independent individual approval; failed reads remain unknown. Funding deposits remain primary, listed Active bonds retain the existing Kuru buy flow, unlisted Active bonds have no primary investment action, and Closed redemption remains primary without the early warning.

Active/Closing early redemption is secondary and opens a native modal. It shows exact cash based on `claims × pool / supply`, the selected claim amount, estimated additional revenue and estimated total if held. It requires acknowledgement, resets consent for a changed quote/wallet/amount, checks balances and the last-holder restriction, and preserves simulation before any write. Closing projects no new revenue because collection has ended. Estimates use the existing SDK yield helper, current share, remaining cap and attributed daily rate; they exclude potential future capital/stake recovery and are not guarantees.

Funding par yield uses the planned full raise, initial release cap, and funding-deadline-to-maturity horizon, so zero/partial funding does not produce missing or inflated returns. Assumptions are visible in the panel. Without a Kuru market, non-Funding pages show one explanatory line.

Permissionless controls are inside closed-by-default **Maintenance (anyone can run)**. `ops-status` prefers its explicit health URL, otherwise uses the facilitator bind host/port, with the existing `127.0.0.1:8789` fallback. Production's `172.18.0.1` host is documented.

## Evidence

| Page | Desktop (1440 × 1000 viewport) | Mobile (375 × 844 viewport) |
| --- | --- | --- |
| Landing | [Screenshot](landing-desktop.png) | [Screenshot](landing-mobile.png) |
| Funding: CurveLab | [Screenshot](funding-desktop.png) | [Screenshot](funding-mobile.png) |
| Active: Oracle Agent | [Screenshot](active-desktop.png) | [Screenshot](active-mobile.png) |
| Active confirmation open | [Screenshot](active-confirmation-desktop.png) | [Screenshot](active-confirmation-mobile.png) |

Page screenshots use full-page capture; confirmation screenshots use the viewport so the dialog remains legible.

- [Every copy change](COPY-CHANGES.md).
- [Browser assertions and captured values](browser-results.json).
- [Reproducible read-only capture/check script](capture.mjs).
- [Public registry snapshot](registry-snapshot.json) supplies real names/listing metadata to the local app without configuring remote storage. This is captured external data, including issuer-written profile copy, not edited application copy.
- Aggregation fixture: `apps/web/src/lib/fixtures/live-indexer.json`.

Browser checks cover values before scrolling, Funding par yield and deposit priority, template labels, collapsed maintenance, secondary early redemption, exact cash, explicit acknowledgement, cancel/Escape, focus restoration, changed-amount consent reset, insufficient balance, excessive precision, last-holder protection and horizontal overflow. Closing and Closed checks use **synthetic browser-only phase overrides** on the real Oracle Agent response; the screenshots show actual Funding/Active data. The injected review wallet exposes the manifest's investor address and rejects all signing/sending methods. No transaction was attempted. No live Kuru listing was present; the existing listed-market buy flow was reviewed in source.

## Validation and reproduction

`pnpm check:all` passes, including `build:apps`: 149 Solidity tests, 187 workspace tests (9 web), 17 scripts tests, 9 indexer tests, all typechecks/codegen, SDK verification of 10 exports, contract package/source verification and 2 external-consumer tests, and both Next.js builds (agent: 5 pages; web: 31 pages). Existing dependency/build warnings remain (Fumadocs highlight CSS, tracing, Foundry lints and npm environment warnings).

Acceptance used `/private/tmp/bondrail-task21-check`, a clean copy of tracked/task source, to avoid the pre-existing ignored Next.js validator cache described in the prior handoff. Only public values from `apps/web/.env.example` were supplied. Logs are retained locally in ignored `llmtimeline/task21/`.

For browser reproduction, build `apps/web` with the public deployment values from `.env.example`, start it on loopback, and run from the repository root:

```sh
pnpm --filter @bondrail/web start --hostname 127.0.0.1 --port 3210
# In another terminal, with locally installed Chrome:
node docs/ux/phase-a/capture.mjs
```

The script uses live read-only indexer/RPC data and the included registry snapshot. Its fixed cash/count assertions describe the captured deployment; if revenue or holdings change, refresh those expectations from a read-only response. `PHASE_A_BASE_URL` may select another localhost port. Do not point this capture at a remote app.
