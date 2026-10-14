# Bondrail contracts: integration reference (v1)

Addresses come from `docs/deployments/<chainId>.json`, never from this file. Amounts use the account
asset's smallest units (six decimals for USDC). ABIs are generated into `packages/sdk/src/abis.ts` from `out/`.

Enums (`src/BondrailTypes.sol`): Phase Funding0, Active1, Closing2, Closed3, Cancelled4; Adapter Native0,
Watched1; MilestoneMode Onchain0, Signed1; CloseReason None0, RevenueCap1, Maturity2.

Structs, exact field order:
- Terms: uint256 raiseAmount, repayCap, stake, minRevenue; uint64 fundingDeadline, maturity,
  secondReleaseNotBefore, secondReleaseDeadline; uint32 minOperatingPeriod; uint16 revenueBps,
  firstReleaseBps; uint8 milestoneMode; uint16 minFeeBps (Native fee floor while Active; 0 = none),
  triggerWindowDays, stepUpBps; uint256 triggerRevenue. Trigger fields are **not yet deployed**:
  all zero disables; otherwise window 1–30, revenue > 0, base share < stepUpBps ≤ 5000.
- AdapterConfig: uint8 adapter, address source (the Native project; zero for Watched), bytes32 policyHash.
- Observation: address bond, bytes32 policyHash, uint64 epoch, uint64 observedAt, uint64 expiresAt,
  uint8 result (0 Unknown, 1 Compliant, 2 Violation), address observedPayTo, bytes32 offerHash, bytes32 evidenceHash.
- Milestone: address bond, bytes32 policyHash, uint64 periodStart, uint64 periodEnd, uint256 eligibleRevenue,
  bytes32 evidenceHash, uint64 expiresAt, uint256 nonce.

**BondrailFactory**
- `createAccount(asset)` → account (issuer = caller; `asset` is any ERC-20 contract: the token the business
  charges fees in, raises and repays in).
- `setNativeApproval(project, approved)`: reviewer only.
- `createBond(account, Terms, AdapterConfig, name, symbol)` → bond. Issuer only; needs `minHistory` seconds
  since `account.firstRevenueAt()`; Native needs an approved, bound project; Watched needs `stake > 0`
  (approve the stake, in the account's asset, to the factory first); `minFeeBps` must be 0 for Watched.
- `activate(bond)`, `releaseSecond(bond)` (Onchain mode), `releaseSecondSigned(bond, Milestone, sig)`:
  issuer only, source must be healthy.
- Views: `depositAllowed(bond)`, `minHistory`, `nativeApproved(project)`, `reviewer`, `milestoneSigner`,
  `hashMilestone(Milestone)`, `isAccount`, `isBond`.

**BondrailAccount**
- Native project, money in: `collect(payer, gross, fee)`, `collectWithPermit(payer, gross, fee, deadline, v, r, s)`.
- Native project, money out: `settleOut(payer, gross, fee)` (pulls `gross` from the project, pays `gross − fee`).
- Both revert with `FeeBelowFloor` while an Active bond's `minFeeBps` is not met; both emit
  `Collected(payer, gross, fee, outgoing)`.
- Anyone: `sweep()`, `closeBondAtMaturity(bond)`, `cancelFunding(bond)`.
- Issuer: `bindProject(project)` (once), `withdraw(to, amount)`.
- History: `cumulativeRevenue`, `cumulativeVolume`, `paymentCount`, `collectedCount`, `uniquePayers`, `firstRevenueAt`,
  `lastRevenueAt`, `revenueByDay(day)`; state `asset`, `issuer`, `project`, `activeBond`, `issuerCredit`.

**BondrailBond** (ERC-20 claim)
- Investors: `deposit(amount)` (approve the bond; requires `factory.depositAllowed`), `refund(amount, to)`,
  `redeem(amount, to)`. Anyone: `expireUndrawn()`, `finalizeSettlement()`.
- `checkTrigger()` (**not yet deployed**): anyone, once per UTC day while Active and not defaulted;
  sums the last complete UTC day buckets, all strictly after the activation day. First eligible UTC day:
  `activationTime / 1 days + 1 + triggerWindowDays`. Emits `TriggerChecked`
  and `TriggerChanged` on transitions. Counts issuer self-payments; padding costs the investor share
  but is possible. See `README.md` for bucket and eligibility semantics.
- Views: `terms()`, `decimals` (= the asset's), `minFeeBps`, `asset`, `phase`, `adapter`, `source`, `account`, `backingPerToken`, `pool`, `fundingEscrow`,
  `releasedPrincipal`, `undrawnPrincipal`, `principalRecovery`, `totalRevenueCollected`, `effectiveRevenueCap`,
  `remainingRevenueCap`, `stakeHeld`, `stakeRecovery`, `stakeReturnCredit`, `releaseNonce`, `revenueSnapshot`.
- Trigger views (**not yet deployed**): `triggered`, `lastTriggerCheckDay`, `baseRevenueBps`;
  `revenueBps` is now the effective share, while `terms().revenueBps` remains the base.

**BondrailCovenant** (CRE receiver)
- `onReport(metadata, report)`: forwarder only; `report = abi.encode(Observation, observerSignature)`.
- Views: `isHealthy(bond)` (fresh Compliant), `inViolation(bond)` (defaulted, latest is Violation, or dark
  for `DARK_WARN`), `darkFor(bond)`, `darkSince`, `darkLast`, `lastDecisiveAt`, `hashObservation(Observation)`,
  `observationAt(bond, epoch)`.
- Constants: `DARK_MAX_GAP` 1 h, `DARK_WARN` 1 h, `DARK_DEFAULT` 24 h. Events: `CovenantDefault` (two
  adjacent violations), `DarkDefault` (24 h of Unknowns).

EIP-712 domains: observations `BondrailCovenant` v1, milestones `BondrailFactory` v1, actual chainId and contract.
