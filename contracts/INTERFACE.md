# Slice contracts: integration reference (v1)

Addresses come from `docs/deployments/<chainId>.json`, never from this file. Amounts are six-decimal
integers. ABIs are generated into `packages/sdk/src/abis.ts` from `out/`.

Enums (`src/SliceTypes.sol`): Phase Funding0, Active1, Closing2, Closed3, Cancelled4; Adapter Native0,
Watched1; MilestoneMode Onchain0, Signed1; CloseReason None0, RevenueCap1, Maturity2.

Structs, exact field order:
- Terms: uint256 raiseAmount, repayCap, stake, minRevenue; uint64 fundingDeadline, maturity,
  secondReleaseNotBefore, secondReleaseDeadline; uint32 minOperatingPeriod; uint16 revenueBps,
  firstReleaseBps; uint8 milestoneMode.
- AdapterConfig: uint8 adapter, address source (the Native project; zero for Watched), bytes32 policyHash.
- Observation: address bond, bytes32 policyHash, uint64 epoch, uint64 observedAt, uint64 expiresAt,
  uint8 result (0 Unknown, 1 Compliant, 2 Violation), address observedPayTo, bytes32 offerHash, bytes32 evidenceHash.
- Milestone: address bond, bytes32 policyHash, uint64 periodStart, uint64 periodEnd, uint256 eligibleRevenue,
  bytes32 evidenceHash, uint64 expiresAt, uint256 nonce.

**SliceFactory**
- `createAccount()` → account (issuer = caller).
- `setNativeApproval(project, approved)`: reviewer only.
- `createBond(account, Terms, AdapterConfig, name, symbol)` → bond. Issuer only; needs `minHistory` seconds
  since `account.firstRevenueAt()`; Native needs an approved, bound project; Watched needs `stake > 0`
  (approve the stake to the factory first).
- `activate(bond)`, `releaseSecond(bond)` (Onchain mode), `releaseSecondSigned(bond, Milestone, sig)`:
  issuer only, source must be healthy.
- Views: `depositAllowed(bond)`, `minHistory`, `nativeApproved(project)`, `reviewer`, `milestoneSigner`,
  `hashMilestone(Milestone)`, `isAccount`, `isBond`.

**SliceAccount**
- Native project: `collect(payer, gross, fee)`, `collectWithPermit(payer, gross, fee, deadline, v, r, s)`.
- Anyone: `sweep()`, `closeBondAtMaturity(bond)`, `cancelFunding(bond)`.
- Issuer: `bindProject(project)` (once), `withdraw(to, amount)`.
- History: `cumulativeRevenue`, `paymentCount`, `collectedCount`, `uniquePayers`, `firstRevenueAt`,
  `lastRevenueAt`, `revenueByDay(day)`; state `issuer`, `project`, `activeBond`, `issuerCredit`.

**SliceBond** (ERC-20 claim)
- Investors: `deposit(amount)` (approve the bond; requires `factory.depositAllowed`), `refund(amount, to)`,
  `redeem(amount, to)`. Anyone: `expireUndrawn()`, `finalizeSettlement()`.
- Views: `terms()`, `phase`, `adapter`, `source`, `account`, `backingPerToken`, `pool`, `fundingEscrow`,
  `releasedPrincipal`, `undrawnPrincipal`, `principalRecovery`, `totalRevenueCollected`, `effectiveRevenueCap`,
  `remainingRevenueCap`, `stakeHeld`, `stakeRecovery`, `stakeReturnCredit`, `releaseNonce`, `revenueSnapshot`.

**SliceCovenant** (CRE receiver)
- `onReport(metadata, report)`: forwarder only; `report = abi.encode(Observation, observerSignature)`.
- Views: `isHealthy(bond)` (fresh Compliant), `inViolation(bond)` (defaulted or latest is Violation),
  `hashObservation(Observation)`, `observationAt(bond, epoch)`.

EIP-712 domains: observations `SliceCovenant` v1, milestones `SliceFactory` v1, actual chainId and contract.
