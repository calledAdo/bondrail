> Historical recordings below retain their original names. Current helper scripts generate Bondrail-named outputs; they do not rename or rebrand existing footage.

# Bondrail demo: free local production

**Envio sponsor demo:** `output/envio/bondrail-envio-demo.mp4` — 1:27, actual recorded payment followed by fresh HyperIndex query and live revenue/payer views. Michael narration and captions. See [ENVIO-DEMO.md](ENVIO-DEMO.md) for evidence and upload text. No new chain writes.

**Chainlink sponsor demo:** `output/cre/bondrail-chainlink-cre-demo.mp4` — 1:36, original recorded CRE CLI simulation with one successful Monad testnet report, Michael narration and captions. See [CHAINLINK-DEMO.md](CHAINLINK-DEMO.md) for evidence and upload text.

**Latest founder pitch:** `output/founder-pitch/bondrail-founder-pitch.mp4` — 1:48, 1080p30, original founder voice, background blur, circular face overlay, supporting slides and actual testnet footage. Matching SRT included. See [FOUNDER-PITCH.md](FOUNDER-PITCH.md).

**Latest technical demo:** `output/technical/bondrail-technical-demo.mp4` — 2:40, 1080p30, male Michael narration, captions, and fresh Bondrail footage. Shows actual issuance, funding, activation, repayment and a separate Kuru trade. See [TECHNICAL-DEMO.md](TECHNICAL-DEMO.md) for evidence and reproduction. Original Bondrail-branded videos are preserved.

This directory builds a narrated, captioned 2:31 presentation video without a paid editor, paid speech service or API key. The user does not need to speak or operate the browser.

## Short Bondrail explainer (latest)

`output/explainer/bondrail-explainer.mp4`: 24.8 seconds, 1920×1080 at60fps, H.264/AAC, about1.9MB. Describes revenue-bond issuance, investor funding and repayment using original animated illustrations. Inspired by the structure of user-supplied `Downloads/useSpoke.mp4`; no reference assets or audio reused. Onscreen copy, original synthesized music/effects, no voiceover. Separate from the recorded app-operation demo; it does not replace that evidence video.

- Direction: `EXPLAINER-DIRECTION.md`.
- Render: `/tmp/bondrail-video-venv/bin/python demo/video/explainer.py`.
- Verify: `/tmp/bondrail-video-venv/bin/python demo/video/verify_explainer.py`.
- Storyboard: run renderer with `--preview`.
- QA report, export contact sheet and poster are under `output/explainer/`.

## Current presentation cut

The user supplied `elitr.mp4` as a storytelling reference and **deferred voice cloning**. The latest complete video is `output/slice-metropolis-presentation.mp4`, with matching `.srt`. It opens on the real landing page, establishes the revenue/capital problem, follows PumpLab's recorded funding and repayment, then demonstrates the investor flows and the Watched tier. Prior versions are preserved. The final export is 151.17 seconds, 1920×1080 at 30 fps, about 19.9 MB. Full decoding passed; 24 exported frames were visually reviewed and narration was checked with local speech recognition. Audio peaks at −3.9 dB.

This cut uses original animated explanations, close-ups, app/evidence compositions, Bondrail's typography and palette, fresh local Kokoro narration (`af_bella`), captions and a quiet original synthesized music bed. No reference footage, music or branding is copied. The supplied reference MP4 is ignored by Git. Most of the video displays actual recorded product operation or real chain receipts; the ten-second conceptual explanation is separate from the app.

Source and workflow:

- `PRESENTATION-DIRECTION.md`: reference analysis and design decisions.
- `presentation.json`: final story and narration text.
- `narrate_presentation.py`: cached per-line local speech and sentence timing.
- `present.py`: footage selection, camera keyframes, animated composition, original music, captions and MP4 assembly.
- `output/presentation/edit-decision-list.json`: source intervals, holds and scene timing.
- `output/presentation/validation.json`: final verification results.

```sh
/tmp/bondrail-video-venv/bin/python demo/video/narrate_presentation.py
/tmp/bondrail-video-venv/bin/python demo/video/present.py
```

`present.py --only=receipt` rerenders one scene. `present.py --finish` reassembles already rendered scenes with the current narration and music. Any narration change must be followed by rerendering its scene so burned captions match. The Native action's genuine before-state is held briefly to align its visible update with narration; edited timing is disclosed, and action playback itself is unretimed.

[VOICE-CLONING.md](VOICE-CLONING.md) preserves the free cloning research for later. The Qwen model download and load ultimately succeeded, but no user reference was supplied and no own-voice clone was generated. The current video uses synthetic narration while cloning is deferred. `output/slice-motion-v2-preview.mp4` is the earlier silent direction sample, not the latest full video.

## V1 status

**Completed:** `output/slice-metropolis-demo.mp4` is 170.02 seconds, 1920×1080 at 30 fps, with H.264 video and AAC audio. It passed full audio/video decoding, duration and audio peak checks, and sampled visual inspection across all eight scenes. Size: 9,025,968 bytes (about 8.6 MiB).

The final edit uses **real recorded app operation**, local Kokoro synthetic narration (`af_heart`) and captions. The eight-scene timeline is 170 seconds. Network access recovered on October 11, 2026, and the actual testnet actions succeeded:

- PumpLab Native purchase: 1 test USDC. The bond received 0.0025 USDC in the same transaction; collected repayment increased from 0.447887 to 0.450387 USDC.
- Kuru purchase: 0.1 test USDC; the app displayed 0.088 claims afterward.
- CurveLab deposit: 1 test USDC; the app displayed one claim and the updated raise.
- Two bounded token approvals. All five receipts report success.
- CRE scene: existing compliant report and its actual successful transaction. The recording does not execute a default.

Explorer sites required human verification, so the video shows clearly labelled **read-only RPC receipt reports**, generated from genuine transaction receipts and logs. These are not explorer screenshots. The Native action was submitted by the constrained Node signer while recording the live app; the Kuru and CurveLab actions were driven through the app UI.

The original failed Native take includes an unusable explorer tail. `edit.json` explicitly selects its verified successful portion and the separately recorded receipt view. The deposit capture manifest entry was recovered from preserved footage after concurrent processes overwrote metadata; its recovered timestamps are edit boundaries. Successful actions were not repeated.

Generated files live in ignored `output/`. No wallet keys, API credentials or model weights belong in Git. Public video hosting has not been performed; the repository URL returned 404 signed out and still needs public access for submission.

## Tools

- [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx), locally generated speech.
- [Kokoro model files](https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0): `kokoro-v1.0.int8.onnx`, `voices-v1.0.bin`.
- [Playwright](https://playwright.dev), actual browser interaction and video capture.
- FFmpeg through `imageio-ffmpeg`, encoding, composition, subtitles and audio normalization.
- Pillow and Bondrail's existing Geist font, for the frame and titles.

No Remotion dependency or commercial video service is required. This work did not use the user's API key or custom base URL.

## Local setup used for this session

```sh
UV_CACHE_DIR=/tmp/bondrail-uv-cache uv venv --python 3.12 /tmp/bondrail-video-venv
UV_CACHE_DIR=/tmp/bondrail-uv-cache uv pip install --python /tmp/bondrail-video-venv/bin/python kokoro-onnx==0.6.1 soundfile==0.14.0 pillow==12.3.0 imageio-ffmpeg==0.6.0
mkdir -p /tmp/bondrail-video-models
curl -L --fail https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx -o /tmp/bondrail-video-models/kokoro-v1.0.int8.onnx
curl -L --fail https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin -o /tmp/bondrail-video-models/voices-v1.0.bin
/tmp/bondrail-video-venv/bin/python demo/video/narrate.py
```

`BONDRAIL_VOICE_MODELS` overrides the model directory. Downloads and synthesis need no account. Tools under `/tmp` may need recreation after cleanup. The narration script reuses existing per-sentence WAVs; delete only the changed line's generated WAV when revising its text.

## Recording

Run `node demo/video/preflight.mjs` for read-only balances. `node demo/video/capture.mjs` checks the app and wallet connection without signing. `BONDRAIL_CHROME` overrides the existing Chromium binary path; `BONDRAIL_VIDEO_RPC` selects a real Monad testnet RPC; `BONDRAIL_VIDEO_APP` can select a correctly configured local instance of the same app.

For a **new** capture, only after the read-only connection check succeeds (the completed actions in this session must not be repeated):

```sh
node demo/video/capture.mjs --record
/tmp/bondrail-video-venv/bin/python demo/video/render.py
```

Recording is a real testnet operation: a one-USDC Native buy, 0.1-USDC Kuru buy and one-USDC CurveLab deposit, plus bounded token approvals where needed. It uses the existing `pumplab-organic-0` demo wallet, whose key remains in Node. An injected EIP-1193 provider forwards requests to that signer; this is not a mock connector or simulated transaction. The video explicitly labels automated testnet wallet use.

The signing path checks chain 10143, origin, destinations, operation types and amount limits. It never sends native value. A saved pending/successful operation prevents accidental repeat execution after interruption. Public receipts are saved in `transactions.json`. Do not delete that journal to retry a successful recording: retain the footage and recapture only read-only scenes, or deliberately prepare a new capture plan.

`--only=02-credit` selects one scene. Before a full recording, check current balances, phases, market liquidity and explorer selectors. The recorded takes have been visually inspected. `edit.json` stores the selected intervals and holds; adjust it when using new footage because wall-clock offsets can differ slightly from encoded timestamps. Run transaction recordings sequentially to avoid signer/journal races.

The existing live Oracle bond is never defaulted for this recording. The Watched scene shows an existing real compliant report and its receipt; narration does not claim default was executed.

## Output and verification

Render from the completed capture:

```sh
/tmp/bondrail-video-venv/bin/python demo/video/render.py
```

- `output/slice-metropolis-demo.mp4`: narrated, captioned 1920×1080 H.264/AAC final.
- `output/slice-metropolis-demo.srt`: separate subtitles.
- `output/evidence.md`: readable transaction links, capture disclosures and remaining submission steps.
- `output/transactions.json`: public hashes, receipts, decoded call arguments and logs.
- `output/native-proof.json`: exact before/after collected repayment and receipt.
- `output/native-rpc.json`, `cre-rpc.json`, `cre-report.json`: receipt and report evidence.
- `output/capture.json`, `output/raw/`: original recordings and capture metadata.
- `output/validation.json`: final duration, media streams and verification results, generated during final QA.
- `output/slice-style-preview.mp4`: earlier labelled still-frame preview; **not** the final submission video.

`scenes.json` defines narration and slots; `edit.json` defines selected footage, explicit real-frame holds, and the replacement receipt segment. Actions play at recorded speed. Held frames and removed waiting time are disclosed as edited timing; the edit is not a transaction-speed benchmark. App balances, warnings and transaction details are not changed. Total timeline is 170 seconds, leaving ten seconds below the limit.

The original script is preserved at `docs/demo-video-script.md`. `docs/demo-production-plan.md` contains the earlier research; this directory contains the implemented zero-budget workflow. No paid service, API key, founder recording, product source change, live-bond default, public upload or hackathon submission was required to generate the local artifact.
