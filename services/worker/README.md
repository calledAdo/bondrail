# Slice supervised worker

Run this as a dedicated supervised Node process, never a Vercel request loop. `node --env-file=.env --import tsx src/main.ts --check` verifies configuration and RPC chain without sending writes. Writes require `SLICE_ENABLE_TESTNET_WRITES=1` plus a funded local/testnet key. Mainnet143 is always rejected. Targets are a fixed bounded file; there is no remote arbitrary-contract or shell endpoint.

For each target the worker checks state, then performs one appropriate permissionless maintenance action: funding cancellation at deadline, undrawn expiry, sweep, maturity close, or final settlement after the evidence window. Watched testnet targets additionally run the actual CRE CLI and verify both the transaction receipt and target `ObservationAccepted` event. Monitor failure never prevents independent expiry/closure checks. Chain31337 supports maintenance; CRE reporting targets the supported Monad testnet selector.

The loop is bounded to120cycles by default, four writes per cycle, a fixed gas-price ceiling and1million gas per maintenance transaction. A durable lease coordinates one worker per maintenance signer. CRE has its own credential/nonce management; configure a separate signer for it. Transactions are simulated before send, then their actual receipts are checked. Logs say confirmed only after a successful receipt. CRE is spawned without a shell and with bounded output/time; its raw output is not printed because it may contain provider details.

Use a supervisor restart policy with delay, durable storage and a fixed working directory. SIGTERM/SIGINT stop the loop and child process. Copy `.env.example` and `targets.example.json`; zero addresses are placeholders. External broadcasting has not been run just because the worker code exists.

Maintenance transactions journal the operation and pending nonce before submission, then the returned hash and receipt. An uncertain send, timeout, journal failure or reverted receipt halts the worker. Restart refuses unresolved journals; inspect the named nonce/hash on the configured chain and reconcile the record before resuming. It never blindly replaces an uncertain transaction with another nonce.
