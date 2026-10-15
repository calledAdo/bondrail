# Bondrail supervised worker

Run this as a dedicated supervised Node process, never a Vercel request loop. `node --env-file=.env --import tsx src/main.ts --check` verifies configuration and RPC chain without sending writes. Writes require `BONDRAIL_ENABLE_TESTNET_WRITES=1` plus a funded local/testnet key. Mainnet143 is always rejected. Targets are a fixed bounded file; there is no remote arbitrary-contract or shell endpoint.

For each target the worker checks state, then performs one appropriate permissionless maintenance action: funding cancellation at deadline, undrawn expiry, sweep, maturity close, or final settlement after the evidence window. Each bond's asset is read from the bond, so accounts in any token are maintained. Covenant reports for Watched bonds are not sent here: the CRE reporter ([`ops`](../../ops)) owns them, so each job has one writer, and a monitor failure can never block expiry or closure.

The loop is bounded to120cycles by default, four writes per cycle, a fixed gas-price ceiling and1million gas per maintenance transaction. A durable lease coordinates one worker per maintenance signer. Transactions are simulated before send, then their actual receipts are checked. Logs say confirmed only after a successful receipt.

**Performance triggers — not yet deployed:** set `WORKER_CHECK_TRIGGERS=1` to include daily
`checkTrigger()` maintenance for target bonds using the new implementation. It defaults off and keeps
the original terms decoder for old deployments. With checking enabled, the worker reads trigger terms,
activation time, default state and `lastTriggerCheckDay`. It uses the latest chain block's UTC day,
waits until `today >= activationDay + 1 + triggerWindowDays` (excluding the entire activation UTC day),
and skips disabled/defaulted/non-Active/already-checked bonds.
The on-chain check day survives restarts and also reflects checks sent by other callers. A simulation
skips a race lost to another checker; the existing transaction journal still governs uncertain sends.
Maturity close and undrawn expiry take priority; checks precede sweeps so continuous receipts cannot
starve a check. Sweeps book receipts in the current day, which is excluded from that day's window.
Run the supervised worker regularly: checks are permissionless transactions, not an automatic timer,
and the last checked share persists if nobody calls. No live trigger transactions have been sent.

Use a supervisor restart policy with delay, durable storage and a fixed working directory. SIGTERM/SIGINT stop the loop. Copy `.env.example` and `targets.example.json`; zero addresses are placeholders. External broadcasting has not been run just because the worker code exists.

Maintenance transactions journal the operation and pending nonce before submission, then the returned hash and receipt. An uncertain send, timeout, journal failure or reverted receipt halts the worker. Restart refuses unresolved journals; inspect the named nonce/hash on the configured chain and reconcile the record before resuming. It never blindly replaces an uncertain transaction with another nonce.
