# Bondrail technical demonstration

Working-product recording for the Metropolis submission. Export length 159.74 seconds (2:40), below the 3-minute maximum. 1920×1080 at 30 fps, H.264/AAC. Opens on the live homepage, follows one testnet revenue bond through issuance, funding, activation and a real repayment, then demonstrates a separate existing Kuru market. No slides or code walkthrough.

Narration: local Kokoro `am_michael`, a synthetic male voice. No paid services, voice cloning or user recording required. Voice alternatives are in `output/voice-options/`.

## Demo scenario

LaunchLab is a team-run test business, explicitly described as such in its signed profile. It uses the previously reviewed PumpLab contract template. Its traffic is controlled demo activity, not customer traction. A fresh revenue account avoids disturbing existing active bonds. Actual chain history matures for 600 seconds before issuance.

- Monad testnet, chain ID 10143.
- Revenue account: `0x161231A4F7D7bff92C55966B33EEddb551f8E389`.
- Revenue source: `0x7aB9c30B8762CA46C29dA2c1c7f190C934fC524D`.
- Bond: `0xa57E7Bd5c0874e195C192a43a6caF8aA22335C35`.
- Actual raise: 2 test USDC; repayment cap: 2.4; share: 25%; release: 50% at activation, remaining 50% gated by milestone/time.
- A 1-test-USDC trade generates a 0.01 fee; once active, 0.0025 goes to the bond atomically.
- Kuru example: existing PumpLab bond, distinct from the newly issued LaunchLab bond; 0.1-test-USDC purchase.

## Production and evidence

`prepare-technical.mjs` performs bounded, journalled preparation. `capture-technical.mjs --scene=<name>` operates the real production UI with a Node-held test wallet. It allows only scene-specific destinations, methods and small amounts. Keys are never passed to the browser or written into evidence. Confirmed actions must not be repeated for retakes; reuse their recordings.

`output/technical/preparation-transactions.json` and `transactions.json` are durable receipt journals. `scenario.json` holds public addresses and test-wallet aliases only. `capture.json` records source video files and event times. `payment-proof.json` records before/after repayment values. Receipt views decode actual RPC logs and are labelled as such, not presented as an explorer website.

Recordings may omit waits and adjust playback duration. The film explicitly says edited timing and is not a latency benchmark. Cursor highlighting and camera motion are editorial; application values and transactions are not simulated. The Native payment uses the automated Node signer while recording the live bond page; issuance, deposit, activation and Kuru buy use actual UI controls.

```sh
/tmp/bondrail-video-venv/bin/python demo/video/narrate_technical.py
/tmp/bondrail-video-venv/bin/python demo/video/render_technical.py
```

Final output: `output/technical/bondrail-technical-demo.mp4`, with matching SRT captions. Upload separately to a publicly accessible video host for submission.

## Confirmed lifecycle transactions

- approve: `0x7c0e9bc15004c486462bfec23a3c3662233d3b476fbcb8c17925a06492072359` — success.
- placeAndExecuteMarketBuy: `0xa7f7d63d4277787f4b60bcf177855a0aac6b989e5a02425c127ce16ecb6b2cad` — success.
- createBond: `0x088199a4635fb94e891eb983ee31c6f063cfa49e10615704c0cc26f85db7519c` — success.
- approve: `0xbfe4be00bf6fe8c58855c57041fe25a444f5d3522b82dce284155254ce550e4c` — success.
- deposit: `0x5d77dc7ed5abba7df95fb5a1aaa645b7ef71efc61bb52710d65b5b34fd1966df` — success.
- activate: `0x79ba339595031d37c78dde8bc3db7edbd5bbff750e00c07feba40c1a17769d2b` — success.
- approve: `0x2235aefaa9fff40ae93f4ae52b9809f887f9c568daf3bdba17d4987e4225e1dc` — success.
- buy: `0xf0ac64fe77bf20f4aee6a9ca2941620ca60530687ae3dd97c8afc868d72d6e89` — success.
