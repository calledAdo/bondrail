# Slice contracts integration (v1, implementation in progress)

All addresses/network config come from deployment manifests, never these docs. All money and claim amounts are integer six-decimal units. Enum Phase: Funding0,Active1,Closing2,Closed3,Cancelled4; Adapter Locked0,Watched1; CloseReason None0,RevenueCap1,Maturity2.

Canonical structs in `src/SliceTypes.sol`, exact field order:

- Terms: uint256 raiseAmount,repayCap,stake,minRevenue; uint64 fundingDeadline,maturity,secondReleaseNotBefore,secondReleaseDeadline; uint32 minOperatingPeriod; uint16 revenueBps,firstReleaseBps.
- AdapterConfig: uint8 adapter,address source,address guard,bytes32 policyHash.
- Observation: address bond,bytes32 policyHash,uint64 epoch,uint64 observedAt,uint64 expiresAt,uint8 result,address observedPayTo,bytes32 offerHash,bytes32 evidenceHash.
- Milestone: address bond,bytes32 policyHash,uint64 periodStart,uint64 periodEnd,uint256 eligibleRevenue,bytes32 evidenceHash,uint64 expiresAt,uint256 nonce.

Factory: `createRouter()`; `createLockedSource(address router,string name,string symbol,uint16 maxNameLength)` returns source,guard; `createBond(address router,Terms terms,AdapterConfig config)` returns bond; issuer-only `activate(address bond)`; issuer-only `releaseSecond(address bond,Milestone milestone,bytes signature)`.

Bond: USDC approval target is Bond for `deposit(uint256 amount)`; Factory for stake before createBond. `refund(uint256 amount,address to)`, `expireUndrawn()`, `finalizeSettlement()`, `redeem(uint256 amount,address to)`, issuer `claimStake(address to,uint256 amount)`. Terms getter `terms()` returns Terms tuple. Public getters `phase`, `closeReason`, `asset`, `issuer`, `router`, `factory`, `policyHash`, `raiseRecipient`, `adapter`, `guard`, `source`, `activationTime`, `collectionClosedAt`, `settleAfter`, `defaultedAt`, `defaultEvidenceHash`, `fundingEscrow`, `releasedPrincipal`, `undrawnPrincipal`, `principalRecovery`, `totalRevenueCollected`, `revenuePool`, `stakeHeld`, `stakeRecovery`, `stakeReturnCredit`, `pool`, `releaseNonce`, `effectiveRevenueCap`, `remainingRevenueCap`, `accountedBalance`. ERC20 name/symbol/decimals/balanceOf/totalSupply/approve/transfer standard; no public burn.

Router: permissionless `sweep()`, `closeBondAtMaturity(address expectedBond)`, `cancelFunding(address expectedBond)`; issuer `withdrawIssuerCredit(address to,uint256 amount)`; getters `activeBond`, `issuer`, `issuerCredit`, `splitRemainder`, `payout`.

Covenant domain EIP712 **SliceCovenant**, version **1**, actual chainId and Covenant address. Type string exactly `Observation(address bond,bytes32 policyHash,uint64 epoch,uint64 observedAt,uint64 expiresAt,uint8 result,address observedPayTo,bytes32 offerHash,bytes32 evidenceHash)`. `submitObservation(Observation observation,bytes signature)` validates signer directly; actual CRE path `onReport(bytes metadata,bytes report)` is forwarder-only and decodes report as `abi.encode(Observation,bytes signature)`. Getters `forwarder`, `observationSigner`, `isHealthy(address bond)`, `policyHashes(address bond)`. One-time deployer `initializeFactory(address factory)` before registration. Direct delivery never claims DON security.

Milestone EIP712 domain **SliceFactory**, version **1**, actual chainId and Factory address. Type string exactly `Milestone(address bond,bytes32 policyHash,uint64 periodStart,uint64 periodEnd,uint256 eligibleRevenue,bytes32 evidenceHash,uint64 expiresAt,uint256 nonce)`. `nonce` is Bond.releaseNonce, initially0; successful release increments once. ExpiresAt <= periodEnd+300, and periodStart>=activationTime,periodEnd<=now, elapsed>=minOperatingPeriod. Dedicated trusted signer set in Factory constructor.

Contracts will emit lifecycle/data events with raw integers. Root generates shared ABIs from forge artifacts after successful compilation. No API should fabricate chain success in their absence.
