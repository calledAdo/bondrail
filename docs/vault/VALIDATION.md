# Task 06b validation — 2026-10-14

**Not yet deployed.** Checks ran locally on `next`, starting from `a6eec64`.
No push, deployment, deployment-manifest edit or other-branch change.
Existing `contracts/src/Slice*.sol` files are unchanged; their existing views suffice.

| Check | Result |
| --- | --- |
| `~/.foundry/bin/forge test --root contracts` | **130 passed, 0 failed, 0 skipped**, 7 suites |
| `Vault.t.sol` | **36 passed**, including 4 fuzz tests at 256 runs each |
| Existing accounting invariant | **128 runs, 8,192 calls, 0 reverts** |
| `~/.foundry/bin/forge build --root contracts --sizes --skip test --skip script` | Pass; production sizes below |
| `pnpm -r test` (cached pnpm 10.32.0) | **108 passed, 0 failed**, 7 packages |
| `pnpm --filter @bondrail/web --filter @bondrail/sdk typecheck` | Pass; web MDX generation and both `tsc --noEmit` checks |
| `pnpm --filter @bondrail/sdk generate` | Pass; vault ABI regenerated, all 6 ABIs match artifacts |
| Changed Solidity `forge fmt --check`; `git diff --check` | Pass |
| Local `/vault` browser smoke | HTTP 200; entry/exit price and unvested-income labels; no page errors or horizontal overflow at 1440px / 375px |

Workspace counts: scoring 12, observer 9, worker 3, SDK 33, web 4, demo agent 6,
facilitator 41. Tests used the installed pnpm 10.32.0 executable; tsx's local IPC
sockets required sandbox escalation. No dependency changes or browser downloads.

| Contract | Runtime bytes | Initcode bytes |
| --- | ---: | ---: |
| BondrailVault | 12,671 | 14,224 |
| SliceAccount | 8,090 | 8,132 |
| SliceBond | 12,153 | 12,918 |
| SliceCovenant | 8,893 | 10,168 |
| SliceFactory | 12,285 | 13,734 |

All production contracts fit EIP-170's 24,576-byte runtime and EIP-3860's 49,152-byte
initcode limits, including constructor arguments. Existing Forge advisory lint and
Node deprecation warnings remain; test success is not a security audit.

## Financial evidence

- Staged activation preserves cost/NAV; post-activation deposit and mint execute at
  fair entry previews without diluting the earlier holder beyond rounding. Entry
  remains open through Active, Closing and Closed, including settlement grace.
- Repayment replaces unrecovered cost first. Profit remains fully excluded before
  checkpoint, vests linearly at halfway/seven-day boundaries, and stays locked after
  collection and holding removal. A checkpoint with no new profit cannot restart
  vesting; new profit merges only the still-unvested remainder. Slots can be reused.
- A deposit immediately before a large cap-closing repayment followed by same-block
  redemption receives only its original deposit. The next second recognizes at most
  the linear vested fraction. This does **not** prove that someone holding for the
  full vesting period cannot share in income paid just after entering.
- Trigger impairment reduces exit NAV while preserving entry NAV; deposit/mint and
  withdrawal execution match the respective previews. A later healthy trigger check
  reverses the haircut. Allocation concentration uses exit NAV.
- Default starts at cost, decays halfway/fully over 15/30 days, and recoveries shrink
  the impairment. Maturity starts decay without settlement; a late default does not
  reset it. Closing/Closed discard carried cost and retain only realized backing.
- Ceiling checks cover staged principal, second release and receipts paid to another
  holder. Fuzzing spans trigger/default/maturity/Closed states and recovery sizes,
  checking exit NAV <= entry NAV, gross position ceiling, checkpoint price continuity,
  and deposit/exit execution. The other three fuzz tests exercise inflation protection,
  liquidity maxima, and actual realized receipts throughout the lifecycle.

The independent receipt oracle snapshots state, actually withdraws/refunds/redeems
claims through real SliceBond contracts, and compares receipts to **realized backing**,
then restores. It retains the previous settlement/collection comparison. Task 06's
`NAV <= currently realizable backing` assertion is necessarily replaced: carried
cost may exceed funded backing. Active/Closing redemption in that oracle remains
counterfactual; separate tests forbid it in the vault, even with minority claims or
elapsed-but-unfinalized settlement grace. Zero-value slices of a positive pool retain
the existing dust/consolidation behavior.

Existing limit, timelock, role, exact-transfer, no-sweep, callback/reentrancy, donation
inflation, idle-only exit, slot-bound and default collection restrictions still pass.
The original bond/account liability invariant is unchanged and passes in full.

## Limits and residual risks

The browser smoke exercised the **undeployed** page and inspected desktop/mobile
screenshots; no configured live-vault integration, chain transaction or production
web build is claimed. Same-block contract reads and error handling are typechecked.
The UI is read-only.

**Carrying at cost assumes healthy bonds keep paying; impairment is rule-based, not
a market price.** NAV is not a guaranteed liquidation floor. The total repayment
ceiling includes undrawn principal and principal/stake recoveries alongside the
released-principal revenue cap. Income vests from its first checkpoint; new inflows
can extend the older unvested remainder, and investors staying invested participate
in that income. Default/maturity takes precedence over the trigger haircut, which
can initially raise a previously triggered mark. Settlement still recognizes losses.

Idle exhaustion, curator/issuer correlation and availability, reviewer/CRE trust,
asset freezes, donation/rounding effects, settled dust and stuck untracked gifts
remain. Full formulas, timing choices and verified Maple/Goldfinch/40 Acres source
references are in [DESIGN.md](DESIGN.md).
