# Bondrail, continued

A 76-second concept film continuing the launch explainer: the same bond that investors funded is now repaying. It carries the audience through staged release, a performance trigger, vaults, readable bond terms, repayment history, and native developer integration. Original illustrations and synthesized music; no narration or application footage.

## Deliveries

All generated media live in ignored `demo/video/output/concepts/`:

- `bondrail-concepts.mp4` — 1920 × 1080, 30 fps, 76 seconds.
- `bondrail-concepts-square.mp4` — 1080 × 1080, 30 fps, 76 seconds; independently arranged layout.
- `contact-sheet.jpg`, `contact-sheet-square.jpg` — twelve frames each, extracted from final deliveries.
- `storyboard.html` — paired final frames; tracked editorial storyboard in [CONCEPTS-STORYBOARD.md](CONCEPTS-STORYBOARD.md).
- `checks.json`, `banned-phrase-grep.txt` — media and copy acceptance results.
- `music-source.wav`, `music-measurement.json` — original score and normalization measurement.
- `references/` — preserved local study sheets from the interrupted run.

The Remotion IDs are `Concepts` and `ConceptsSquare`. `BondrailUpdate`, its implementation, source data, captures and existing render workflow remain unchanged.

## Direction and timing

The launch's `#F6F5EF` paper, `#202A27` charcoal, `#9FE8CA` mint, soft warm-grey gradient, white card, investor nodes and Geist typography are carried forward. Mint marker emphasis is the only accent system; the hook uses the same marker as an underline. No serif font. The bond card persists as a single mounted component, changing position and scale between concepts. Only Remotion `interpolate` with cubic easing drives motion: 500 ms object entrances, 600 ms spatial moves, and sequential 300 ms outgoing/incoming content fades, no CSS animation or external animation library.

| Beat | Seconds | Main line |
| --- | --- | --- |
| Launch reprise | 0–2.4 | Revenue flows back. |
| Hook | 2.4–6 | What happens after the bond? |
| Staged release | 6–16 | Capital in stages. The rest is earned. |
| Performance trigger | 16–24 | If revenue slips, investors’ share steps up. |
| Vaults | 24–32 | Back one business. Or deposit once, across many. |
| Bond explanation | 32–41 | Know what you own. |
| Track record | 41–49 | Repay on time. Raise again. |
| Builders | 49–56 | Revenue routes from day one. |
| Numbered close | 56–64 | What makes Bondrail different? |
| Three-line rhythm | 64–70 | Businesses set the terms. Investors fund them. Revenue repays them. |
| Brand close | 70–76 | Revenue bonds for onchain businesses. |

The detailed choreography, copy, risks and square arrangement are in the storyboard. Each headline has at least 1.5 seconds fully visible. The first line has 1.53 seconds after its marker finishes, and the final rhythm line has 1.63 seconds; longer beats allow substantially more reading time.

## Product precision

The diagrams describe concepts, not observed activity. “How it works · illustration” stays visible during the concept sequence. Progress bars, chart traces and record slips are schematic; no financial values or customer results are invented.

Staged release explicitly returns the **unreleased** capital if the milestone is missed. The performance illustration says “Below the level at the check” and “When a performance trigger is enabled”; it does not depict every receipt independently changing the share. The lifecycle is an explanatory rail, not a claim that every bond reaches full repayment: the adjacent risk line says the investor may not be fully repaid. The repeat-raise scene says future funding is a new decision. The code card is a minimal native integration illustration, not executable code or an installation recording. The install kicker identifies the SDK; `BondrailEarner` itself is the contracts integration base.

Concepts uses a self-contained local rendering path and requires no data capture, accounts, remote services or financial operations.

## References studied

All five contact sheets were viewed before implementation; references remain outside tracked source. Only techniques were borrowed; none of their assets, recordings, music, product data, distinctive wording or branding enter the film.

| Reference | Local source | Technique used |
| --- | --- | --- |
| Bondrail launch | `demo/video/explainer.py`, `EXPLAINER-DIRECTION.md`; rendered `/Users/adokiye/Nervos_Development/slice/demo/video/output/explainer/bondrail-explainer.mp4` | Direct continuity: same illustrated card geometry, status, investor glyphs, warm mint/grey world, sequential marked phrases, brand close. This is our own brand material. |
| motion (teampot) | `/Users/adokiye/Downloads/motion_videos/motion.mp4` | Underlined question hook, simple node/flow diagrams, short declarative phrases, three-line rhythmic ending. |
| elitr | `/Users/adokiye/Downloads/motion_videos/elitr.mp4` | Editorial hierarchy, small mono context labels, numbered three-point close. Its serif accent, real product figures and screenshots are not used. |
| parralel | `/Users/adokiye/Downloads/motion_videos/parralel.mp4` | Calm charcoal pauses and a restrained illustrated panel paired with one main idea. |
| useSpoke | `/Users/adokiye/Downloads/motion_videos/useSpoke.mp4` | Persistent illustrated object, soft light field and spatial continuity—the same techniques inherited through our launch film. |

## Music and licenses

The score is original deterministic synthesis in `remotion/scripts/concepts-audio.py`: 100 BPM, warm sine-based chord voicings, soft bass, light filtered-by-envelope noise percussion, sparse bells, and gentle impacts at editorial changes. Harmonic colors and instrumentation continue the approach in `explainer.py`; no reference soundtrack is sampled. There is no speech. A two-pass FFmpeg loudness normalization targets −18 LUFS integrated with a −2 dBTP ceiling; the verifier measures each final AAC encode.

| Material | Source / license |
| --- | --- |
| Geist Sans variable + Geist Mono Regular | Vendored unchanged in `brand/bondrail/fonts/` from the installed `geist` package. SIL Open Font License 1.1, included as `OFL.txt`; font assets load locally. |
| Bondrail lockups and symbol | Existing original `brand/bondrail/svg/` assets. The card symbol uses those same path coordinates. |
| Illustrations, animation and score | Original work for this project; no stock, sampled music, AI-generated raster artwork, or external reference assets. |
| Remotion 4.0.395 | Existing pinned package, Remotion License; see `remotion/ATTRIBUTION.md`. This film uses core React/SVG/Remotion; none of the vendored UI kits or shader components are used by Concepts. |
| Python production tools | NumPy (BSD-3-Clause), SoundFile (BSD-3-Clause), Pillow (HPND), imageio-ffmpeg (BSD-2-Clause), PyAV (BSD-3-Clause). FFmpeg is a local tool; the imageio build includes GPL components. Tools are not bundled into the delivered MP4s. |

## Rebuild locally

Requirements: Node with the package's pinned dependencies already installed (`npm ci` in `demo/video/remotion` if needed), locally installed Chrome/Chromium, and Python with the pinned packages in `remotion/requirements-concepts.txt` (`numpy`, `soundfile`, `pillow`, `imageio-ffmpeg`, `av`). No network is needed once dependencies are present. The existing environment is `/private/tmp/bondrail-video-venv/bin/python`.

```sh
cd demo/video/remotion
export BONDRAIL_VIDEO_PYTHON=/private/tmp/bondrail-video-venv/bin/python
# Optional when Chrome is elsewhere:
# export CONCEPTS_CHROME=/path/to/chrome
npm run typecheck
npm test
npm run concepts:stills
npm run concepts:render
"$BONDRAIL_VIDEO_PYTHON" scripts/concepts-verify.py
```

`npm test` runs the pre-existing pure validation tests without network calls or account access. Do not run `prepare:assets`, the old `render`, `verify:chain` or `evidence` for this film. `concepts-render.mjs` copies licensed fonts and marks to an isolated ignored `public/concepts/`, synthesizes music, and renders only the requested Concepts compositions. `concepts-finish.py` then converts Remotion’s full-range BT.601 intermediate to limited-range Rec.709 and uses the original normalized WAV for an exact-duration final AAC encode. The intermediate `*-render.mp4` files remain ignored. Pass `-- --landscape` or `-- --square` to either Concepts command to render one layout. `CONCEPTS_REVIEW_TIMES=6,6.3,6.6` selects additional still times. No live browser or capture integration is involved.

To use a new local Python environment, install `requirements-concepts.txt` there and set `BONDRAIL_VIDEO_PYTHON`. `concepts:verify` uses that variable when set, otherwise the existing local environment.

## Acceptance checks

`concepts-verify.py` fully decodes both streams in both final exports with PyAV and FFmpeg (`-xerror`); checks exact frame count, 30 fps cadence, resolution, H.264/yuv420p Rec.709, stereo 48 kHz AAC, 76-second duration, and absence of unexpected black frames; requires final audio between −19 and −17 LUFS with true peak at or below −1.5 dBTP. It runs `rg` against all Concepts source for banned positioning, financial amount patterns, addresses and operation UI terms. The timeline is checked for coverage and reading holds. Final contact sheets are regenerated from the encoded deliveries.

Visual inspection covers all twelve storyboard frames in both formats and transition samples. No changes to Update are required to rebuild or render Concepts.

Final local validation (2026-10-16): Remotion typecheck passed; both existing offline validation tests passed. Both deliveries decoded successfully with 2,280 frames and exact 76.000-second video, audio and container duration. Final loudness: −18.01 LUFS integrated, −6.65 dBTP true peak, 0.4 LU range. Rec.709 tags, copy grep and timeline checks passed. All twelve final frames and nine transition samples were visually inspected in each format. Media and reference sheets are gitignored; the licensed font sources are tracked.
