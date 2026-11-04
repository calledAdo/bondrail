> llmtimeline · cross-agent work record. state.md is the live snapshot — rewrite it in place. sessions/ is append-only history — never edit past files. Any agent: read this file and the newest sessions/ entries before starting.

# Project State — updated 2026-11-04T10:57Z by codex (session 039)

## Goal
Task 30: remove JSON-RPC batch arrays from browser/server HTTP transports that may use Monad’s public RPC, preserve viem multicall, and keep the bond detail page’s RPC load reasonable. Verify the target bond page against live public services, run requested checks, and make one local commit with the required co-author trailer.

## Tasks
- [x] Inspect repository instructions, transport configurations, chain config, and bond page reads.
- [x] Implement transport and request deduplication changes with a regression test.
- [x] Measure headless real RPC requests and verify the requested bond page content.
- [x] Run `pnpm check:all` and `pnpm build:apps`.
- [x] Review/stage the scoped changes and create one local commit.

## Summary
On branch `next`, removed JSON-RPC HTTP batching from `apps/web/src/lib/wallet.ts`; retained wagmi multicall and added a 5-second default query stale time. Added verified Multicall3 config to shared Monad testnet chain metadata. Production headless baseline made 17 batch-array POSTs and showed “The bond terms could not be read”. Fixed local page made 5 single POSTs, all HTTP 200, and rendered the summary sentence, timeline, What you get, risks, and Kuru Buy claims without a “could not be read” message. The regression test, `pnpm check:all`, and standalone `pnpm build:apps` pass. Committed locally as `07edbe3` with the required co-author trailer.

## Next
Complete. The local worktree is clean; no push or deploy occurred.

## Notes
- Do not push, deploy, make testnet transactions, or read `~/.slice`, `~/.bondrail`, `~/.zeitgeist`, or `~/.bondrail-server-backup`.
- Keep viem multicall batching enabled where configured; remove JSON-RPC HTTP batching.
- `apps/agent` does not exist; `demo/agent` has no JSON-RPC batch transport, and SDK code has no default transport. Shared scripts already pass `batch: false` to HTTP.
- Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` returned bytecode from Monad testnet chain 10143.
- Builds emit existing Fumadocs `::highlight` CSS parser and Next NFT trace warnings, but complete successfully.
