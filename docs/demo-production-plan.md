# Bondrail: Metropolis demo production plan

Prepared 11 October 2026 from the supplied rules, [existing script](demo-video-script.md), current source, and public pages. This is a production plan and revised narration, not a rendered video. The original script is preserved.

## Implemented production update — October 11

The user's final constraints are **zero budget, existing synthetic voice, and fully automated recording/actions**. The implemented workflow uses free local Kokoro, Playwright and FFmpeg; see [demo/video/README.md](../demo/video/README.md). Real Native repayment, Kuru purchase and CurveLab deposit footage is captured. Explorer human-verification pages are replaced with explicitly labelled reports decoded from real Monad RPC receipts. `demo/video/scenes.json` is the final narration; the research and earlier recommendations below are historical. No paid API/editor or user speaking is needed. Public video hosting and public GitHub access remain submission steps.

## Recommendation (initial research)

Make a **2:50 demonstration built around actual screen recordings**. The central story is: a business builds revenue history, raises against it, repays investors automatically, and its claims trade on Monad.

Use **Remotion to assemble recorded footage, restrained zooms, labels and audio** if we want an editable video project in this repo. Use **Clipdio for the quicker recording-to-narration route**, especially if choosing an AI voice. Do not add both to the critical path unless a short export trial proves the combination saves time. My default narration recommendation is the founder's own voice; an AI voice can use exactly the same approved text.

The distinction matters: Remotion composes videos with React. It does not automatically capture a website, connect a wallet, or prove that a transaction happened. Record those actions first. Animated reconstructions of balances, terminals and wallet confirmations cannot stand in for the working-product evidence required by sections 9.1 and 9.4.

## What the repository implements

- [SliceAccount](../contracts/src/SliceAccount.sol): payer attribution and fee collection for Native projects; automatic investor share during the payment transaction. Plain transfers, including x402 settlements, need `sweep()` to book and split them.
- [SliceBond](../contracts/src/SliceBond.sol): claim tokens, deposits and funding withdrawals, staged capital release, capped repayment, recovery and redemption. Redeeming burns claims and gives up their future entitlement.
- [SliceFactory](../contracts/src/SliceFactory.sol): issuance, source checks and deployment of approved Native templates.
- [Credit calculation](../packages/sdk/src/credit.ts): attributed revenue discounted for stress, short history and payer concentration. This is a sizing estimate, not an independently validated credit rating or automatically guaranteed borrowing capacity.
- [App data](../apps/web/src/lib/protocol.ts) and Envio: revenue history, detected issuer funding links, bond data and monitoring. The app refreshes protocol data every ten seconds.
- [Kuru panel](../apps/web/src/components/app/trade.tsx): buy/sell, simulated quotes, minimum output and transaction receipts.
- [CRE workflow](../cre/slice-covenant/src/workflow.ts), [reporter](../ops/covenant-server/report.sh) and [buyer guard](../packages/sdk/src/x402-guard.ts): Watched payment checks, testnet report broadcasts, adjacent-epoch violation confirmation and optional independently pinned buyer expectations.

The older assessment predates several fixes. Also, parts of [SPEC.md](SPEC.md) lag the implementation: it still describes 30-second monitoring and says the factory never deploys projects. Use current code, README and recorded behavior for narration.

## Public-page observations

Read-only browser observations on 11 October, around 09:08–09:09 UTC; these numbers will change:

| Screen | Observed state | Recording implication |
|---|---|---|
| Markets | Defaults to **Raising**; CurveLab shows $0/$40 | Select **Trading** before the opening take |
| PumpLab | Live; $0.4479 repaid; backing 0.0224; 50% principal released | There is existing repayment evidence; record a new before/action/after sequence for the demonstration |
| PumpLab terms | $24 full repayment cap, but **$12 current effective cap** | Explain staged principal; avoid implying $24 is currently collectible |
| Kuru | Bid 1.0937, ask 1.1046, backing 0.0224 | Distinguish market price from collected cash; successful execution still needs a connected-wallet rehearsal |
| Oracle Agent | $0.10 repaid; last check compliant, about eight minutes old | Show the report timestamp and actual report transaction |
| CurveLab / Oracle | Coverage warning visible | Leave warnings visible; the prototype is not proof of investment safety |
| GitHub | `https://github.com/calledAdo/bondrail` returns **404 signed out** | Public source is a submission blocker until this URL or its replacement works anonymously |

No wallet transaction, traffic generation, remote reporter command, paid API call or default was executed for this review. PumpLab rendered successfully; its console showed a stylesheet preload warning. Clipdio's public landing page loaded with no console errors. These checks do not establish end-to-end transaction success or Clipdio export quality.

## Tool selection

Clipdio, Remotion, Remocn, Snapcn and Jitter descriptions below were checked against their public sites. The remaining resources are categorized from the supplied list; their current plans and capabilities were not individually tested.

| Resource | Role for this demo | Decision |
|---|---|---|
| [Clipdio](https://clipdio.com/landing) | Existing recording → editable narration → voice and captions → export | Strong fast route for AI narration; test 15–20 seconds first |
| [Remotion](https://www.remotion.dev/) | Assemble real clips, crops, titles, audio and precise timing in React | Preferred route when we build and maintain the edit in code |
| [Remocn](https://remocn.dev/) | Copyable motion components | Optional title/caption elements only; avoid replacing product evidence with reconstructed UI |
| [Snapcn](https://snapcn.dev/) | Remotion scenes, captions and frames | Optional simple frame; laptop mockups shrink an already dense finance interface |
| [Jitter](https://jitter.video/) | Visual motion editor | Alternative for a small brand animation; unnecessary for the core recording |
| [Rive](https://rive.app/) | Interactive runtime animation | No necessary role in a linear submission video |
| [Motion](https://motion.dev/) | Website/interface animation | No app animation changes needed for the video |
| [Magic UI](https://magicui.design/) | Animated website components | No need to redesign Bondrail for recording |
| [GSAP](https://gsap.com/) | Complex web animation sequencing | Extra implementation without a clear demo benefit |
| [LottieFiles](https://lottiefiles.com/) | Small animated assets | Optional, but existing Bondrail branding is enough |
| [Theatre.js](https://theatrejs.com/) | Visual animation timelines | Additional tooling not needed for this edit |
| [Zajno motion guide](https://motion.zajno.com/) | Timing and easing reference | Useful guidance, not a production dependency |
| [ShaderGradient](https://shadergradient.co/) | Animated backgrounds | Skip; numerical evidence needs a quiet background |

**Clipdio specifics:** its public site says browser recordings upload for processing; desktop editing/rendering, Kokoro voices and Whisper timing run locally. Credit-funded work can go to OpenRouter or ElevenLabs. Free cloud accounts advertise three videos, up to 500 MB and 15 minutes each. It offers editable generated scripts and per-line voice regeneration. Preserve the approved narration instead of accepting newly invented product claims. Own-voice import, precise pan/zoom editing, caption export, watermark behavior and final export quality were not verified behind sign-in; test these before committing the full edit. Exporting MP4 to a conventional public host is the clearest submission path.

Remocn and Snapcn advertise MIT component licensing. Remotion has separate licensing: its current homepage advertises free use for individuals and companies up to three people, with different requirements for larger collaborations/companies. Check the actual applicable terms before installing assets; component licenses do not replace Remotion's license.

## Revised 2:50 cut

The existing script contains **377 spoken words**, calls its target 2:50, and ends its scene timings at 2:55. This cut gives the important transactions more space and ends at 2:50, leaving ten seconds below the hard limit. Record narration separately so wallet delays do not dictate speaking speed.

### 0:00–0:15 — Problem and product

**Footage:** actual Markets → Trading screen. Small opening title over the app: “Bondrail · Revenue bonds on Monad”. Show “Monad testnet · team-controlled demo activity”.

**Voice:** “An onchain business can earn fees every day and still struggle to access credit. Bondrail lets it raise against a capped share of future revenue, with claims investors can trade on Monad.”

### 0:15–0:37 — Evidence before the raise

**Footage:** PumpLab account. Move from attributed/raw revenue to the payer exclusions, then the credit-line estimate. Hold each number long enough to read.

**Voice:** “PumpLab's account records revenue before it raises. Here, Bondrail excludes payments linked to issuer funding. Envio turns those events into a payer history. The credit-line estimate discounts revenue for short history and concentration. These are controlled test wallets, not customer traction.”

### 0:37–0:55 — Staged funding

**Footage:** PumpLab bond, Native source review, release ribbon and terms. Label “20 raised → 10 released · 10 held”, only if still true when recorded.

**Voice:** “PumpLab uses a reviewed Native template that routes fees through its account. Investors funded twenty USDC. Ten was released; the rest stays in escrow until the revenue and timing conditions are met. The repayment cap scales with released capital.”

### 0:55–1:28 — Real payment, real repayment

**Footage:** capture the baseline Repaid/Backing values, trigger one controlled Native payment sequence, capture the updated values, then open its successful explorer receipt. Show the USDC transfer to the bond and corresponding revenue events. Keep part of the action-to-receipt sequence at normal speed.

**Voice:** “Now a test wallet makes a real PumpLab trade. Twenty-five percent of its fee goes to the bond inside that transaction. Repaid and backing per claim increase. This Monad receipt shows the transfer to the bond. Native repayment needs no separate collection transaction.”

### 1:28–1:54 — Trade the claim

**Footage:** Kuru panel. Enter a rehearsed executable amount, show quote and minimum received, wallet confirmation, successful receipt, then updated claim balance. Use 0.5 USDC only if the live quote can fill it.

**Voice:** “An investor can also buy claims on Kuru. This quote comes from simulating the order against the live market. I confirm, and the claim balance updates. Market price reflects future revenue expectations; cash backing is only the amount collected so far.”

### 1:54–2:13 — Join an open raise

**Footage:** CurveLab deposit of 1 USDC, transaction success, then claim balance. Withdrawal is optional only if there is time for a genuine receipt.

**Voice:** “CurveLab is an open raise on the same template. I deposit one test USDC and receive claims. Deposits are withdrawable while funding remains open. If funding expires, cancellation enables investors to claim refunds.”

### 2:13–2:39 — Watched revenue

**Footage:** Oracle Agent monitoring, manifest account, genuine CRE report output and explorer receipt. Lower-third: “CRE simulation + real Monad broadcast · checks every 30 min”. Record reporter execution separately; edit its wait transparently.

**Voice:** “HTTP payments use the Watched tier. This CRE simulation checks payment offers and broadcasts a real report to Monad. Checks run every thirty minutes; detected violations are rechecked in the next epoch. Two adjacent violations trigger default and stake slashing. x402 receipts are split when swept.”

### 2:39–2:50 — Close on verifiable evidence

**Footage:** public README addresses, then hold the live app and repository URLs over the actual app. Only use the following wording once GitHub works signed out.

**Voice:** “Issue revenue bonds, raise capital, and repay investors from business revenue. Explore Bondrail on Monad testnet.”

## Corrections to carry into any version

1. **Problem claim:** replace “they can't borrow” with “struggle to access credit”. Avoid implying no competing revenue-finance products exist.
2. **Track:** the supplied Track 1 text describes financial instruments, markets and asset primitives. Bondrail's positioning is “Revenue bonds for onchain businesses,” not a quotation from that brief.
3. **Native scope:** routing is enforced for the reviewed contract's payment path. The business can still stop operating or migrate users. Avoid an unrestricted “fees can't be routed around” guarantee.
4. **Repayment cap:** show the current effective cap separately from the full-release cap. At the observed state those are $12 and $24.
5. **Kuru floor:** one percent below a quoted output is a slippage limit, not a floor under the token's value or protection from investment losses.
6. **Refunds:** cancellation and refund transactions are required after expired funding. “Everyone is refunded” should not imply automatic payment at the deadline.
7. **CRE:** simulation with broadcast and a disclosed observer signer; do not imply a deployed decentralized DON. Scheduled interval is 30 minutes; epochs are 30 seconds. A compliant report shown on video does not demonstrate default execution.
8. **Buyer guard:** if narrated, say buyers can pin the expected account from the bond. A mutable issuer manifest alone is weaker evidence.
9. **Timing:** omit the 171–839 ms claim from the main cut. If retained, identify it as five testnet receipt observations, not a network-wide benchmark or finality guarantee. The browser timer in `tx.ts` begins after the transaction hash is returned, so it excludes wallet signing and earlier submission time.
10. **Closing promise:** the original “same block they earn” overgeneralizes Native behavior to Watched x402. Use the revised close.

## Capture and editing runbook

1. **Prove the export path first.** Produce one 15–20-second sample containing real UI, a caption, narration and a zoom. Check readable numbers, pronunciation of “Monad”, “Kuru” and “USDC”, audio sync and watermark behavior. Do this before building a full motion package.
2. **Prepare the take.** Use a separate testnet browser profile, notifications off, fixed dark theme, a clear cursor and sufficient test USDC/MON. Check balances, current allowances, bond phases and Kuru liquidity. The script's ~2 USDC covers a 1-USDC deposit plus a 0.5-USDC buy once, not an unlimited number of takes. Rehearsals consume balances and allowances.
3. **Use readable framing.** Capture 1920×1080 or higher, 16:9, 30 fps. For this dense interface, increase browser zoom or crop to the relevant panel. Use Bondrail's existing Geist/Geist Mono, near-black background and emerald accent. Avoid device mockups around small financial text.
4. **Capture separate clips with handles.** Save 3–5 seconds before and after each action. Suggested names: `01-markets`, `02-credit`, `03-staging`, `04-native-payment`, `04b-explorer`, `05-kuru`, `06-deposit`, `07-cre`, `08-source`. Keep raw footage separate from exports; do not commit large recordings or private desktop footage to Git by accident.
5. **Make the payment take reproducible.** The existing traffic command signs multiple buys/sells and may fund or approve wallets before traffic starts. Its default three wallets and three rounds are not one isolated payment. Budget for setup, rehearse, select a specific successful transaction and preserve its hash. Don't assume “start ten seconds before” guarantees a visible update; the app polls every ten seconds and Envio can lag. Do not run the wash cohort just to increase apparent activity.
6. **Record operational proof separately.** The SSH report command writes on-chain and may conflict with the scheduled reporter. Check the operator's run before recording. Keep actual `SLICE_RESULT`, report hash and timestamp visible; crop the server address/host prompt if distracting. Never animate replacement terminal output. Do not run `demo-default.ts` on the existing live bond.
7. **Edit for comprehension.** Use direct cuts between pages, 250–400 ms eased crops when guiding attention, and stable holds for transaction data. One focus at a time. Put “wait shortened” on edited receipt waits and a speed label on accelerated footage. Keep any receipt-speed evidence unaccelerated. Avoid moving gradients, fake counters and excessive cursor effects.
8. **Add narration and captions.** Record one paragraph per scene. Use two caption lines at most, positioned away from balances and buttons. Keep music absent or quiet enough that technical terms remain clear. Do not ask AI-generated narration to infer unsupported claims from the screen.
9. **Check the whole export.** H.264 MP4 with AAC audio is a practical delivery format. Target 170 seconds including opening, closing and black frames. Watch at normal speed and at 720p to confirm numbers/captions remain legible. Recheck duration after upload processing.
10. **Publish and test the submission links.** Upload to YouTube, Loom, Vimeo or an equivalent publicly accessible host. Open the video and GitHub URL in a signed-out browser; no password or access request should be needed. Publishing and wallet actions are later production steps, not completed by this plan.

## Rules and judging coverage

| Requirement / criterion | Evidence in the cut |
|---|---|
| Actual operation, ≤3 minutes | Live deposit, Native payment and Kuru order; 2:50 target |
| Monad integration, 20% | Testnet network label, successful receipt, fee split and report transaction |
| Product completeness, 20% | History → financing → repayment → trading; open raise judges can inspect |
| Technical excellence, 20% | Staged release, fee routing, attribution and covenant evidence |
| Track fit, 20% | Financing businesses through transferable revenue claims, Track 1 |
| Innovation and impact, 20% | Demonstrate the combined mechanism and practical borrower/investor value without claiming unique invention or customer traction |
| Public source and documentation | Signed-out GitHub access; README setup, architecture, addresses, license, attribution, AI disclosure and build history |

The supplied rules set the submission deadline to **13 October 2026, 11:59 PM Eastern**, which is **14 October 2026, 4:59 AM Lagos time**. The November 3 event end/winner date is not the submission cutoff. This conversion was checked using `America/New_York` and `Africa/Lagos`; recheck the current submission portal for amendments.

**Current submission steps:** verify the rendered video, make the source repository publicly accessible, and publicly host the final video. Narration and genuine transaction footage have been produced; see the implemented production update above.
