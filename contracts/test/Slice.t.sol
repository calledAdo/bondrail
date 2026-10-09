// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {TestBase} from "./TestBase.sol";
import {SliceTypes} from "../src/SliceTypes.sol";
import {SliceBond} from "../src/SliceBond.sol";
import {SliceRouter} from "../src/SliceRouter.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {PumpLab} from "../src/PumpLab.sol";
import {FeeGuard} from "../src/FeeGuard.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract SliceTest is TestBase {
    MockUSDC asset;
    SliceFactory factory;
    SliceCovenant covenant;
    SliceRouter router;
    PumpLab source;
    FeeGuard guard;
    SliceBond bond;
    address issuer = address(0x111);
    address investor = address(0x222);
    address buyer = address(0x333);
    address forwarder = address(0x444);
    uint256 constant OBSERVER_PK = 12345;
    uint256 constant MILESTONE_PK = 67890;
    SliceTypes.Terms t;

    function setUp() public {
        vm.warp(1_800_000);
        vm.chainId(31337);
        asset = new MockUSDC();
        covenant = new SliceCovenant(forwarder, vm.addr(OBSERVER_PK));
        factory = new SliceFactory(
            address(asset),
            address(covenant),
            vm.addr(MILESTONE_PK),
            address(new SliceBond()),
            address(new SliceRouter())
        );
        covenant.initializeFactory(address(factory));
        asset.mint(issuer, 10_000_000e6);
        asset.mint(investor, 10_000_000e6);
        vm.startPrank(issuer);
        router = SliceRouter(factory.createRouter());
        (address p, address g) = factory.createLockedSource(address(router), "Lab", "LAB", 64);
        source = PumpLab(p);
        guard = FeeGuard(g);
        asset.approve(address(factory), type(uint256).max);
        vm.stopPrank();
        t = SliceTypes.Terms(
            100e6,
            120e6,
            20e6,
            10e6,
            uint64(vm.getBlockTimestamp() + 120),
            uint64(vm.getBlockTimestamp() + 1200),
            uint64(vm.getBlockTimestamp() + 150),
            uint64(vm.getBlockTimestamp() + 600),
            30,
            2000,
            5000
        );
    }

    function _new(bool watched) internal {
        SliceTypes.AdapterConfig memory c = SliceTypes.AdapterConfig(
            watched ? SliceTypes.Adapter.Watched : SliceTypes.Adapter.Locked,
            watched ? address(0) : address(source),
            watched ? address(0) : address(guard),
            keccak256("policy-v1")
        );
        vm.prank(issuer);
        bond = SliceBond(factory.createBond(address(router), t, c));
        vm.prank(investor);
        asset.approve(address(bond), type(uint256).max);
    }

    function _fund() internal {
        vm.prank(investor);
        bond.deposit(t.raiseAmount);
    }

    function _activate(bool watched) internal {
        _new(watched);
        _fund();
        if (watched) _observe(uint64(vm.getBlockTimestamp()), 1);
        vm.prank(issuer);
        factory.activate(address(bond));
    }

    function _observation(uint64 at, uint8 result) internal view returns (SliceTypes.Observation memory) {
        return SliceTypes.Observation(
            address(bond),
            bond.policyHash(),
            at / 30,
            at,
            at + 90,
            result,
            result == 1 ? address(router) : buyer,
            keccak256("offer"),
            keccak256(abi.encode(at, result))
        );
    }

    function _observe(uint64 at, uint8 result) internal {
        SliceTypes.Observation memory o = _observation(at, result);
        covenant.submitObservation(o, _sig(OBSERVER_PK, covenant.hashObservation(o)));
    }

    function _revenue(uint256 amount) internal {
        asset.mint(address(router), amount);
        router.sweep();
    }

    function _milestone() internal view returns (SliceTypes.Milestone memory) {
        return SliceTypes.Milestone(
            address(bond),
            bond.policyHash(),
            bond.activationTime(),
            uint64(vm.getBlockTimestamp()),
            10e6,
            keccak256("screened evidence"),
            uint64(vm.getBlockTimestamp() + 90),
            bond.releaseNonce()
        );
    }

    function _release() internal {
        SliceTypes.Milestone memory m = _milestone();
        bytes memory signature = _sig(MILESTONE_PK, factory.hashMilestone(m));
        vm.prank(issuer);
        factory.releaseSecond(address(bond), m, signature);
    }

    function _expectReleaseFailure() internal {
        SliceTypes.Milestone memory m = _milestone();
        bytes memory signature = _sig(MILESTONE_PK, factory.hashMilestone(m));
        vm.prank(issuer);
        vm.expectRevert();
        factory.releaseSecond(address(bond), m, signature);
    }

    function _solvent() internal view {
        yes(asset.balanceOf(address(bond)) >= bond.accountedBalance());
        yes(asset.balanceOf(address(router)) >= router.issuerCredit());
        yes(bond.totalRevenueCollected() <= bond.effectiveRevenueCap());
        eq(
            bond.pool() + bond.totalRedeemed(),
            bond.totalRevenueCollected() + bond.principalRecovery() + bond.stakeRecovery()
        );
        if (bond.phase() != SliceTypes.Phase.Funding && bond.phase() != SliceTypes.Phase.Cancelled) {
            eq(bond.releasedPrincipal() + bond.undrawnPrincipal() + bond.principalRecovery(), t.raiseAmount);
        }
    }

    function testFundingMintTransferBoundaryCancelAndRefund() public {
        _new(false);
        vm.prank(investor);
        bond.deposit(40e6);
        vm.prank(investor);
        vm.expectRevert(SliceBond.TransferLocked.selector);
        bond.transfer(buyer, 1e6);
        vm.warp(t.fundingDeadline);
        vm.prank(issuer);
        vm.expectRevert(SliceBond.InvalidState.selector);
        factory.activate(address(bond));
        router.cancelFunding(address(bond));
        eq(router.activeBond(), address(0));
        eq(bond.stakeReturnCredit(), 20e6);
        vm.prank(investor);
        bond.refund(40e6, investor);
        eq(bond.totalSupply(), 0);
        eq(bond.fundingEscrow(), 0);
        _solvent();
    }

    function testPreactivationFeesStayIssuerAndFirstReleaseIsStaged() public {
        _new(false);
        asset.mint(address(router), 10e6);
        _fund();
        vm.prank(issuer);
        factory.activate(address(bond));
        eq(router.issuerCredit(), 10e6);
        eq(bond.totalRevenueCollected(), 0);
        eq(bond.releasedPrincipal(), 50e6);
        eq(bond.undrawnPrincipal(), 50e6);
        eq(bond.effectiveRevenueCap(), 60e6);
        _solvent();
    }

    function testSecondReleaseSignedAndOneShot() public {
        _activate(false);
        vm.warp(t.secondReleaseNotBefore);
        _release();
        eq(bond.releasedPrincipal(), 100e6);
        eq(bond.undrawnPrincipal(), 0);
        eq(bond.effectiveRevenueCap(), 120e6);
        eq(bond.totalSupply(), 100e6);
        _expectReleaseFailure();
        _solvent();
    }

    function testForgedAndCrossChainMilestoneRejected() public {
        _activate(false);
        vm.warp(t.secondReleaseNotBefore);
        SliceTypes.Milestone memory m = _milestone();
        bytes memory wrong = _sig(999, factory.hashMilestone(m));
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.Unauthorized.selector);
        factory.releaseSecond(address(bond), m, wrong);
        bytes memory valid = _sig(MILESTONE_PK, factory.hashMilestone(m));
        vm.chainId(10143);
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.Unauthorized.selector);
        factory.releaseSecond(address(bond), m, valid);
    }

    function testExpiredAndTooShortMilestoneRejected() public {
        _activate(false);
        vm.warp(t.secondReleaseNotBefore);
        SliceTypes.Milestone memory m = _milestone();
        m.periodStart = m.periodEnd - 1;
        bytes memory signature = _sig(MILESTONE_PK, factory.hashMilestone(m));
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.InvalidMilestone.selector);
        factory.releaseSecond(address(bond), m, signature);
        m = _milestone();
        m.expiresAt = uint64(vm.getBlockTimestamp() - 1);
        signature = _sig(MILESTONE_PK, factory.hashMilestone(m));
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.InvalidMilestone.selector);
        factory.releaseSecond(address(bond), m, signature);
    }

    function testReleaseDeadlineRecoversWithoutStakeSlash() public {
        _activate(false);
        vm.warp(t.secondReleaseDeadline);
        _expectReleaseFailure();
        bond.expireUndrawn();
        bond.expireUndrawn();
        eq(bond.principalRecovery(), 50e6);
        eq(bond.stakeHeld(), 20e6);
        eq(bond.defaultedAt(), 0);
        _solvent();
    }

    function testCapBeforeSecondDrawCancelsCommitmentAndFinalBuyerRedeems() public {
        _activate(false);
        vm.prank(investor);
        bond.transfer(buyer, 40e6);
        _revenue(300e6);
        eq(uint256(bond.phase()), uint256(SliceTypes.Phase.Closed));
        eq(bond.pool(), 110e6);
        eq(bond.principalRecovery(), 50e6);
        eq(router.activeBond(), address(0));
        vm.prank(buyer);
        eq(bond.redeem(40e6, buyer), 44e6);
        vm.prank(investor);
        eq(bond.redeem(60e6, investor), 66e6);
        eq(bond.pool(), 0);
        eq(bond.totalSupply(), 0);
        _solvent();
    }

    function testNoBurnOrEarlyRedemptionSurface() public {
        _activate(false);
        _revenue(10e6);
        vm.prank(investor);
        vm.expectRevert(SliceBond.InvalidState.selector);
        bond.redeem(1e6, investor);
        vm.prank(investor);
        (bool ok,) = address(bond).call(abi.encodeWithSignature("burn(uint256)", 1e6));
        yes(!ok);
        eq(bond.totalSupply(), 100e6);
    }

    function testFinalSweepIncludesPostMaturityPreCloseAndCapWins() public {
        _activate(false);
        asset.mint(address(router), 200e6);
        vm.warp(t.maturity + 1);
        asset.mint(address(router), 100e6);
        router.closeBondAtMaturity(address(bond));
        eq(uint256(bond.closeReason()), uint256(SliceTypes.CloseReason.RevenueCap));
        eq(bond.totalRevenueCollected(), 60e6);
        _revenue(50e6);
        eq(bond.totalRevenueCollected(), 60e6);
        _solvent();
    }

    function testRoundingCarryPreventsMicroSweepAvoidance() public {
        _activate(false);
        for (uint256 i; i < 5; i++) {
            _revenue(1);
        }
        eq(bond.totalRevenueCollected(), 1);
        eq(router.issuerCredit(), 4);
        eq(router.splitRemainder(), 0);
        _solvent();
    }

    function testBlockedIssuerCannotPreventClosingOrStakeCredit() public {
        _activate(false);
        asset.setBlocked(issuer, true);
        _revenue(10e6);
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        eq(bond.stakeReturnCredit(), 20e6);
        eq(router.activeBond(), address(0));
        uint256 credit = router.issuerCredit();
        vm.prank(issuer);
        router.withdrawIssuerCredit(buyer, credit);
        vm.prank(issuer);
        bond.claimStake(buyer, 20e6);
        _solvent();
    }

    function testDirectBondDonationIsNotRevenueOrPool() public {
        _activate(false);
        asset.mint(address(bond), 99e6);
        _revenue(5e6);
        eq(bond.pool(), 1e6);
        eq(asset.balanceOf(address(bond)) - bond.accountedBalance(), 99e6);
        _solvent();
    }

    function testWatchedRequiresHealthyObservationForActivationAndDraw() public {
        _new(true);
        _fund();
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.Unhealthy.selector);
        factory.activate(address(bond));
        _observe(uint64(vm.getBlockTimestamp()), 1);
        vm.prank(issuer);
        factory.activate(address(bond));
        vm.warp(t.secondReleaseNotBefore);
        _expectReleaseFailure();
        _observe(uint64(vm.getBlockTimestamp()), 0);
        _expectReleaseFailure();
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 1);
        _release();
        eq(bond.releasedPrincipal(), 100e6);
    }

    function testTwoAdjacentViolationsOutOfOrderSlashExactlyOnce() public {
        _activate(true);
        uint64 first = uint64(vm.getBlockTimestamp() + 31);
        uint64 second = first + 30;
        vm.warp(second);
        _observe(second, 2);
        eq(bond.defaultedAt(), 0);
        _observe(first, 2);
        yes(bond.defaultedAt() != 0);
        eq(bond.stakeRecovery(), 20e6);
        eq(bond.principalRecovery(), 50e6);
        eq(bond.pool(), 70e6);
        vm.warp(second + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        eq(bond.stakeRecovery(), 20e6);
        _solvent();
    }

    function testUnknownAndNonAdjacentViolationsNeverDefault() public {
        _activate(true);
        vm.warp(vm.getBlockTimestamp() + 31);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 0);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        eq(bond.defaultedAt(), 0);
    }

    function testFundingViolationsCannotBecomeActiveDefault() public {
        _new(true);
        _fund();
        _observe(uint64(vm.getBlockTimestamp()), 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        eq(bond.defaultedAt(), 0);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 1);
        vm.prank(issuer);
        factory.activate(address(bond));
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        eq(bond.defaultedAt(), 0);
    }

    function testReportSignatureForwarderReplayAndFreshness() public {
        _new(true);
        SliceTypes.Observation memory o = _observation(uint64(vm.getBlockTimestamp()), 1);
        bytes memory forged = _sig(999, covenant.hashObservation(o));
        vm.prank(forwarder);
        vm.expectRevert(SliceCovenant.Unauthorized.selector);
        covenant.onReport("", abi.encode(o, forged));
        bytes memory signature = _sig(OBSERVER_PK, covenant.hashObservation(o));
        vm.expectRevert(SliceCovenant.Unauthorized.selector);
        covenant.onReport("", abi.encode(o, signature));
        vm.prank(forwarder);
        covenant.onReport("", abi.encode(o, signature));
        vm.expectRevert(SliceCovenant.DuplicateEpoch.selector);
        covenant.submitObservation(o, signature);
        vm.warp(vm.getBlockTimestamp() + 91);
        vm.expectRevert(SliceCovenant.InvalidObservation.selector);
        covenant.submitObservation(o, signature);
    }

    function testClosingAcceptsHistoricalEvidenceAndNeverPostCutoff() public {
        _activate(true);
        vm.warp(t.maturity - 40);
        uint64 first = uint64(vm.getBlockTimestamp());
        uint64 second = first + 30;
        SliceTypes.Observation memory a = _observation(first, 2);
        SliceTypes.Observation memory b = _observation(second, 2);
        bytes memory sa = _sig(OBSERVER_PK, covenant.hashObservation(a));
        bytes memory sb = _sig(OBSERVER_PK, covenant.hashObservation(b));
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        eq(uint256(bond.phase()), uint256(SliceTypes.Phase.Closing));
        eq(bond.stakeHeld(), 20e6);
        covenant.submitObservation(b, sb);
        covenant.submitObservation(a, sa);
        eq(bond.stakeRecovery(), 20e6);
        vm.expectRevert(SliceBond.TooEarly.selector);
        bond.finalizeSettlement();
        SliceTypes.Observation memory post = _observation(uint64(vm.getBlockTimestamp()), 2);
        bytes memory sp = _sig(OBSERVER_PK, covenant.hashObservation(post));
        vm.expectRevert(SliceCovenant.InvalidObservation.selector);
        covenant.submitObservation(post, sp);
        vm.warp(bond.settleAfter());
        bond.finalizeSettlement();
        eq(bond.stakeReturnCredit(), 0);
        eq(bond.pool(), 70e6);
        _solvent();
    }

    function testClosingWindowCannotBlockNewIssuanceOrDetachIt() public {
        _activate(true);
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        SliceBond old = bond;
        t.fundingDeadline = uint64(vm.getBlockTimestamp() + 120);
        t.secondReleaseNotBefore = uint64(vm.getBlockTimestamp() + 150);
        t.secondReleaseDeadline = uint64(vm.getBlockTimestamp() + 600);
        t.maturity = uint64(vm.getBlockTimestamp() + 1200);
        _new(false);
        eq(router.activeBond(), address(bond));
        router.closeBondAtMaturity(address(old));
        vm.warp(old.settleAfter());
        old.finalizeSettlement();
        eq(router.activeBond(), address(bond));
        eq(old.stakeReturnCredit(), 20e6);
    }

    function testFeeGuardAllowlistAndEarlyRelease() public {
        _new(false);
        vm.prank(issuer);
        vm.expectRevert(FeeGuard.Unauthorized.selector);
        guard.release();
        vm.prank(issuer);
        vm.expectRevert(FeeGuard.UnsupportedCall.selector);
        guard.execute(abi.encodeWithSignature("transferOwnership(address)", issuer));
        vm.prank(issuer);
        guard.execute(abi.encodeCall(PumpLab.setMaxNameLength, (uint16(48))));
        eq(source.maxNameLength(), 48);
        yes(guard.isLocked());
        vm.warp(t.fundingDeadline);
        router.cancelFunding(address(bond));
        vm.prank(issuer);
        guard.release();
        eq(source.owner(), issuer);
    }

    function testFakeGuardRejected() public {
        SliceTypes.AdapterConfig memory c =
            SliceTypes.AdapterConfig(SliceTypes.Adapter.Locked, address(source), buyer, keccak256("fake"));
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.InvalidAdapter.selector);
        factory.createBond(address(router), t, c);
    }

    function testPumpCurveRoundTripPaysOnlyFeesNeverVirtualBacking() public {
        _activate(false);
        vm.startPrank(investor);
        asset.approve(address(source), type(uint256).max);
        uint256 beforeBalance = asset.balanceOf(investor);
        uint256 tokens = source.buy(1000e6, 1, uint64(vm.getBlockTimestamp()));
        eq(source.realUSDC(), 990e6);
        eq(asset.balanceOf(address(source)), 990e6);
        eq(bond.totalRevenueCollected(), 2e6);
        source.token().approve(address(source), tokens);
        uint256 received = source.sell(tokens, 0, uint64(vm.getBlockTimestamp()));
        yes(received < 1000e6);
        yes(asset.balanceOf(investor) < beforeBalance);
        eq(asset.balanceOf(address(source)), source.realUSDC());
        eq(source.token().balanceOf(address(source)), source.realToken());
        vm.stopPrank();
        _solvent();
    }

    function testFuzzSweepPartitionConservation(uint128 a, uint128 b, uint128 c) public {
        _activate(false);
        uint256 x = uint256(a) % 50e6;
        uint256 y = uint256(b) % 50e6;
        uint256 z = uint256(c) % 50e6;
        _revenue(x);
        _revenue(y);
        _revenue(z);
        eq(bond.totalRevenueCollected(), (x + y + z) * 2000 / 10000);
        eq(router.issuerCredit() + bond.totalRevenueCollected(), x + y + z);
        _solvent();
    }

    function testFuzzStagedRatioAndCap(uint128 raw, uint8 selection) public {
        t.raiseAmount = uint256(raw) % 100_000_000e6 + 4;
        t.repayCap = t.raiseAmount + t.raiseAmount / 5;
        t.firstReleaseBps = selection % 2 == 0 ? 2500 : 5000;
        asset.mint(investor, t.raiseAmount);
        _activate(false);
        uint256 first = t.raiseAmount * t.firstReleaseBps / 10000;
        eq(bond.releasedPrincipal(), first);
        eq(bond.effectiveRevenueCap(), t.repayCap * first / t.raiseAmount);
        vm.warp(t.secondReleaseDeadline);
        bond.expireUndrawn();
        eq(bond.principalRecovery(), t.raiseAmount - first);
        _solvent();
    }

    function testFuzzCurveRoundTripNoRoundingProfit(uint96 raw) public {
        uint256 gross = uint256(raw) % 5000e6 + 1000;
        vm.startPrank(investor);
        asset.approve(address(source), gross);
        uint256 beforeBalance = asset.balanceOf(investor);
        uint256 tokens = source.buy(gross, 1, uint64(vm.getBlockTimestamp()));
        source.token().approve(address(source), tokens);
        source.sell(tokens, 0, uint64(vm.getBlockTimestamp()));
        yes(asset.balanceOf(investor) < beforeBalance);
        eq(asset.balanceOf(address(source)), source.realUSDC());
        eq(source.token().balanceOf(address(source)), source.realToken());
        vm.stopPrank();
    }

    function testZeroValueRedemptionAndTinyNonzeroPoolProtection() public {
        _activate(false);
        vm.warp(t.secondReleaseNotBefore);
        _release();
        _revenue(5);
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        eq(bond.pool(), 1);
        vm.prank(investor);
        vm.expectRevert(SliceBond.InvalidAmount.selector);
        bond.redeem(1, investor);
        vm.prank(investor);
        eq(bond.redeem(100e6, investor), 1);
        _solvent();
    }

    function testTotalLossStillAllowsFinalBurn() public {
        _activate(false);
        vm.warp(t.secondReleaseNotBefore);
        _release();
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        eq(bond.pool(), 0);
        vm.prank(investor);
        eq(bond.redeem(100e6, investor), 0);
        eq(bond.totalSupply(), 0);
        _solvent();
    }

    function testSameEpochEquivocationAndFutureObservationRejected() public {
        _new(true);
        _observe(uint64(vm.getBlockTimestamp()), 1);
        SliceTypes.Observation memory o = _observation(uint64(vm.getBlockTimestamp()), 2);
        bytes memory signature = _sig(OBSERVER_PK, covenant.hashObservation(o));
        vm.expectRevert(SliceCovenant.DuplicateEpoch.selector);
        covenant.submitObservation(o, signature);
        o = _observation(uint64(vm.getBlockTimestamp() + 6), 2);
        signature = _sig(OBSERVER_PK, covenant.hashObservation(o));
        vm.expectRevert(SliceCovenant.InvalidObservation.selector);
        covenant.submitObservation(o, signature);
    }

    function testDefaultAfterSecondReleaseNeverClawsBackReleasedCapital() public {
        _activate(true);
        vm.warp(t.secondReleaseNotBefore);
        _observe(uint64(vm.getBlockTimestamp()), 1);
        _release();
        vm.warp(vm.getBlockTimestamp() + 31);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        eq(bond.releasedPrincipal(), 100e6);
        eq(bond.principalRecovery(), 0);
        eq(bond.stakeRecovery(), 20e6);
        _solvent();
    }

    function testReportAtSettlementBoundaryCannotSlashReturnedStake() public {
        _activate(true);
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        vm.warp(bond.settleAfter());
        bond.finalizeSettlement();
        SliceTypes.Observation memory o = _observation(uint64(vm.getBlockTimestamp()), 2);
        bytes memory signature = _sig(OBSERVER_PK, covenant.hashObservation(o));
        vm.expectRevert(SliceCovenant.InvalidObservation.selector);
        covenant.submitObservation(o, signature);
        eq(bond.stakeReturnCredit(), 20e6);
        eq(bond.stakeRecovery(), 0);
        _solvent();
    }
}
