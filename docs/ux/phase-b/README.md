# Frontend Phase B — bond decisions

The bond page reads in decision order: summary and primary action, lifecycle, claim worth or purchase scenarios, evidence, concrete loss scenarios, actions, then collapsed full terms. Task 22b replaces missing-value grids, reduces mobile length, and removes secondary actions from the summary. Existing tokens, `Panel`, mono/tabular figures, themes and Phase A early-redemption safeguards are retained. Maintenance stays collapsed. Closing exposes settlement timing without an investor transaction.

## Task 22b corrections

- Active bonds without a Kuru market show **What one claim is worth**, with current backing, expected value at the trailing revenue rate, stopped-revenue value and best case. There is no USD input. A connected holder also sees the same values for their balance. The explanation and vault link remain; the summary's primary link opens vault holdings.
- Unknown figures are omitted with a reason, including the summary, scenario estimates, credit profile, technical terms/addresses/coverage and early-redemption confirmation. Known backing and stopped-revenue values remain when revenue history is missing. Cancelled claims refund at par even after partial refunds; Closing projects no further collection.
- Mobile shows the current lifecycle step expanded, with **Show all steps** and individual expand/collapse controls. Desktop keeps all steps visible. Payers start with the top three and **Show all**; mobile rows retain source, exclusion status, payment count and amount. Optional Nansen screening is collapsed. Charts, cards and spacing are compact; every risk remains expanded.
- **Redeem early** appears only in the actions section before its form is opened. The summary contains only the primary action. Browser checks verify the summary sentence, all three headline values and primary action fit the 375 × 844 viewport on every live bond.

## Page heights before / after

Heights are full-document CSS pixels, disconnected wallet, default disclosures, dark theme. “Before” comes from the committed Task 22 PNG dimensions; “after” comes from fresh local Chrome captures. Live RPC/indexer values can change between captures. The PumpLab mobile assertion enforces **≤ 3,500 px**. All risks remain visible.

| Page | 375 px: before → after | 1280 px: before → after |
|---|---:|---:|
| Live PumpLab | 5,464 → **3,495** | 3,604 → **3,137** |
| Live CurveLab | 5,313 → **3,563** | 3,582 → **3,180** |
| Live Oracle Agent | 5,858 → **3,792** | 3,802 → **3,333** |
| Funding | 5,646 → **3,761** | 3,744 → **3,282** |
| Funding, paused | 5,670 → **3,781** | 3,726 → **3,234** |
| Active, no market | 5,708 → **3,642** | 3,766 → **3,229** |
| Active, triggered | 5,731 → **3,670** | 3,766 → **3,229** |
| Active, defaulted | 5,486 → **3,984** | 3,860 → **3,381** |
| Closing | 5,824 → **3,731** | 3,794 → **3,243** |
| Closed | 5,463 → **3,352** | 3,744 → **3,108** |
| Cancelled | 4,792 → **3,292** | 3,726 → **2,984** |
| Active, Kuru market | 5,770 → **3,783** | 3,744 → **3,317** |

The full machine-readable comparison is in [height-comparison.json](height-comparison.json). Connected-holder and expanded/error views are additional captures, not the default-height comparison.

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
| Active, connected holder | [Mobile](fixture-active-holder-375.png) | [Desktop](fixture-active-holder-1280.png) |
| Funding, light theme | [Mobile](fixture-funding-light-375.png) | [Desktop](fixture-funding-light-1280.png) |
| Early-redemption confirmation (viewport) | [Mobile](early-confirmation-375.png) | [Desktop](early-confirmation-1280.png) |

Additional captures: [missing revenue and optional terms](fixture-missing-data-375.png), [empty market + credit error](empty-market-credit-error-375.png), [section skeletons](loading-sections-375.png), [indexer errors per section](indexer-error-sections-375.png), [expanded technical details](technical-details-375.png).

## Data gaps and interpretation

- **Event dates:** the page now reads activation, collection closure, default and settlement-opening timestamps directly from the bond, plus its policy hash/source. The current views do not expose the second-release, funding-cancellation or final settlement event timestamps. These explain that the bond does not expose the date; scheduled windows are not presented as actual event dates. Failed optional term/address reads omit the row and explain the gap.
- **Paused reason:** `depositAllowed` is a boolean, not a reason code. Unhealthy sources get a plain explanation; an unreadable health check pauses entry conservatively. Deadline expiry and a full raise have separate explanations. Source evidence gives the last observation and freshness where available.
- **USD / market price:** there is no general asset/USD feed. USD-denominated assets use the existing display convention; other assets have no USD purchase estimate. No live bond currently has a registered Kuru market, so Active live pages explain that claims cannot currently be bought here and link to the vault. The separate market fixture exercises the ask-price calculator and buy/sell choices. Empty/unreadable asks never substitute par.
- **Projection:** Funding assumes the entire raise activates by the funding deadline, using par and the first release only. Active purchase estimates use the asking price; no-market claim values need no price or USD conversion. Expected proceeds include SDK-capped revenue plus currently undrawn capital returned at maturity, assuming no further release. “Revenue stops” includes backing plus that returnable capital, without adding already recovered funds twice. Best case allows a second release only while still possible and without a recorded default; after maturity it includes no future revenue. Fees, order depth, future stake recovery and future share changes are excluded. A $10 example can exceed these very small live raises; explicit capacity warnings identify that it cannot be invested in full.
- **Repayment / cap:** “Repaid” is revenue collected for holders, not money already redeemed. The exact requested sentence uses the full contractual cap; the adjacent explanation and headline show that the effective cap scales with released capital. Returned principal and recovered stake are separate. The trailing rate uses the existing credit helper (up to seven days; shorter histories use the available history).
- **Credit:** signed validity and “covers N of M bonds” come from independent registry reads. Without a signature, the line is explicitly an unsigned credit-helper estimate. An expired/invalid signature remains labelled; failed reads do not erase the rest of the page.
- **Trust:** signed business descriptions are issuer-provided, including any dates in them; contract-derived terms govern the timeline and actions. Monitoring aims for roughly 30-minute checks but cannot guarantee detection latency. A trigger is distinct from default, and default can leave revenue collection active.

## Verification

Task 22b final `pnpm check:all` passed on an isolated source copy: **149 Solidity tests, 204 workspace tests (26 web), 17 scripts tests, 9 indexer tests**, SDK/contract packaging checks and both production app builds. All 71 web source/data/style files matched the checked copy byte for byte. Browser acceptance passed **29 groups** plus four supplemental checks; **35 screenshots** are saved here. Live views measured **0 layout shift** at both sizes. Minimum measured page-text contrast was **7.42:1 dark / 5.41:1 light** in the Funding fixture. The production fixture URLs returned **404**, including the missing-data fixture and with the review flag set.

`bond-decision.test.ts` has 17 tests and covers the exact summary and one current lifecycle step/action for all eight requested phase fixtures, plus price-independent claim/holder values, cancelled refunds after partial burns, missing revenue, price availability, full-raise assumptions, returnable principal, ask pricing, recovery, expired windows and terminal-phase risks. Phase A yield and redemption tests remain in the web suite.

`capture.mjs` checks section order, a single summary primary action and all three headline values above the fold, collapsed disclosures, no horizontal overflow, exact fixture sentences, lifecycle state, top-three/show-all payers, keyboard/focus/tap glossary access, light/dark text contrast, calculator updates, paused/Closing action restrictions and early-redemption balance/precision/last-holder/acknowledgement guards. It also verifies claim/holder values, omitted missing-data rows, keyboard lifecycle expansion, one early-redemption entry point, and captures loading and independent error states. `quality.mjs` checks hover persistence, expanded technical details, 200% text without overlapping headline values, and landscape. See `browser-results.json` and `quality-results.json` for measured results and capture times. Next’s development indicator is hidden only for screenshots.

To reproduce with Node 24 and pnpm available:

```sh
set -a
source apps/web/.env.example
set +a
BONDRAIL_UI_FIXTURES=1 pnpm --filter @bondrail/web dev --port 3212
```

In a second terminal at the repository root:

```sh
PHASE_B_SAVED_REGISTRY=1 node --import tsx docs/ux/phase-b/capture.mjs
node docs/ux/phase-b/quality.mjs
pnpm check:all
```

Task 22b uses the saved public registry response after its endpoint timed out; RPC and indexer reads remain live. Omit `PHASE_B_SAVED_REGISTRY` to fetch a fresh public registry snapshot. Two initial `check:all` attempts timed out while npm installed the isolated SDK consumer; the final full run passed after registry connectivity recovered.

The fixture route requires both development mode and the explicit local flag; production always returns 404. The screenshot wallet rejects every signing/sending method, and the capture harness allows only read RPC methods.
