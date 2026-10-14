# Task 05: performance trigger validation

**Implemented, not yet deployed.** Local changes on `next`, based on `0b2e501`, with contracts in
`35ca06f` and offchain integration in `b42e417`. No push, deployment, deployment JSON edits or other-branch changes. The contracts,
offchain integrations and documentation are separate commits. These are local correctness and gas
checks, not evidence of live Monad trigger operation.

## Checks

| Check | Result |
|---|---|
| `~/.foundry/bin/forge test --root contracts` | 93 passed, 0 failed; 14 added trigger tests including two fuzz tests |
| Accounting invariant | 128 runs, 8,192 calls, 0 reverts; includes day warps and `checkTrigger` actions |
| `~/.foundry/bin/forge build --root contracts --sizes` | Pass; all production runtime sizes below EIP-170 |
| `npx -y pnpm@10.32.0 -r test` | 107 passed: SDK 33, web 4, worker 2, observer 9, scoring 12, demo agent 6, facilitator 41 |
| `npx -y pnpm@10.32.0 --dir indexer codegen` | Pass; generated files are ignored as before |
| `npx -y pnpm@10.32.0 --dir indexer test` | 8 passed, including trigger/recovery event sequences |
| `tsc --noEmit -p apps/web`, `packages/sdk`, `indexer`, `services/worker` | All pass, no output |
| `tsc --noEmit -p scripts/bench` | Pass; local fixture supplies zero trigger terms |

TypeScript commands use `./node_modules/.bin/tsc`. pnpm required registry access outside the sandbox;
no external writes were performed. Foundry's advisory lint output and Node's existing `module.register`
deprecation warnings do not fail the checks.

## Sizes

Solidity 0.8.28, optimizer 200, via IR, Cancun. Bytes from `forge build --sizes`:

| Contract | Runtime before | Runtime after | Initcode after |
|---|---:|---:|---:|
| SliceAccount | 8,090 | 8,090 | 8,132 |
| SliceBond | 11,275 | 12,141 | 12,906 |
| SliceFactory | 11,944 | 12,285 | 13,734 |
| SliceCovenant | 8,893 | 8,893 | 10,168 |

`SliceAccount.sol` is unchanged. The trigger flag and check day occupy the already-read lifecycle
slot 14 (offsets 3 and 4); `stepUpBps` and `triggerWindowDays` share the existing small-terms slot 20
with `revenueBps` and `minFeeBps`. The floor occupies a new terms slot read only during evaluation.
No new per-payment storage writes, day loops or external calls are introduced. The effective-share
getter reads the trigger flag and selects the packed base or step-up rate.

## Matched payment gas

Captured before the implementation, then after, using exactly the same existing test:

```sh
~/.foundry/bin/forge test --root contracts --match-test testCreditModeSplitsEachFeeImmediately -vvvv
```

The fixture books one pre-bond payment, issues/activates, then sends the same 100 USDC gross payment
with a 1 USDC fee. The account clone's `collect` call measures:

| Payment | Before | After | Delta |
|---|---:|---:|---:|
| Passthrough | 258,747 | 258,747 | 0 |
| Active, base share | 188,824 | 189,278 | +454 (+0.24%) |
| Active implementation delegatecall (included above) | 186,140 | 186,594 | +454 |

These are matched Foundry call-trace gas values, with the fixture's identical warming and initialization
pattern, not full-transaction gas receipts or Monad fee estimates. See [captured trace excerpts](task05-payment-gas.txt).
The active increase is small; the account payment implementation is unchanged. Exact stepped-up splits,
rate transitions and cap closure are validated separately by `TriggerTest` across `collect`, `settleOut`,
`sweep` and signed `settle` payments. No comparison of differently sized payments or differing storage
initialization states is presented as trigger overhead.

## Boundaries and integration

The earliest eligible UTC bucket is the activation day, including any receipts earlier that day.
Today is always excluded. Checks are permissionless and external to payments; recovery needs another
successful daily check. Default freezes trigger evaluation, while cap/default accounting stays unchanged.
The revenue floor counts issuer self-payments and is not wash-adjusted: padding costs the investor
share but is possible.

The worker is opt-in (`WORKER_CHECK_TRIGGERS=1`) for targets on the new implementation and uses chain
UTC days plus on-chain `lastTriggerCheckDay`, including after restarts. Lifecycle maintenance precedes
checks, which precede sweeps to prevent starvation. SDK/parser tests cover partial configuration,
integer/precision bounds, and decoding both original and extended immutable bond tuples. The web
shows indexed current state, so it depends on the updated indexer schema and its normal indexing lag.
The new factory tuple requires a new factory deployment; existing clones cannot be upgraded.
