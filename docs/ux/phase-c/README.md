# Phase C acceptance

Local branch `next`; no push, tag, publish, deployment to a remote chain, or remote configuration
change. All transaction tests use an isolated Anvil on chain 31337. Public deployment manifests
are compared byte-for-byte by the rehearsal. The SDK version is 0.2.0 and remains unpublished.

## Verified output

`pnpm check:all` and `pnpm e2e:local` both exited 0 on the final implementation.

```text
forge test: 192 tests passed, 0 failed, 0 skipped (10 suites)
forge build --sizes: BondrailVaultFactory 19,291 B; verifier 14,562 B; named vault 12,671 B
pnpm check:all: PASS (217 workspace tests, 17 script tests, 10 indexer tests; types/codegen/both builds)
pnpm e2e:local: E2E LOCAL PASS (12 checks)
sdk:verify: PASS: all 11 entry points imported with plain Node
contracts:verify: 12 sources byte-identical; 11 factory interface selectors match; 2 consumer tests pass
browser: 10 screenshots; 0 page errors; no horizontal overflow at 375/1280
```

Full output: [check:all](check-all.log), [Anvil/browser rehearsal](e2e-local.log),
[SDK verification](sdk-verify.log), [contracts verification](contracts-verify.log),
[sizes](sizes.txt), [indexer tests](indexer-tests.log), and [browser checks](browser-results.json).
The [local rehearsal result](e2e-result.json) includes protected-manifest hashes.

## Implementation decisions

The factory uses plain `new` deployments of a named subclass. `BondrailVault.sol` is unchanged:
constructor immutables, carried-cost NAV, entry/exit pricing, income vesting, allocation guards and
curator delay are inherited. Optional tighter per-vault mandates are omitted. Every vault retains
25% per bond, 16 holdings, and a 20% idle buffer at allocation; these cannot be loosened. Strategy
text is disclosure and does not enforce a Native/Watched filter.

Legacy registration is owner-only and succeeds once. A separate verifier deploys an original vault
with matching asset/factory/owner values and compares the full runtime hash, including immutable
values and compiler metadata. Matching public views or a proxy cannot bypass the check. The
separate verifier keeps all deployed runtimes below EIP-170; no initializer or delegatecall is used.

`/vaults` discovers bounded registry pages (25 at a time); before a factory is configured it uses
the manifest's existing default vault. `/vault` redirects to that default's detail page. The
forms use live ERC-4626 previews and idle-capped limits, simulate every write and measure receipt
time. The shared wagmi wallet path supports the existing Mera and injected connectors. Automated
transaction checks use an injected local wallet; no external passkey or testnet account is used.

Portfolio reads shares/value/withdrawable cash from the chain. Remaining deposit cost comes from
indexed deposits, with pro-rata removal on burns and transfer to the recipient on share transfers.
It is shown only when indexed shares agree with the live balance. Each position links to its next
action; the withdrawal link opens the withdrawal form directly.

## Indexed events and history

New events: `VaultCreated`, `Deposit`, `Withdraw`, `Transfer`, `Allocated`, `Collected`,
`RaiseWithdrawn`, `CuratorProposed`, `CuratorChanged`, and `IncomeCheckpointed`.

Daily snapshots store entry/exit prices, both NAVs, idle cash, total supply, timestamp and source
block. RPC reads use the exact indexed block. Event days refresh on activity; quiet days receive a
sample on the 300-block cadence, covering time-driven write-downs/vesting. Missing observations are
not invented. Historical-state RPC is required. See [indexer details](../../../indexer/VAULTS.md).

## Browser evidence

Screenshots use real local contract state after a low-revenue trigger: entry price 1 testUSDC,
exit price 0.87504, two shares with exit value 1.75008 and 1.5 withdrawable now. The second vault has
a different disclosed strategy. Sparse trend history is labeled with its observation count.

| Screen | 375 px | 1280 px |
| --- | --- | --- |
| Directory | [image](vaults-375.png) | [image](vaults-1280.png) |
| Vault details | [image](vault-375.png) | [image](vault-1280.png) |
| Deposit preview | [image](deposit-preview-375.png) | [image](deposit-preview-1280.png) |
| Capped withdrawal | [image](withdraw-capped-375.png) | [image](withdraw-capped-1280.png) |
| Portfolio position | [image](portfolio-vault-position-375.png) | [image](portfolio-vault-position-1280.png) |

The browser harness checks filtering, the legacy redirect, preview math from real contracts,
amount/share withdrawal modes, idle caps, wallet absence, wrong network and recovery, insufficient
balance, approval/deposit/withdrawal receipts, curator visibility/headroom/allocation/raise withdrawal,
Portfolio cost basis, overflow and page errors. Closed-deposit and zero-share cases use explicit
read-only RPC overrides on the same local chain; overrides are removed before transaction tests.

## Operator procedure

Exact commands and resume behavior are in the [deployment runbook](../../deployments/RUNBOOK.md#phase-c--vault-factory-operator-procedure-not-executed-in-task-23).
The default command is plan-only:

```sh
pnpm tsx scripts/deploy-vault-factory.ts --register-existing
```

Only the operator may later run the documented `--execute --force` command with an explicit
key directory. This task never executes that command on a public chain.
