# Task 04 validation — 2026-10-14

The delivered result is the benchmark and no-ship design. All production contracts remain identical to `51f6a8d`; there is no candidate implementation, ABI/event change, contract commit, or lane-test claim. No Monad testnet execution, external deployment or push occurred. The local-only fixtures are disposable Anvil contracts.

## Dry-run results

Each run used 20 funded wallets × 5 measured payments per wallet per arm, one untimed warmup per wallet per arm, 1,000,000 smallest token units per payment, one-second local blocks and 100 ms receipt polling. Both modes passed their exact revenue/count delta assertions. The active fixture splits 20% to investors inside each settlement.

| Mode | Arm | Success | Wall ms | Latency p50 / p95 ms | Transactions/block | Block range | Receipt gas p50 |
|---|---|---:|---:|---:|---:|---|---:|
| Passthrough | One account | 100/100 | 984.42 | 971.98 / 977.92 | 100 | 97–97 | 119,380 |
| Passthrough | 20 accounts | 100/100 | 994.21 | 982.31 / 987.35 | 100 | 98–98 | 119,380 |
| Active bond | One account | 100/100 | 991.98 | 980.40 / 984.11 | 100 | 317–317 | 187,085 |
| Active bond | 20 accounts | 100/100 | 977.47 | 965.56 / 970.92 | 100 | 316–316 | 187,097 |

Passthrough used shared-first order; active used separate-first. These two runs are script validation, not a paired experimental comparison across modes. All 400 measured payments and 80 warmups succeeded. An additional cold-path check (`BENCH_WALLETS=2 BENCH_PAYMENTS=2 BENCH_WARMUPS=0`) passed 8/8 and verified report/checkpoint cleanup. Anvil does not execute transactions in parallel. The owner must run the documented Monad command for chain-specific measurements.

Full per-transaction latency and per-block records: [passthrough JSON](./2026-10-14T20-39-48-964Z-anvil-passthrough.json), [active JSON](./2026-10-14T20-40-37-249Z-anvil-active.json). [Conflict evidence](./conflicts-anvil.json) compares final changed storage of two different payer transactions per arm: 6 common slots for passthrough, 9 for active, and 0 for each separate-account sample. In particular, the asset's account-balance slot is shared. Idempotent guard/timestamp writes are absent from these diffs and must not be inferred absent from execution.

To reproduce state-diff evidence while the local node still retains a run, use two recorded hashes from different payers with:

```sh
~/.foundry/bin/cast rpc --rpc-url http://127.0.0.1:8545 \
  debug_traceTransaction TRANSACTION_HASH \
  '{"tracer":"prestateTracer","tracerConfig":{"diffMode":true}}'
```

Intersect the `post[address].storage` keys of the two traces. Source-level slot labels come from `forge inspect --root contracts SliceAccount storageLayout --json` and the equivalent `SliceBond` command. The fixture token's `_balances` mapping has base slot zero.

## Gas before / after

`~/.foundry/bin/forge test --root contracts --gas-report` ran **before any production-contract edits** (there were none). [Raw output](./gas-baseline.txt). These are SliceAccount function-call gas distributions across the existing tests, which include expected reverts, zero fees, no-op sweeps, cold initialization and invariant actions; they are not all successful end-to-end payments. See receipt gas above for the successful warmed settlement workload. Fuzz distributions can vary between runs.

| Entry point | Before median | Before min–max | After candidate | Delivered contract change |
|---|---:|---:|---|---|
| `collect` | 256,063 | 22,303–421,006 | Not implemented | None |
| `collectWithPermit` | 306,059 | 306,059–306,059 | Not implemented | None |
| `settleOut` | 76,595 | 22,060–335,029 | Not implemented | None |
| `settle` | 189,783 | 17,217–418,376 | Not implemented | None |
| `sweep` | 118,767 | 15,125–335,860 | Not implemented | None |

There is no measured before/after gas delta. The no-ship decision is based on remaining shared dependencies and added accounting complexity, not an invented gas regression or an Anvil throughput claim.

## Checks and sizes

Foundry 1.8.4; solc 0.8.28, optimizer 200, via IR, Cancun. `forge test --root contracts --gas-report`: **79 passed, 0 failed, 0 skipped**, including the accounting invariant at **128 runs, 8,192 calls, 0 reverts**. Existing tests are unchanged. No new lane fuzz tests are applicable because no lanes were implemented.

`~/.foundry/bin/forge build --root contracts --sizes` exited 0:

| Contract | Runtime bytes (before and delivered) | Initcode bytes |
|---|---:|---:|
| SliceAccount | 8,090 | 8,132 |
| SliceBond | 11,275 | 12,040 |
| SliceFactory | 11,944 | 13,393 |
| SliceCovenant | 8,893 | 10,168 |

All are below the 24,576-byte EVM runtime limit. Existing Foundry lint warnings remain; no compilation or test failures.

| Command | Exit | Output/result |
|---|---:|---|
| `npx -y pnpm@10.32.0 -r test` | 0 | 101 passed, 0 failed across 7 packages |
| `npx -y pnpm@10.32.0 --dir indexer test` | 0 | 7 passed, 0 failed (separate workspace) |
| `npx -y pnpm@10.32.0 --dir indexer exec tsc --noEmit` | 0 | No output |
| `npx -y pnpm@10.32.0 --dir apps/web exec tsc --noEmit` | 0 | No output |
| `npx -y pnpm@10.32.0 --dir packages/sdk exec tsc --noEmit` | 0 | No output |
| `node_modules/.bin/tsc -p scripts/bench/tsconfig.json` | 0 | No output |

Workspace totals: scoring 12, observer 9, worker 1, SDK 28, web 4, demo agent 6, facilitator 41. Node emitted its existing `module.register()` deprecation warning. TypeScript checks had no diagnostics. The benchmark uses the installed TypeScript 5.9.3 binary; its documented pnpm equivalent resolves the same binary.
