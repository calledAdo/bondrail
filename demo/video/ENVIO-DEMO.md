# Envio sponsor demo

Final deliverable: `output/envio/bondrail-envio-demo.mp4` and matching SRT.87.4seconds,1080p30, Michael male synthetic narration. For the optional <=2minute Envio sponsor video.

## Evidence and scope

The opening reuses the actual recorded October12 testnet payment from the technical demo. The video explicitly labels this previously recorded activity. The rest is a fresh read-only capture: RPC receipt, live HyperIndex query, selected returned fields, and deployed Bondrail account view. No new payments, approvals or other blockchain writes were sent.

- Transaction: `0xf0ac64fe77bf20f4aee6a9ca2941620ca60530687ae3dd97c8afc868d72d6e89`
- Account: `0x161231A4F7D7bff92C55966B33EEddb551f8E389`
- Bond: `0xa57E7Bd5c0874e195C192a43a6caF8aA22335C35`
- Live Envio endpoint discovered from the deployed application's own request: `https://indexer.dev.hyperindex.xyz/b2ced22/v1/graphql`
- Receipt Revenue event and indexed Payment/Split match:10000 base units revenue,2500 to bond,7500 to issuer. Test USDC has6decimals, so these are0.01,0.0025 and0.0075USDC.
- Issuer aggregate:20000 revenue units,2payments,2000000trade-volume units and2500toInvestors. The app displays2cents revenue,2payments and0.0025paid to investors.
- Controlled test activity; no detected funding link is not proof of independent customers.

`output/envio/evidence.json` preserves the RPC receipt and initial query. `recorded-query-response.json` is the actual response during recording. `app-recorded-responses.json` stores the deployed app's observed Envio responses. Query and receipt views are explicitly labelled read-only evidence viewers; they are not replicas of an Envio dashboard or an explorer. End frames are held for narration; this is not an indexing-latency benchmark.

## Rebuild

Existing capture is sufficient. Do not repeat the historical payment.

```sh
/tmp/slice-video-venv/bin/python demo/video/narrate_envio.py
/tmp/slice-video-venv/bin/python demo/video/render_envio.py
/tmp/slice-video-venv/bin/python demo/video/verify_envio.py
```

Capture sources: `envio-preflight.mjs`, `envio-evidence.mjs`, `capture-envio.mjs`; narration `envio.json`.

## YouTube title

Bondrail × Envio — From Onchain Payments to Revenue History

## YouTube description

Bondrail uses Envio HyperIndex to turn Monad transaction events into revenue history investors can inspect.

This demo follows one actual testnet payment through three layers:

1. A Monad transaction emits a Revenue event and splits a fee between the business and its bond.
2. A fresh query to the deployed Envio HyperIndex endpoint returns the matching Payment and Split records under the same transaction hash.
3. Bondrail uses indexed aggregates to display revenue history, payment totals and payer information in the live product.

The opening payment was recorded previously; the Envio query and app inspection are fresh read-only captures. All shown activity is controlled testnet activity. No detected funding link is not proof of an independent customer. Pauses are extended for narration; this is not a latency benchmark.

Try Bondrail: https://bondrail.vercel.app
Verify the payment: https://testnet.monadscan.com/tx/0xf0ac64fe77bf20f4aee6a9ca2941620ca60530687ae3dd97c8afc868d72d6e89

Built for the Metropolis Hackathon — Best Use of Envio.

#Bondrail #Envio #Monad

Final verification:87.4seconds,1920×1080@30fps,6,783,478bytes. Full audio/video decode passed; audio peak−1.4dB.14sampled frames and full-size live-query result reviewed. Receipt, recorded HyperIndex response and app aggregates match.
