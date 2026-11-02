# Revenue bonds, tradeable on Kuru

A 42-second Kuru episode in the Bondrail concept-film series. It starts from the investor's question after funding, introduces the bond's claims, shows a schematic Kuru market, follows a claim sale between two investors, links the claim price to expected repayment, states the trading caveat, and closes on the brand line. Original illustrations and synthesized music; no narration, application footage, wallet or chain activity.

## Deliveries

Generated media live in ignored `demo/video/output/kuru/`:

- `bondrail-kuru.mp4` — 1920 × 1080, 30 fps, 42 seconds.
- `bondrail-kuru-square.mp4` — 1080 × 1080, 30 fps, 42 seconds; independently arranged layout.
- `contact-sheet.jpg`, `contact-sheet-square.jpg` — twelve frames each, extracted from the final deliveries.
- `checks.json`, `banned-phrase-grep.txt` — media, copy and timeline acceptance results.
- `music-source.wav`, `music-measurement.json` — original score and normalization measurement.

The Remotion IDs are `Kuru` and `KuruSquare`. `Concepts`, `ConceptsSquare` and `BondrailUpdate` remain unchanged.

## Beats and timings

| Beat | Seconds | Main line | Picture |
| --- | --- | --- | --- |
| Hook | 0–5 | Funded a bond. Need your money back **before** maturity? | Charcoal field; three held claim tokens on a now-to-maturity rail; mint underline on “before”. |
| Claims | 5–11 | Every bond pays out in claims. | The persistent bond card appears; claim tokens fan out beside it. |
| Market | 11–18 | Claims **trade on Kuru**. | Schematic order book labelled “Claims / USDC”; bid and ask bars only, no numbers or prices; plain-text “Kuru” wordmark. |
| Exit | 18–25 | Exit early. **Sell** to another investor. | One investor node passes a claim to another; a USDC pill flows back. |
| Price | 25–33 | The price tracks what the business is **expected to repay**. | Revenue line rises and slips; the claim-price marker drifts up and back down. |
| Note | 33–37 | Trading depends on buyers. **Prices can move**. | Charcoal interlude; sparse bids in a market panel; a sale needs a buyer. |
| Close | 37–42 | Revenue bonds, tradeable on **Kuru**. | Logo, “Built on Monad”, bondrail.vercel.app · @useBondrail, tiny “Live on Monad testnet”. |

Every beat is at least 4 seconds long, so every headline is fully visible for far more than 1.5 seconds after its entrance. The bond card is mounted once and moves between beats; only the single sequential fade style is used.

## Direction

The film reuses the series system exactly: `#F6F5EF` paper, `#202A27` charcoal, `#9FE8CA` mint, the warm grey-to-mint gradient, Geist Sans and Geist Mono, the original bond card, investor nodes and marker accent. Headlines sit in the same right-hand column in landscape; the square version re-flows the headline above the artwork. The “How it works · illustration” kicker stays visible through the concept beats.

Motion uses only Remotion `interpolate` with cubic easing: 500 ms entrances, 600 ms card moves, and sequential 300 ms outgoing/incoming content fades. There is no CSS animation or external animation library.

## Product precision

The order book is a schematic: bar shapes only, with no quantities, prices, quotes or depth values. “Kuru” is plain text, not a Kuru logo asset. The sale diagram shows another investor taking the other side; the note says trading depends on buyers and prices can move. Nothing promises liquidity, a price, a yield or a return. The film never says “credit layer” or “loans”. The close says the product is on Monad testnet.

## Music

The score is original deterministic synthesis in `remotion/scripts/kuru-audio.py`: 96 BPM, warm sine-based chord voicings, soft bass, filtered noise percussion, sparse bells, and gentle impacts at editorial changes. It continues the harmonic vocabulary of the launch and Concepts films; no reference audio is sampled. There is no speech. A two-pass FFmpeg loudness normalization targets −18 LUFS integrated with a −2 dBTP ceiling, and the verifier measures the final AAC encodes.

## Rebuild locally

Requirements: the pinned Node dependencies already installed in `demo/video/remotion`, locally installed Chrome/Chromium, and the pinned Python packages in `remotion/requirements-concepts.txt` (`numpy`, `soundfile`, `pillow`, `imageio-ffmpeg`, `av`). No network is needed once dependencies are present. The working environment used here is `/private/tmp/bondrail-kuru-venv/bin/python`; set `BONDRAIL_VIDEO_PYTHON` to another environment if needed.

```sh
cd demo/video/remotion
export BONDRAIL_VIDEO_PYTHON=/private/tmp/bondrail-kuru-venv/bin/python
# Optional when Chrome is elsewhere:
# export KURU_CHROME=/path/to/chrome
npm run typecheck
npm test
npm run kuru:stills   # optional review stills
npm run kuru:render
npm run kuru:verify
```

`kuru-render.mjs` copies the licensed fonts and marks into an isolated ignored `public/kuru/`, synthesizes the score, and renders only `Kuru` and `KuruSquare`. `kuru-finish.py` converts Remotion’s full-range BT.601 intermediate to limited-range Rec.709 and encodes exact-duration AAC from the normalized WAV. Pass `-- --landscape` or `-- --square` to either Kuru command to render one layout. `KURU_REVIEW_TIMES=6,6.3,6.6` selects extra still times. The intermediate `*-render.mp4` files remain ignored.

## Acceptance checks

`kuru-verify.py` fully decodes both streams with PyAV and FFmpeg (`-xerror`); checks exact frame count, 30 fps cadence, resolution, H.264/yuv420p Rec.709, stereo 48 kHz AAC, 42-second duration, and absence of unexpected black frames; requires final audio between −19 and −17 LUFS with true peak at or below −1.5 dBTP. It scans all Kuru source for banned positioning, financial promises, amount patterns, addresses and operation UI terms. The timeline is checked for coverage, duration and reading holds. Both twelve-frame contact sheets are regenerated from the encoded deliveries.

Final local validation: Remotion typecheck passed; both existing offline validation tests passed. Both deliveries decoded successfully with 1,260 frames and exact 42.000-second video, audio and container duration. Final loudness: −18.01 LUFS integrated, −6.41 dBTP true peak, 0.6 LU range. Rec.709 tags, copy scan, timeline checks and both contact sheets passed. All twelve final frames were inspected in each format, along with the beat transitions and the price-chart motion. Media, stills and contact sheets are gitignored; licensed font sources remain tracked.
