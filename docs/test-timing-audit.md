# Test timing audit — Task 18

Audited on 2026-10-15: all 37 repository-owned `*.test.*`, `*.spec.*` and
`*.t.sol` files, plus the local E2E and package verification scripts. Searched
for wall-clock reads, timer waits, elapsed-time comparisons and timeout APIs;
also checked indirect dependencies such as caches and receipt polling.

## Changes

- `packages/shared/test/rpc.test.ts`: replaced all real pacing waits and elapsed
  time bounds with a virtual scheduler. Assertions now check exact 167 ms
  six-RPS spacing (the existing millisecond rounding), 500 ms spacing after a
  lower shared limit, concurrency admission, cross-transport cooldown and
  equal jitter at fixed random samples. Additional cases cover idle burst
  prevention and exponential backoff through its five-second cap. Every RPC
  fixture, including failover and abort cases, uses virtual time.
- `packages/scoring/src/nansen.test.ts`: froze `Date` with the test context's
  automatically restored mock clock. The cache test now explicitly checks
  that the second lookup returns the cached result, independent of the real
  five-minute TTL or a host clock adjustment.

`createRpcTransport` accepts an optional `RpcScheduler` (`now` and a cancellable
`schedule`) and random source. Scheduler identity selects the shared bucket,
so tests can isolate time domains while sharing limits across clients. With
options omitted, transports still share one process-wide bucket using
`performance.now`, `setTimeout`, `clearTimeout` and `Math.random`; pacing,
concurrency, retry and cooldown calculations are unchanged. The fake scheduler
yields an event-loop turn with `setImmediate` to finish viem/Response promise
work; it never waits for a wall-clock interval or asserts elapsed real time.

## Other tests inspected

Paths below are relative to the repository root. No elapsed-time bounds were
loosened; the remaining tests either control time already or do not assert it.

| Files | Finding / disposition |
| --- | --- |
| `services/facilitator/test/facilitator.test.ts`, `settlement.test.ts` | Inject fixed/mutable `now` and block timestamps; receipt timeouts are thrown by stubs. The `20_000` assertion checks a configured timeout argument, not elapsed time. Retained. |
| `services/observer/test/observer.test.ts` | Injects `() => 3001` for epoch/freshness checks; storage concurrency awaits promises. Retained. |
| `services/worker/test/plan.test.ts` | Explicit bigint time inputs, including exact day/lifecycle boundaries. Retained. |
| `packages/sdk/src/yield.test.ts`, `credit-profile.test.ts`; `apps/web/src/lib/bond-yield.test.ts` | Explicit numeric time inputs. Retained. |
| `packages/sdk/src/x402-guard.test.ts` | Guard implementation has a real TTL, but each test creates a fresh guard and makes one guarded request. No cache expiry or elapsed-time assertion. Retained. |
| `packages/sdk/src/credit.test.ts`, `terms.test.ts`, `trigger.test.ts`, `x402.test.ts` | Fixed input data and mocked clients; no wall-clock assertions. |
| `packages/scoring/src/envio.test.ts`, `index.test.ts` | Fixed history fixtures and mocked fetches; no elapsed-time assertions. |
| `services/attester/test/attestation.test.ts`, `relay.test.ts` | Fixed periods/block fixtures and mocked receipt completion; no elapsed-time assertions. |
| `services/facilitator/test/gas.test.ts`, `proxy.test.ts` | Pure policy assertions or awaited local HTTP responses; no fixed sleep gaps. |
| `demo/agent/test/payment.test.ts`, `preflight.test.ts`, `reconcile.test.ts`, `routes.test.ts` | Mocked responses and fixed payment/history data; the payment timeout is a synthetic error. No wall-clock assertions. |
| `indexer/test/credit.test.ts`, `settlement.test.ts` | Explicit event/block timestamps. Retained. |
| `scripts/deployment-path.test.mjs` | File selection/validation only; no timing dependencies. |
| `contracts/test/AccountingInvariant.t.sol`, `AssetsAndFees.t.sol`, `Bondrail.t.sol`, `CreditRegistry.t.sol`, `Native.t.sol`, `Settle.t.sol`, `Trigger.t.sol`, `Vault.t.sol` | Foundry `vm.warp` / virtual block timestamps, including fuzz/invariant tests. Retained. |
| `contracts/test/IntegrationInterfaces.t.sol` | ABI selector assertions; no timing dependencies. |
| `examples/native-project/test/NativeProject.t.sol` | Local EVM block timestamps for contract terms; independent of host time. Retained. |

Also inspected `scripts/e2e-local.ts`, `packages/sdk/scripts/verify-pack.mjs`
and `packages/contracts/scripts/verify-pack.mjs`. The package checks have no
elapsed-time assertions. The opt-in local E2E script polls actual service
readiness (100/250 ms retry intervals), awaits browser conditions, and uses
300-second subprocess / three-second cleanup watchdogs. Those intervals
control polling and failure cleanup; correctness is checked after readiness,
not by assuming a fixed sleep completed on time. They remain real because
they coordinate external local processes. E2E was inspected, not executed as
part of this task; `check:all` does not run it. Vendored library code and demo
recording scripts are not repository test suites.

## Verification

Using Node 24.22.0 and pnpm 10.32.0:

```sh
for run in $(seq 1 30); do
  pnpm --filter @bondrail/shared test || exit 1
done
for run in $(seq 1 30); do
  nice -n 19 pnpm --filter @bondrail/shared test || exit 1
done
```

Results: **30/30 normal + 30/30 nice runs passed**, with **13 tests per run,
780 test executions, zero failures**. Lower scheduling priority exercises
the suite under `nice`; no performance threshold is asserted.

`pnpm check:all` passed: 149 root Solidity tests, 182 workspace tests, three
script tests, nine indexer tests, all TypeScript checks and indexer codegen,
10 SDK entry points, 71 Solidity interface functions, 10 byte-identical
packaged sources, two external Solidity consumer tests, and both production
app builds (5 agent / 31 web pages). Existing Foundry lint and Next CSS/tracing
warnings remain. No push, tag, publish, deployment or remote configuration
change was performed.
