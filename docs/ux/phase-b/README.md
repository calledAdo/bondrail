# Frontend Phase B — bond decisions

The bond page now reads in decision order: summary and phase action, lifecycle, purchase scenarios, evidence, concrete loss scenarios, actions, then collapsed full terms. Existing tokens, `Panel`, mono/tabular figures, themes and Phase A early-redemption safeguards are retained. Maintenance stays collapsed. Closing exposes settlement timing without an investor transaction.

## Screenshots

All captures use headless Chrome, reduced motion, and the actual page components. Mobile is **375 × 844**; desktop is **1280 × 960**. Images are full-page unless noted. Live views use public Monad testnet RPC/indexer data and the public signed-profile registry response saved in `registry-snapshot.json`. Synthetic views are labelled on the page, use `bond-fixtures.ts`, and mock RPC reads in the browser. No transaction is signed or sent.

| Bond / phase | 375 px | 1280 px |
|---|---|---|
| Live PumpLab | [Mobile](live-pumplab-375.png) | [Desktop](live-pumplab-1280.png) |
| Live CurveLab | [Mobile](live-curvelab-375.png) | [Desktop](live-curvelab-1280.png) |
| Live Oracle Agent | [Mobile](live-agent-375.png) | [Desktop](live-agent-1280.png) |
| Funding | [Mobile](fixture-funding-375.png) | [Desktop](fixture-funding-1280.png) |
| Funding, paused | [Mobile](fixture-funding-paused-375.png) | [Desktop](fixture-funding-paused-1280.png) |
| Active, no market | [Mobile](fixture-active-375.png) | [Desktop](fixture-active-1280.png) |
| Active, triggered | [Mobile](fixture-active-triggered-375.png) | [Desktop](fixture-active-triggered-1280.png) |
| Active, defaulted | [Mobile](fixture-active-defaulted-375.png) | [Desktop](fixture-active-defaulted-1280.png) |
| Closing | [Mobile](fixture-closing-375.png) | [Desktop](fixture-closing-1280.png) |
| Closed | [Mobile](fixture-closed-375.png) | [Desktop](fixture-closed-1280.png) |
| Cancelled | [Mobile](fixture-cancelled-375.png) | [Desktop](fixture-cancelled-1280.png) |
| Active, Kuru market | [Mobile](fixture-active-market-375.png) | [Desktop](fixture-active-market-1280.png) |
| Funding, light theme | [Mobile](fixture-funding-light-375.png) | [Desktop](fixture-funding-light-1280.png) |
| Early-redemption confirmation (viewport) | [Mobile](early-confirmation-375.png) | [Desktop](early-confirmation-1280.png) |

Additional captures: [empty market + credit error](empty-market-credit-error-375.png), [section skeletons](loading-sections-375.png), [indexer errors per section](indexer-error-sections-375.png), [expanded technical details](technical-details-375.png).

## Data gaps and interpretation

- **Event dates:** the page now reads activation, collection closure, default and settlement-opening timestamps directly from the bond, plus its policy hash/source. The current views do not expose the second-release, funding-cancellation or final settlement event timestamps. These say “date unavailable”; scheduled windows are not presented as actual event dates. Failed optional reads remain unavailable.
- **Paused reason:** `depositAllowed` is a boolean, not a reason code. Unhealthy sources get a plain explanation; an unreadable health check pauses entry conservatively. Deadline expiry and a full raise have separate explanations. Source evidence gives the last observation and freshness where available.
- **USD / market price:** there is no general asset/USD feed. USD-denominated assets use the existing display convention; other assets have no USD purchase estimate. No live bond currently has a registered Kuru market, so Active live pages explain that claims cannot currently be bought here and link to the vault. The separate market fixture exercises the ask-price calculator and buy/sell choices. Empty/unreadable asks never substitute par.
- **Projection:** Funding assumes the entire raise activates by the funding deadline, using par and the first release only. Active uses the asking price. Expected proceeds include SDK-capped revenue plus currently undrawn capital returned at maturity, assuming no further release. “Revenue stops” includes backing plus that returnable capital, without adding already recovered funds twice. Best case allows a second release only while still possible and without a recorded default; after maturity it includes no future revenue. Fees, order depth, future stake recovery and future share changes are excluded. A $10 example can exceed these very small live raises; explicit capacity warnings identify that it cannot be invested in full.
- **Repayment / cap:** “Repaid” is revenue collected for holders, not money already redeemed. The exact requested sentence uses the full contractual cap; the adjacent explanation and headline show that the effective cap scales with released capital. Returned principal and recovered stake are separate. The trailing rate uses the existing credit helper (up to seven days; shorter histories use the available history).
- **Credit:** signed validity and “covers N of M bonds” come from independent registry reads. Without a signature, the line is explicitly an unsigned credit-helper estimate. An expired/invalid signature remains labelled; failed reads do not erase the rest of the page.
- **Trust:** signed business descriptions are issuer-provided, including any dates in them; contract-derived terms govern the timeline and actions. Monitoring aims for roughly 30-minute checks but cannot guarantee detection latency. A trigger is distinct from default, and default can leave revenue collection active.

## Verification

Final `pnpm check:all` passed on an isolated source copy: **149 Solidity tests, 201 workspace tests (23 web), 17 scripts tests, 9 indexer tests**, SDK/contract packaging checks and both production app builds. All 68 web source/test files matched the checked copy byte for byte. Browser acceptance passed **28 groups** plus four supplemental checks; **32 screenshots** are saved here. Live views measured **0 layout shift** at both sizes. Minimum measured page-text contrast was **7.42:1 dark / 5.41:1 light** in the Funding fixture. The production fixture URL returned **404**, including with the review flag set.

`bond-decision.test.ts` covers the exact summary and one current lifecycle step/action for all eight requested phase fixtures, plus price availability, full-raise assumptions, returnable principal, ask pricing, recovery, expired windows and terminal-phase risks. Phase A yield and redemption tests remain in the web suite.

`capture.mjs` checks section order, a single summary primary action above the fold, collapsed disclosures, no horizontal overflow, exact fixture sentences, lifecycle state, top-five/show-all payers, keyboard/focus/tap glossary access, light/dark text contrast, calculator updates, paused/Closing action restrictions and early-redemption balance/precision/last-holder/acknowledgement guards. It also captures loading and independent error states. `quality.mjs` checks hover persistence, expanded technical details, 200% text and landscape. See `browser-results.json` and `quality-results.json` for measured results and capture times. Next’s development indicator is hidden only for screenshots.

To reproduce with Node 24 and pnpm available:

```sh
set -a
source apps/web/.env.example
set +a
BONDRAIL_UI_FIXTURES=1 pnpm --filter @bondrail/web dev --port 3212
```

In a second terminal at the repository root:

```sh
node --import tsx docs/ux/phase-b/capture.mjs
node docs/ux/phase-b/quality.mjs
pnpm check:all
```

The fixture route requires both development mode and the explicit local flag; production always returns 404. The screenshot wallet rejects every signing/sending method, and the capture harness allows only read RPC methods.
