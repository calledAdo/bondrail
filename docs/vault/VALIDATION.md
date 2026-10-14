# Task 06 validation — 2026-10-14

**Not yet deployed.** All checks below ran locally on branch `next`, starting from
`2d5b25c`. No push, deployment, deployment-manifest edit, or other-branch change.
Existing `contracts/src/Slice*.sol` files are unchanged.

| Check | Result |
| --- | --- |
| `~/.foundry/bin/forge test --root contracts` | **122 passed, 0 failed, 0 skipped** across 7 suites |
| New `Vault.t.sol` | **28 passed**, including 3 fuzz tests at 256 runs each |
| Existing accounting invariant | **128 runs, 8,192 calls, 0 reverts** |
| `~/.foundry/bin/forge build --root contracts --sizes --skip test --skip script` | Pass; sizes below |
| `npx -y pnpm@10.32.0 -r test` | **108 passed, 0 failed** across 7 packages with tests |
| `npx -y pnpm@10.32.0 --filter @bondrail/web --filter @bondrail/sdk typecheck` | Pass; web MDX generation and both `tsc --noEmit` checks |
| `npx -y pnpm@10.32.0 --filter @bondrail/sdk generate` | Pass; adds `bondrailVaultAbi`, existing ABIs unchanged |
| Changed Solidity files `forge fmt --check`; `git diff --check` | Pass |
| Local `/vault` browser smoke | HTTP 200, undeployed state and nav link, no page errors or page overflow at 1440px and 375px |

Workspace counts: scoring 12, observer 9, worker 3, SDK 33, web 4, demo agent 6,
facilitator 41. The separately managed indexer is not changed by this task.

| Contract | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| BondrailVault | 9,858 | 11,411 |
| SliceAccount | 8,090 | 8,132 |
| SliceBond | 12,153 | 12,918 |
| SliceCovenant | 8,893 | 10,168 |
| SliceFactory | 12,285 | 13,734 |

All production sizes are below EIP-170's 24,576-byte runtime and EIP-3860's
49,152-byte initcode limits (constructor arguments also fit). Forge emits advisory
lint warnings, including external calls under reentrancy guards and lifecycle timing;
these checks do not constitute a security audit. Existing Node deprecation warnings
remain. The default Playwright browser version was absent; the smoke used the
already-installed Chromium headless shell, without downloading browsers.

## What the financial tests establish

The receipt oracle snapshots EVM state, withdraws/refunds/redeems the vault's actual
claims through real SliceBond instances, compares the resulting idle balance to NAV,
then restores state. It repeats across Funding, Active, repayments, optional default,
Cancelled, Closing and Closed, and compares final collections to the reported NAV.
Active/Closing redemption in the oracle is **counterfactual backing**, never an
available vault operation: separate tests prove the curator cannot collect early,
including with a minority claim position or elapsed-but-unfinalized evidence grace.
A zero-valued slice of a positive pool is excluded from receipts because the bond
rejects it. Fully owned active positions and settled zero-pool losses have separate
lifecycle tests. Realized NAV is not a claim that every holding is immediately liquid.

Other coverage includes every allocation limit, aggregate same-bond exposure, NAV
markdowns, upward idle-buffer rounding, slot removal/reuse, failed-allocation rollback,
curator replacement timing, delegated withdrawals, no arbitrary destination, callback
reentrancy on all money paths, short transfers, untracked claim gifts, deposit/mint
windows, exact default backing, and actual execution of fuzzed withdrawal maxima.
Donation-inflation fuzz varies attacker donations and victim entries: zero-share
entries revert, successful entries receive shares, and the attacker cannot recover
more than their deposit plus donation in the exercised attack.

## Practical limits

The browser smoke covered the undeployed view, not a live configured vault. No chain
transactions or full production web build were run. Same-block RPC reads and error
states are implemented and typechecked; live integration remains a deployment check.
The UI offers no transaction controls.

Conservative NAV excludes future revenue and can fall sharply at activation. Idle
liquidity can run out; deposit windows may remain closed for a long time. Curator and
issuer risk, correlated bonds, inherited reviewer/CRE assumptions, asset freezes,
virtual-share/loss rounding, donation price changes, and permanently stuck untracked
token gifts remain. Tiny settled claims can require cooperation to consolidate before
collection. Allocation-time limits do not force rebalancing or guarantee issuer
independence. See [design](DESIGN.md) for the chosen mitigations and scope.
