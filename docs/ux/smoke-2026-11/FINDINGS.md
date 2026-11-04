# Task 27 UI Smoke Findings

Run date: 2026-11-04. App: local `apps/web` using `docs/deployments/10143.json`, Monad testnet 10143, and the configured HyperIndex endpoint. The final UI verification completed with zero failed UI assertions. The wallet connected, the 1 USDC deposit was confirmed, the bond showed a full 2/2 USDC raise and one claim, and `/portfolio` listed PumpLab.

## Findings

### High — Fully funded raise disappears from Markets before activation

After funding reached 2/2 USDC, the bond remained in Funding and its detail page still offered withdrawal, but `/markets` did not render a link to it while it awaited activation. A holder returning to the markets page could reasonably think the position or bond had disappeared. The test navigated to the bond by its known URL to complete verification.

Evidence: [17-markets.png](17-markets.png), [44-raise-full.png](44-raise-full.png).

### Medium — Open PumpLab raise is hidden from Markets

Before the deposit, `/markets` said “Nothing raising right now” and showed one hidden item because PumpLab had no signed profile. The open raise remained directly reachable. The hidden-item explanation did not identify PumpLab or provide a direct path to its page.

Evidence: [02-markets.png](02-markets.png), [05-bond-open.png](05-bond-open.png).

### Medium — Deposit calculator starts above the remaining raise

The “What you get” amount defaults to 10 USDC while only 1 USDC remains. It immediately displays “This amount cannot be deposited in full,” before the user enters an amount.

Evidence: [05-bond-open.png](05-bond-open.png).

### Low — Wallet connection requires opening the app first

The landing page has an “Open app” link but no Connect control. A user must navigate to `/markets` before choosing the browser wallet.

Evidence: [01-landing.png](01-landing.png), [03-wallet-menu.png](03-wallet-menu.png), [04-wallet-connected.png](04-wallet-connected.png).

## Run Notes

The first UI attempts stopped on stale or incorrect smoke assertions and locator timeouts; their error text and failure screenshots remain in `run.json` and screenshots `10`, `15`, `21`, `28`, and `36`. The completed run resumed the exact transactions from the durable journal and verified both successful receipts by RPC. No transaction was broadcast during the final read-only UI verification. Browser request aborts during page navigation are recorded in `run.json`; the final verification had no UI assertion failures.

## Transactions

| Action | Amount | Hash | Receipt |
| --- | ---: | --- | --- |
| USDC approval to PumpLab bond | 1.000000 USDC | `0x988a47d4b6cbda33b570bfb18efd11de74868be5409ca2be6de4b6a11fd8b14e` | success |
| PumpLab bond deposit | 1.000000 USDC | `0x8c27ce9f2cc1833eac6439bedb49f9814c1f7ee92ac03ac19fff40962cf004eb` | success |

The resulting chain state was 2.000000 USDC escrowed, zero remaining, Funding phase pending activation, and one claim for the test wallet. Full step text, timing, screenshots, request errors, wallet requests, receipts, and chain snapshots are recorded in [run.json](run.json).

## Task 28 — Kuru buy on PumpLab

The test used the local `apps/web` app on Monad testnet (10143), the published PumpLab profile and Kuru registry record, and the guarded wallet `0xF62d…761b`. The local dev registry is in-memory, so the script fetched the published records read-only and loaded them through the local registry verification endpoint. KV credentials were disabled for the child process; no remote registry write was made.

Markets → Trading shows PumpLab under its `PLAB-RC` symbol with a `Live` badge, `Coverage 0.0×`, `Implied APR -404.0%`, and the warning `Coverage below 1.2×`. The local page initially lacked the published records; after local seeding the card was visible without expanding hidden listings. On the bond page, the chain's Active phase is labelled `Repaying`, and the Buy claims panel showed a `1.0000` USDC best ask and the abbreviated Kuru market address.

### Medium — Kuru buy quote is hidden until USDC approval

Entering `0.1` USDC with zero allowance did not show expected claims or minimum received. The quote appeared after the exact approval was confirmed on chain. After allowance, the preview showed `0.089829` claims and `0.08893` minimum received.

Evidence: [kuru-07-preview-awaits-approval.png](kuru-07-preview-awaits-approval.png), [kuru-07-buy-preview.png](kuru-07-buy-preview.png).

### Medium — Trade panel does not show transaction confirmation after success

The approval and buy both succeeded on chain, but the trade panel remained at “Confirm in your wallet…” and surfaced `Bond | Bondrail`. The durable journal, exact transaction calldata, and successful receipts were reconciled before any continuation. The read-only follow-up showed the larger position in Portfolio.

Evidence: [kuru-10-failure.png](kuru-10-failure.png), [kuru-12-portfolio-position.png](kuru-12-portfolio-position.png).

## Task 28 Transactions

| Action | Amount | Target | Hash | Receipt |
| --- | ---: | --- | --- | --- |
| USDC approval | 0.100000 USDC | Kuru market `0xEbB8…E92d` | `0xb90f347036567a5e1a035e1f32b08be02ac4eba9f6ecfe3764dbcc23e3afb08b` | success |
| Buy claims | 0.100000 USDC | Kuru market `0xEbB8…E92d` | `0x2803e42b94a29388a50f5565a33cd77dbcd5a405f17359fa441fabf8e7180a10` | success |

The wallet moved from `0.99` to `0.89` USDC and from `1` to `1.089829` PumpLab claims. The final Portfolio view displayed `1.0898` claims. Only these two chain transactions were made for Task 28; the final verification invocation was read-only. Full attempts, screenshots, request guards, receipts, balances, and Markets observations are appended under `taskRuns` in [run.json](run.json).
