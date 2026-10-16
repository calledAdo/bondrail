# What's new in Bondrail — Task 24

The update is a local 1920×1080, 30 fps Remotion production using real production screens, real Monad testnet transactions, local Kokoro narration, word captions, and original synthesized music. The final cut is approximately 2:53. All recordings are from 16 October 2026. Large media remains gitignored.

Deliverables: `output/update/bondrail-update.mp4`, `output/update/bondrail-update.srt`, and `output/update/contact-sheet.jpg`. The standalone package is `remotion/`; it has its own npm lockfile and is deliberately outside the pnpm workspace. No application code, workspace lockfile or CI configuration changed.

## What is shown and where each claim comes from

Times in the first column refer to the final video. Raw times refer to the matching scene in `output/update/capture.json`. That file includes capture dates, exact URLs, timestamped screen text, focus rectangles, cursor samples and paths to original JPEG frames. `remotion/src/data.json` preserves the public screen-text/cursor evidence used by the composition. Text off-screen in the DOM is included for context; the original frames determine visibility. `remotion/evidence/claims.json` lists the claims and sources in machine-readable form.

| Video | Claim or visible evidence | Source |
| --- | --- | --- |
| 0:00–0:15 | Expanded from revenue bonds to vaults, account settlement and credit profiles; all live on testnet | Real landing capture, then the working features demonstrated below. This is positioning, not a mainnet or audited-product claim. |
| 0:06–0:15 | $0.47 revenue routed; 59 payments; $0.08 collected; 2 live bonds | `landing` raw 8.968 s, real Envio-backed stats. Mint metric labels repeat captured values; they do not interpolate fictitious counts. |
| 0:15–0:38 | Bondrail Credit, team-created badge, anyone may create a vault, directory does not endorse curators or strategies | `vaults` raw 0.043 / 6.121 s. Actual card/disclosure. Current vault has one holding, despite supporting a portfolio. |
| 0:38–0:44 | 1 USDC deposit previews approximately 1 share at 1 USDC entry price; withdrawal limited to 1.5 USDC idle cash at this capture | `vault` raw 9.660–15.660 s; preflight block 71498110. The preview explicitly says the execution price can change. |
| 0:44–0:51 | Exact approval, real deposit, UI confirmation in 860 ms | `vault` approval-confirmed at 20.638 s, deposit-confirmed at 30.081 s; transaction hashes below. Timing is the app's receipt observation, not a finality benchmark. Approval/deposit waits are edited by cuts; their internal footage is at real speed. |
| 0:51–1:02 | Bond loss/idle-cash risk; one share, 1 USDC exit value, 1 USDC withdrawable, 1 USDC remaining deposit cost in portfolio | `vault` risk panel around 32.081 s; portfolio at 43.850 s. `contracts/src/BondrailVault.sol` `_holdingValues`, `maxWithdraw` and ERC-4626 previews substantiate carrying value/write-down behavior. No new default or impairment was induced. |
| 1:02–1:08 | One guarded paid API request, HTTP 200, 0.01 test USDC, end-to-end response 10.437 s | Verbatim `x402-terminal.txt`, `x402.json`, `scripts/pay.mjs`. Uses published `@bondrail/sdk/x402-guard`, pinned bond account, and `@x402/fetch`. |
| 1:08–1:30 | Transaction is to Oracle Agent's revenue account; payer is the video wallet; 0.0025 USDC investor transfer in the same receipt | Real Monadscan overview and exact raw log 40, `explorer` raw 0.035 / 14.980 s; independently decoded `Settled` and `Revenue` events in `chain-verification.json`. The transaction sender is the facilitator, while the `Settled` payer is the video wallet. |
| 1:30–1:40 | Oracle Agent summary and lifecycle, with Repaying / You are here | `oracle` raw 0.044 / 7.503 s; bond `0x66A9aAfad577A6319645F4E2E2daAad42a987343`. Captured summary shows $2 raised, 25% share, $2.40 possible cap and $1.20 current cap. |
| 1:40–1:49 | What one claim is worth and a real open glossary popover | `oracle` raw 15.928 / 34.552 s. At the claim panel marker: $0.0388 backing, $0.9711 expected at current rate, $0.5388 if revenue stops, $1.20 best case. These are the app's labelled estimates, not guaranteed returns. Live refreshes later show $0.04 / $0.9722 / $0.54 in the glossary take; footage is not retouched to hide the refresh. |
| 1:49–1:59 | PumpLab 25% share can rise to 40% below $0.01 over one day | `pump` raw 5.337 s; bond `0xb6f44e47C7468c42A32d9679170cC3C4B145099B`. The app risk text specifies one complete UTC day and a trigger check; no trigger execution was staged. |
| 1:59–2:04 | How investors could lose money | `oracle` raw 24.641 s. Real risk list includes business failure, released principal, routing/monitor risks, illiquidity and unaudited contracts. |
| 2:04–2:22 | On-chain record and repayment coverage 1 of 1 bonds; valid attestation, 0.000233 USDC credit line | PumpLab account `0x0c58cE2d764C089AEfe8dA8cA27C2E521BDC31F5`, `credit` raw 5.343 / 12.976 s. At capture: 0.002247 USDC revenue, 0.22455 USDC volume, 6 payments, 3 payer addresses; signed assessment expires 2026-10-17 06:15:34 UTC. It is an assessment, not available credit or guaranteed repayment. |
| 2:22–2:42 | Published SDK/contracts install and a six-line BondrailEarner consumer builds | Actual isolated consumer transcript and timestamped stdout/stderr in `builder.json` / `builder-terminal.txt`. SDK 0.2.0, contracts 0.1.0, OpenZeppelin 5.4.0; Solc 0.8.28 compiled 9 files successfully. Terminal is a styled replay of captured text, with pauses and npm update notices omitted. The six-line example proves inheritance/compilation; applications use `_collect` / `_settleOut` to route fees. It was not deployed. |
| 2:42–end | Bondrail URL, testnet / not audited; same-transaction repayment | Brand assets and production URL; the account `Revenue` event and investor token transfer above substantiate same-transaction settlement. Plain ERC-20 transfers still need a sweep, as the app states. |

All other app figures and explanatory copy visible within these shots come directly from the corresponding raw frame range; the full timestamped text is preserved, including risk and estimate qualifiers. No balances, prices, receipts, explorer DOM or app responses were mocked. Abstract backgrounds, device frame, title animation and the separately labelled ABI explanation are editorial graphics.

## Transactions and spending

Chain: Monad testnet 10143. The only private key accessed was `~/.bondrail-video/demo.key`, held in Node and never injected into Chrome or written into media/source. Wallet: `0xF62d1CBb1E11aC090a1060022f519c6A1381761b`.

| Action | Transaction | Checked result |
| --- | --- | --- |
| Exact 1 USDC approval | `0xfa3bb8274fa860866e72d625e5a88bd9ab5782a2727350b34c43a88530a7cf6a` | To test USDC `0x534b2f3A21130d7a60830c2Df862319e593943A3`, spender Bondrail vault, amount 1,000,000 base units. |
| 1 USDC deposit | `0xe6a3fb315ec5fbac4fad81af9103eb27124b08ca3666590025631e07e17cf20c` | To vault `0x57fd6a271a6a4e96b151e5d0732c7f61e3059f07`, receiver video wallet; one share received. |
| One paid x402 call | `0x5563388bac3ee3686b00e1cd5b32055457b03c7936f8b6891a95d0bd80fda911` | To account `0x067861e4bf4803a66DB97cF74E252B6F4927FA54`; Settled payer is video wallet, value 10,000; Revenue assigns 2,500 to bond and 7,500 to issuer. |

All receipts were read again and verified successful. No withdrawal was needed for the script. Total: one approval, one 1-USDC deposit, one 0.01-USDC API call; no other wallet spending. Wallet cash after capture: 1.99 test USDC, plus one vault share. MON remaining: 0.105799626; wallet gas spent: 0.044200374 MON. The x402 facilitator pays settlement gas, not the payer wallet.

The durable journal is `~/.bondrail-video/update-budget.json`, separate from disposable media. The provider rejects other destinations, native transfers, another chain/account, excessive approval/deposit/withdrawal amounts, unsupported signing methods and repeated reserved operations. Signed transaction hash is saved before broadcasting. The x402 signer checks the authorization's token, chain, payer, account and exact 0.01 amount, and allows one signature per invocation. Every financial action checks a 0.01 MON reserve plus estimated transaction cost. Do not delete the journal or rerun successful financial scenes to rebuild an edit.

## Editorial accuracy

Two factual qualifications were made to the supplied script: the unsupported x402 “under a second” phrase was removed (the observed full API request took 10.437 s), and the trigger wording says “when the trigger is checked.” “Paid APIs” became “paid API calls” for pronunciation. Acronyms/URL use phonetic TTS input while captions retain their normal spelling. The separately measured 860 ms deposit confirmation remains visible in the real UI.

Monadscan's account events are not ABI-labelled in its UI. The footage shows the actual raw `Settled(address,uint256,bytes32)` topic `0x22f68de1983d980ae3f96a85b07d13614cf2fc6966b3c4c197fe099ef00263ea`, payer topic and amount. A bar explicitly labelled “Decoded explanation” identifies them using the verified receipt and contract ABI. No explorer verification, source publication or remote setting was changed. Normal visible Chrome completed the site's ordinary security check; headless attempts remained blocked and are excluded from the edit.

## Rebuild the edit without spending again

Requirements: Node 24 or compatible recent Node, npm, installed Chrome, Python 3.12, and the local media/model artifacts. Package versions are locked. From the repository root:

```sh
npm --prefix demo/video/remotion ci --no-audit --no-fund
/private/tmp/bondrail-video-venv/bin/python demo/video/remotion/scripts/encode-captures.py
node demo/video/remotion/scripts/prepare.mjs
npm --prefix demo/video/remotion run typecheck
npm --prefix demo/video/remotion test
npm --prefix demo/video/remotion run render -- --stills
npm --prefix demo/video/remotion run render
node demo/video/remotion/scripts/verify-chain.mjs
/private/tmp/bondrail-video-venv/bin/python demo/video/verify_update.py
```

Rendering uses the original unmodified app/explorer frames, with cuts, one eased camera move at a time, and recorded cursor coordinates. CDP only emits display changes; their presentation timestamps preserve static holds. Some Chrome display surfaces are 1920×993 inside the 1920×1080 viewport; the encoder pads the remaining area and sets square pixels rather than stretching text. The output clips and final video are 1920×1080 at 30 fps. `raw/<scene>-<timestamp>/capture.json` retains the original timestamped JPEG sequence; the frame concat file makes conversion reproducible.

For local voice tooling:

```sh
UV_CACHE_DIR=/private/tmp/bondrail-uv-cache uv venv --python 3.12 /private/tmp/bondrail-video-venv
UV_CACHE_DIR=/private/tmp/bondrail-uv-cache uv pip install --python /private/tmp/bondrail-video-venv/bin/python kokoro-onnx==0.6.1 soundfile==0.14.0 pillow==12.3.0 imageio-ffmpeg==0.6.0 faster-whisper==1.2.1
# Place the two model-files-v1.0 Kokoro files in /private/tmp/bondrail-video-models/.
/private/tmp/bondrail-video-venv/bin/python demo/video/narrate_update.py
/private/tmp/bondrail-video-venv/bin/python demo/video/narrate_update.py --align
```

Kokoro uses `am_michael`, speed 1.03, matching the existing local male voice setup. Per-line WAVs, scene manifests, independently recognized word times and SRT are in `output/update/`. The original pad is generated deterministically and ducked under actual voice regions. A two-pass audio finish targets −18 LUFS / −1.5 dBTP, copies the video bitstream, and preserves all timing. ASR loads audio as arrays to avoid the PyAV 19/faster-whisper file-reader incompatibility.

Read-only capture can be refreshed with `node demo/video/capture-update.mjs --scene=landing` (also `vaults`, `oracle`, `pump`, `credit`, `explorer`). The `vault` and `withdraw` modes and `scripts/pay.mjs` are financial actions and are **not** rebuild steps. `scripts/builder.mjs` runs a new real consumer install/build in a temporary directory; it never deploys.

## Verification and licenses

`output/update/validation.json` records the final file hash, full decode result, duration, codecs, loudness/peak, caption timing checks and independent speech recognition of the final AAC track. `chain-verification.json` records transaction destinations, decoded events, balances and budget totals. Representative review frames and the final six-frame contact sheet are local media artifacts. Public evidence summaries are checked in under `remotion/evidence/`.

The final file is **173.07 seconds**, 20,140,802 bytes, 1920×1080 at 30 fps, H.264 with 48 kHz stereo AAC. Full-file decoding passed. Measured final AAC loudness is **−18.06 LUFS**, with **−1.34 dBTP** true peak. All 333 caption words are present and ordered. Independent final-audio recognition matches 96.2–100% by normalized character similarity per scene; phonetic spelling differences remain for API, “signed attestation”, the URL and “audited” in the raw recognition report. For matched words, median timing offset is about 40 ms in every scene; per-scene 95th-percentile offsets range from 80 to 549 ms (at least 70% of caption words matched in each scene). The final six-frame contact sheet at 9, 39, 79, 104, 135 and 157 seconds was visually reviewed, alongside 18 representative composition frames and a final credit close-up. Standalone TypeScript checking and both wallet guard tests passed.

See [remotion/ATTRIBUTION.md](remotion/ATTRIBUTION.md) for exact source revisions, local adaptations, and Remotion, snapcn, remocn, Paper shaders, Kokoro, Whisper, Geist and music licensing. Copied MIT components carry full license headers. No Pro components were used. No push, tags, publication, deployment or remote settings changes were performed.
