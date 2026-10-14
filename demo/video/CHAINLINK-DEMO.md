# Chainlink CRE sponsor demo

Purpose: satisfy the required <=2minute video showing a successful CRE CLI simulation or live CRE deployment. This video demonstrates **local CLI simulation with broadcast to Monad testnet**, not production CRE deployment or DON consensus.

Final output: `output/cre/bondrail-chainlink-cre-demo.mp4`, matching SRT. Target96.23seconds,1920×1080@30fps; Michael synthetic male narration. Actual browser capture and live CLI stdout, followed by a clearly labelled RPC evidence report. End frames held for narration; not a latency benchmark. No default executed.

## Evidence

- Bond: `0xd30bf6d5ecf1f55D1212F1a66F9521eEFBA50c21`
- Covenant: `0x96a3fe15d3f311728ae836b9b0a7ad2feb252cb3`
- Report transaction: `0x51baffd86c3cd274b3f486245bf2dde54d1a515cca01b62d77f7e3d47639c452`
- Monad testnet block70660551; `ObservationAccepted`, result1 (Compliant), epoch59729600.
- Explorer: https://testnet.monadscan.com/tx/0x51baffd86c3cd274b3f486245bf2dde54d1a515cca01b62d77f7e3d47639c452
- `output/cre/broadcast.json` preserves the RPC receipt and decoded event. Never rerun a successful broadcast for a retake.

## Setup and recording notes

The default local observer registry referenced an older deployment. An isolated observer on8788 used the current deployed policy from CRE config; the existing registry was preserved. A dry simulation passed. The initial broadcast was rejected for insufficient signer balance, with no hash and latest/pending nonce396. Failure logs and reconciliation were preserved. Transferred0.2testnetMON from the existing demo payer to the CRE signer; `gas-topup.json` records the successful topup. Second attempt succeeded. No user funding needed.

The CLI displays a secret-mapping naming warning, not a secret value. Output capture redacts credential values and the local project path. The testnet forwarder is permissionless; pinned observer-signature checks remain an explicit trust assumption.

Files: `cre-preflight.mjs`, `cre-gas.mjs`, `capture-cre.mjs`, `cre.json`, `narrate_cre.py`, `render_cre.py`, `verify_cre.py`. Re-render only from existing capture/narration, without new writes:

```sh
/tmp/slice-video-venv/bin/python demo/video/narrate_cre.py
/tmp/slice-video-venv/bin/python demo/video/render_cre.py
/tmp/slice-video-venv/bin/python demo/video/verify_cre.py
```

## YouTube upload

Title: Bondrail × Chainlink CRE — Revenue Covenant Checks on Monad

Description:

Bondrail uses Chainlink CRE to check whether covered paid API endpoints continue routing payments to the revenue account committed in a bond's policy.

This demo shows an actual CRE CLI simulation with broadcast enabled: independently fetching payment offers, validating signed evidence, generating a report, and recording a compliant observation on Monad testnet.

The transaction succeeds and emits ObservationAccepted with result1 (Compliant). Fresh compliant observations support Watched bond activation; qualifying violations can trigger the contract's default path. This demonstration does not trigger a default.

This is a local CRE simulation with a real testnet transaction, not a production CRE deployment or demonstration of live DON consensus. The testnet setup retains a trusted observer signer. Pauses are extended for narration.

Try Bondrail: https://bondrail.vercel.app
Transaction: https://testnet.monadscan.com/tx/0x51baffd86c3cd274b3f486245bf2dde54d1a515cca01b62d77f7e3d47639c452

Final verification:96.23s,1920×1080@30fps,7,312,857bytes; full audio/video decode passed, audio peak−1.4dB;14 sampled frames plus full-size CLI result reviewed. Text artifact credential scan passed. Temporary observers stopped.
