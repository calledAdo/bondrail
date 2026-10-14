// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./TestBase.sol";
import {BondrailVault} from "../src/BondrailVault.sol";
import {BondrailBond} from "../src/BondrailBond.sol";
import {BondrailAccount} from "../src/BondrailAccount.sol";
import {BondrailFactory} from "../src/BondrailFactory.sol";
import {BondrailCovenant} from "../src/BondrailCovenant.sol";
import {BondrailTypes} from "../src/BondrailTypes.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockEarner} from "./mocks/MockEarner.sol";

interface SnapshotVm {
    function snapshotState() external returns (uint256);
    function revertToState(uint256) external returns (bool);
}

contract ShortVaultAsset is MockUSDC {
    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, from == address(0) || amount == 0 ? amount : amount - 1);
    }
}

// Exercises callbacks against all vault money-moving entrypoints, without mocking the bonds.
contract CallbackAsset is MockUSDC {
    address public target;
    bytes public callback;
    bool public attempted;
    bool public succeeded;
    bytes public result;

    function arm(address target_, bytes calldata callback_) external {
        target = target_;
        callback = callback_;
        attempted = false;
        succeeded = false;
    }

    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, amount);
        if (target != address(0) && !attempted && from != address(0)) {
            attempted = true;
            (succeeded, result) = target.call(callback);
        }
    }
}

contract VaultTest is TestBase {
    MockUSDC asset;
    BondrailFactory factory;
    BondrailCovenant covenant;
    BondrailVault vault;
    address constant CURATOR = address(0xC);
    address constant ALICE = address(0xA);
    address constant BOB = address(0xB);
    address constant FORWARDER = address(0xF);
    uint256 constant OBSERVER_PK = 12345;

    event Allocated(address indexed bond, uint256 assets);
    event Collected(address indexed bond, uint256 claims, uint256 assets);
    event RaiseWithdrawn(address indexed bond, uint256 assets);

    function setUp() public {
        vm.warp(100 days);
        asset = new MockUSDC();
        covenant = new BondrailCovenant(FORWARDER, vm.addr(OBSERVER_PK));
        factory = new BondrailFactory(
            address(covenant), address(this), address(new BondrailBond()), address(new BondrailAccount()), address(this), 0
        );
        covenant.initializeFactory(address(factory));
        vault = new BondrailVault(asset, factory, address(this), CURATOR);
        asset.mint(ALICE, 10_000e6);
        asset.mint(BOB, 10_000e6);
        vm.prank(ALICE);
        asset.approve(address(vault), type(uint256).max);
        vm.prank(BOB);
        asset.approve(address(vault), type(uint256).max);
    }

    function _new(MockUSDC token, bool watched, uint256 raise) internal returns (BondrailBond b) {
        BondrailAccount account = BondrailAccount(factory.createAccount(address(token)));
        MockEarner source = new MockEarner(address(account));
        account.bindProject(address(source));
        factory.setNativeApproval(address(source), true);
        BondrailTypes.Terms memory t;
        t.raiseAmount = raise;
        t.repayCap = raise * 12 / 10;
        t.stake = watched ? 20e6 : 0;
        t.minRevenue = 1;
        t.fundingDeadline = uint64(vm.getBlockTimestamp() + 1 days);
        t.maturity = uint64(vm.getBlockTimestamp() + 60 days);
        t.secondReleaseNotBefore = uint64(vm.getBlockTimestamp() + 30);
        t.secondReleaseDeadline = uint64(vm.getBlockTimestamp() + 5 days);
        t.minOperatingPeriod = 30;
        t.revenueBps = 2000;
        t.firstReleaseBps = 5000;
        t.triggerWindowDays = 1;
        t.triggerRevenue = 100e6;
        t.stepUpBps = 4000;
        token.mint(address(this), t.stake);
        token.approve(address(factory), t.stake);
        b = BondrailBond(
            factory.createBond(
                address(account),
                t,
                BondrailTypes.AdapterConfig(
                    watched ? BondrailTypes.Adapter.Watched : BondrailTypes.Adapter.Native,
                    watched ? address(0) : address(source),
                    keccak256("vault-policy")
                ),
                "Vault Test Claim",
                "VTC"
            )
        );
    }

    function _deposit(uint256 amount) internal {
        vm.prank(ALICE);
        vault.deposit(amount, ALICE);
    }

    function _allocate(BondrailBond b, uint256 amount) internal {
        vm.prank(CURATOR);
        vault.allocate(address(b), amount);
    }

    function _collect(BondrailBond b) internal returns (uint256) {
        vm.prank(CURATOR);
        return vault.collect(address(b));
    }

    function _observe(BondrailBond b, uint8 result) internal {
        uint64 at = uint64(vm.getBlockTimestamp());
        BondrailTypes.Observation memory o = BondrailTypes.Observation(
            address(b),
            b.policyHash(),
            at / 30,
            at,
            at + 90,
            result,
            result == 1 ? b.account() : BOB,
            keccak256("offer"),
            keccak256(abi.encode(at, result))
        );
        bytes memory sig = _sig(OBSERVER_PK, covenant.hashObservation(o));
        vm.prank(FORWARDER);
        covenant.onReport("", abi.encode(o, sig));
    }

    function _activate(BondrailBond b) internal {
        uint256 gap = b.terms().raiseAmount - b.fundingEscrow();
        if (gap != 0) {
            asset.mint(address(this), gap);
            asset.approve(address(b), gap);
            b.deposit(gap);
        }
        if (b.adapter() == BondrailTypes.Adapter.Watched) _observe(b, 1);
        factory.activate(address(b));
    }

    function _revenue(BondrailBond b, uint256 amount) internal {
        asset.mint(b.account(), amount);
        BondrailAccount(b.account()).sweep();
    }

    function _close(BondrailBond b) internal {
        vm.warp(b.terms().maturity);
        BondrailAccount(b.account()).closeBondAtMaturity(address(b));
        if (b.phase() == BondrailTypes.Phase.Closing) {
            vm.warp(b.settleAfter());
            b.finalizeSettlement();
        }
    }

    function testDepositMintWithdrawRedeemIdle() public {
        eq(vault.decimals(), 12);
        _deposit(1000e6);
        eq(vault.balanceOf(ALICE), 1000e12);
        eq(vault.totalAssets(), 1000e6);
        vm.prank(BOB);
        eq(vault.mint(100e12, BOB), 100e6);
        vm.prank(ALICE);
        eq(vault.withdraw(400e6, ALICE, ALICE), 400e12);
        vm.prank(ALICE);
        eq(vault.redeem(600e12, ALICE, ALICE), 600e6);
        eq(vault.maxWithdraw(BOB), 100e6);
        uint256 bobShares = vault.balanceOf(BOB);
        vm.prank(BOB);
        vault.redeem(bobShares, BOB, BOB);
        eq(vault.totalSupply(), 0);
        eq(vault.totalAssets(), 0);
    }

    function testDelegatedWithdrawalNeedsShareAllowance() public {
        _deposit(100e6);
        vm.prank(BOB);
        vm.expectRevert();
        vault.withdraw(1e6, BOB, ALICE);
        vm.prank(ALICE);
        vault.approve(BOB, 20e12);
        vm.prank(BOB);
        vault.withdraw(20e6, BOB, ALICE);
        eq(vault.allowance(ALICE, BOB), 0);
    }

    function testAllocationRejectsNonBondAndWrongAsset() public {
        _deposit(1000e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidBond.selector);
        vault.allocate(address(asset), 1e6);
        MockUSDC other = new MockUSDC();
        BondrailBond b = _new(other, false, 100e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.WrongAsset.selector);
        vault.allocate(address(b), 10e6);
    }

    function testAllocationRejectsRevokedNativeAndWatchedViolation() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        factory.setNativeApproval(b.source(), false);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.Unhealthy.selector);
        vault.allocate(address(b), 10e6);
        b = _new(asset, true, 100e6);
        _observe(b, 2);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.Unhealthy.selector);
        vault.allocate(address(b), 10e6);
    }

    function testConcentrationLimitIncludesExistingClaims() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 500e6);
        _allocate(b, 100e6);
        _allocate(b, 150e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.ConcentrationLimit.selector);
        vault.allocate(address(b), 1);
        eq(vault.totalAssets(), 1000e6);
        eq(asset.allowance(address(vault), address(b)), 0);
    }

    function testAllocationUsesExitNAVAfterTriggerImpairment() public {
        _deposit(1000e6);
        BondrailBond a = _new(asset, false, 250e6);
        _allocate(a, 250e6);
        _activate(a);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        a.checkTrigger();
        eq(vault.totalAssets(), 875e6);
        eq(vault.entryAssets(), 1000e6);
        BondrailBond b = _new(asset, false, 250e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.ConcentrationLimit.selector);
        vault.allocate(address(b), 218.75e6 + 1);
        _allocate(b, 218.75e6);
    }

    function testFundingDeadlineRollsBackTrackingAndApproval() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 250e6);
        vm.warp(b.terms().fundingDeadline);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailBond.InvalidState.selector);
        vault.allocate(address(b), 100e6);
        eq(vault.holdings().length, 0);
        eq(asset.allowance(address(vault), address(b)), 0);
        eq(vault.idleAssets(), 1000e6);
    }

    function testIdleBufferRoundsUp() public {
        _deposit(1001);
        for (uint256 i; i < 3; ++i) {
            _allocate(_new(asset, false, 1000), 250);
        }
        BondrailBond b = _new(asset, false, 1000);
        _allocate(b, 50);
        eq(vault.idleAssets(), 201);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.IdleBuffer.selector);
        vault.allocate(address(b), 1);
    }

    function testRejectsInvalidConfigurationAndShortDeposit() public {
        vm.expectRevert(BondrailVault.InvalidConfiguration.selector);
        new BondrailVault(asset, factory, address(0), CURATOR);
        vm.expectRevert(BondrailVault.InvalidConfiguration.selector);
        new BondrailVault(asset, factory, address(this), address(0));
        vm.expectRevert(BondrailVault.InvalidConfiguration.selector);
        new BondrailVault(asset, BondrailFactory(address(0)), address(this), CURATOR);
        ShortVaultAsset token = new ShortVaultAsset();
        BondrailVault other = new BondrailVault(token, factory, address(this), CURATOR);
        token.mint(address(this), 100e6);
        token.approve(address(other), 100e6);
        vm.expectRevert(BondrailVault.InvalidAmount.selector);
        other.deposit(100e6, address(this));
        eq(other.totalAssets(), 0);
        eq(other.totalSupply(), 0);
    }

    function testIdleBufferBoundaryAndNoOverdraft() public {
        _deposit(1000e6);
        for (uint256 i; i < 3; ++i) {
            _allocate(_new(asset, false, 250e6), 250e6);
        }
        BondrailBond b = _new(asset, false, 250e6);
        _allocate(b, 50e6);
        eq(vault.idleAssets(), 200e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.IdleBuffer.selector);
        vault.allocate(address(b), 1);
        vm.prank(ALICE);
        vault.withdraw(200e6, ALICE, ALICE);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.IdleBuffer.selector);
        vault.allocate(address(b), 1e6);
    }

    function testMaximumBondsAndSlotReuse() public {
        _deposit(1000e6);
        for (uint256 i; i < 16; ++i) {
            _allocate(_new(asset, false, 100e6), 1e6);
        }
        BondrailBond extra = _new(asset, false, 100e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.BondLimit.selector);
        vault.allocate(address(extra), 1e6);
        address first = vault.holdings()[0];
        vm.prank(CURATOR);
        vault.withdrawFromRaise(first, 1e6);
        _allocate(extra, 1e6);
        eq(vault.holdings().length, 16);
        // The swapped-in holding's index must still support removal.
        address moved = vault.holdings()[0];
        vm.prank(CURATOR);
        vault.withdrawFromRaise(moved, 1e6);
        eq(vault.holdings().length, 15);
    }

    function testFundingWithdrawalAndEvents() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit Allocated(address(b), 100e6);
        _allocate(b, 100e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit RaiseWithdrawn(address(b), 30e6);
        vm.prank(CURATOR);
        vault.withdrawFromRaise(address(b), 30e6);
        eq(vault.holdingValue(address(b)), 70e6);
        eq(vault.costBasis(address(b)), 70e6);
        eq(vault.totalAssets(), 1000e6);
        vm.prank(CURATOR);
        vault.withdrawFromRaise(address(b), 70e6);
        eq(vault.holdings().length, 0);
        eq(vault.costBasis(address(b)), 0);
        _allocate(b, 10e6);
        eq(vault.costBasis(address(b)), 10e6);
        eq(vault.holdings().length, 1);
    }

    function testNAVFundingActiveRevenueClosedCollect() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        _allocate(b, 100e6);
        eq(vault.totalAssets(), 1000e6);
        _activate(b);
        eq(vault.totalAssets(), 1000e6); // cost survives staged activation
        eq(b.undrawnPrincipal(), 50e6);
        asset.mint(address(b), 99e6); // unaccounted donation is not backing
        eq(vault.totalAssets(), 1000e6);
        _revenue(b, 100e6);
        eq(vault.totalAssets(), 1000e6);
        eq(vault.holdingRecovered(address(b)), 20e6);
        _revenue(b, 200e6); // cap closes Native immediately, recovers undrawn 50
        eq(uint256(b.phase()), uint256(BondrailTypes.Phase.Closed));
        eq(vault.totalAssets(), 1000e6); // ten of profit remains unvested
        vault.checkpointIncome();
        vm.expectEmit(true, false, false, true, address(vault));
        emit Collected(address(b), 100e6, 110e6);
        eq(_collect(b), 110e6);
        eq(vault.idleAssets(), 1010e6);
        eq(vault.totalAssets(), 1000e6);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        eq(vault.totalAssets(), 1010e6);
        eq(vault.holdings().length, 0);
    }

    function testDepositsAndMintsStayOpenAcrossActivationAndClosing() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, true, 100e6);
        _allocate(b, 100e6);
        _activate(b);
        eq(vault.totalAssets(), 1000e6);
        eq(vault.holdingValue(address(b)), 100e6);
        eq(vault.maxDeposit(BOB), type(uint256).max);
        eq(vault.maxMint(BOB), type(uint256).max);
        eq(vault.previewDeposit(100e6), 100e12);
        vm.prank(BOB);
        eq(vault.deposit(100e6, BOB), 100e12);
        eq(vault.convertToAssets(vault.balanceOf(ALICE)), 1000e6);
        eq(vault.previewMint(100e12), 100e6);
        vm.prank(BOB);
        eq(vault.mint(100e12, BOB), 100e6);
        _revenue(b, 300e6);
        eq(uint256(b.phase()), uint256(BondrailTypes.Phase.Closing));
        vm.prank(BOB);
        eq(vault.deposit(1e6, BOB), 1e12);
        vm.warp(b.settleAfter());
        vm.prank(BOB);
        vault.mint(1e12, BOB);
        b.finalizeSettlement();
        eq(vault.maxDeposit(BOB), type(uint256).max);
    }

    function testNeverRedeemActiveOrClosingEvenAfterGrace() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, true, 200e6);
        _allocate(b, 100e6); // not the last holder: the bond itself WOULD allow early redemption
        _activate(b);
        _revenue(b, 100e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.collect(address(b));
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.withdrawFromRaise(address(b), 1e6);
        vm.warp(b.terms().maturity);
        BondrailAccount(b.account()).closeBondAtMaturity(address(b));
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.collect(address(b));
        vm.warp(b.settleAfter());
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.collect(address(b));
        eq(b.balanceOf(address(vault)), 100e6);
        b.finalizeSettlement();
        eq(_collect(b), 60e6);
    }

    function testCancelledRefundAndDeadlineBoundary() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, true, 100e6);
        _allocate(b, 40e6);
        vm.warp(b.terms().fundingDeadline);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailBond.InvalidState.selector);
        vault.withdrawFromRaise(address(b), 40e6);
        eq(vault.totalAssets(), 1000e6);
        BondrailAccount(b.account()).cancelFunding(address(b));
        eq(b.stakeReturnCredit(), 20e6);
        eq(vault.holdingValue(address(b)), 40e6);
        eq(vault.maxDeposit(BOB), type(uint256).max);
        eq(_collect(b), 40e6);
        eq(vault.totalAssets(), 1000e6);
        eq(vault.holdings().length, 0);
    }

    function testDefaultKeepsRealizedRecoveryRevenueAndSlashedStake() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, true, 200e6);
        _allocate(b, 100e6);
        _activate(b);
        _revenue(b, 100e6);
        vm.warp(vm.getBlockTimestamp() + 31);
        _observe(b, 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(b, 2);
        yes(b.defaultedAt() != 0);
        eq(b.pool(), 140e6); // recovered 100 + revenue 20 + stake 20
        eq(vault.holdingRecovered(address(b)), 70e6);
        eq(vault.holdingRealizedValue(address(b)), 70e6);
        eq(vault.holdingValue(address(b)), 100e6);
        eq(vault.totalAssets(), 1000e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.collect(address(b));
        _revenue(b, 50e6); // default does not terminate revenue collection
        eq(vault.holdingRecovered(address(b)), 75e6);
        eq(vault.holdingValue(address(b)), 100e6);
        _close(b);
        eq(_collect(b), 75e6);
        eq(vault.totalAssets(), 975e6);
    }

    function testWithdrawalsUseOnlyIdleWithoutBurningClaims() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 250e6);
        _allocate(b, 250e6);
        eq(vault.maxWithdraw(ALICE), 750e6);
        eq(vault.maxRedeem(ALICE), 750e12);
        vm.prank(ALICE);
        vm.expectRevert();
        vault.withdraw(750e6 + 1, ALICE, ALICE);
        vm.prank(ALICE);
        vm.expectRevert();
        vault.redeem(750e12 + 1e6, ALICE, ALICE);
        vm.prank(ALICE);
        vault.redeem(750e12, ALICE, ALICE);
        eq(vault.maxWithdraw(ALICE), 0);
        eq(vault.maxRedeem(ALICE), 0);
        eq(b.balanceOf(address(vault)), 250e6);
        vm.prank(CURATOR);
        vault.withdrawFromRaise(address(b), 250e6);
        eq(vault.maxWithdraw(ALICE), 250e6);
    }

    function testUnauthorizedAndNoArbitraryDestinationOrSweep() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        vm.expectRevert(BondrailVault.Unauthorized.selector);
        vault.allocate(address(b), 10e6); // owner is not curator
        vm.prank(BOB);
        vm.expectRevert(BondrailVault.Unauthorized.selector);
        vault.collect(address(b));
        vm.prank(BOB);
        vm.expectRevert(BondrailVault.Unauthorized.selector);
        vault.withdrawFromRaise(address(b), 10e6);
        vm.startPrank(CURATOR);
        (bool ok,) =
            address(vault).call(abi.encodeWithSignature("sweep(address,address,uint256)", address(asset), CURATOR, 1e6));
        yes(!ok);
        (ok,) = address(vault)
            .call(
                abi.encodeWithSignature(
                    "execute(address,bytes)", address(asset), abi.encodeCall(asset.transfer, (CURATOR, 1e6))
                )
            );
        yes(!ok);
        vm.expectRevert();
        vault.withdraw(1e6, CURATOR, ALICE);
        vm.stopPrank();
        eq(vault.idleAssets(), 1000e6);
        eq(asset.balanceOf(CURATOR), 0);
    }

    function testCuratorRotationOnlyOwnerAndTimelocked() public {
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.Unauthorized.selector);
        vault.proposeCurator(BOB);
        vm.expectRevert(BondrailVault.InvalidConfiguration.selector);
        vault.proposeCurator(address(0));
        vault.proposeCurator(BOB);
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vault.proposeCurator(ALICE); // reset delay
        vm.warp(vm.getBlockTimestamp() + 2 days - 1);
        vm.expectRevert(BondrailVault.TooEarly.selector);
        vault.acceptCurator();
        vm.warp(vm.getBlockTimestamp() + 1);
        vm.prank(ALICE);
        vm.expectRevert(BondrailVault.Unauthorized.selector);
        vault.acceptCurator();
        vault.acceptCurator();
        eq(vault.curator(), ALICE);
        eq(vault.pendingCurator(), address(0));
        eq(vault.curatorChangeAfter(), 0);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.acceptCurator();
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.Unauthorized.selector);
        vault.allocate(address(b), 10e6);
        vm.prank(ALICE);
        vault.allocate(address(b), 10e6);
    }

    function testInvalidAmountsStatesAndUntrackedBonds() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        vm.startPrank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidBond.selector);
        vault.collect(address(b));
        vm.expectRevert(BondrailVault.InvalidBond.selector);
        vault.withdrawFromRaise(address(b), 1);
        vm.expectRevert(BondrailVault.InvalidAmount.selector);
        vault.allocate(address(b), 0);
        vm.stopPrank();
        _allocate(b, 50e6);
        vm.prank(CURATOR);
        vm.expectRevert();
        vault.withdrawFromRaise(address(b), 50e6 + 1);
        _activate(b);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.allocate(address(b), 1e6);
    }

    function testClaimGiftsCannotAddUnboundedHoldings() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 200e6);
        _activate(b);
        b.transfer(address(vault), 1e6);
        eq(vault.holdingValue(address(b)), 0);
        eq(vault.holdings().length, 0);
        eq(vault.totalAssets(), 1000e6);
        BondrailBond tracked = _new(asset, false, 200e6);
        _allocate(tracked, 50e6);
        _activate(tracked);
        tracked.transfer(address(vault), 50e6);
        _revenue(tracked, 100e6);
        eq(vault.holdingRealizedValue(address(tracked)), 10e6);
        eq(vault.holdingValue(address(tracked)), 50e6);
        eq(vault.costBasis(address(tracked)), 50e6);
        eq(vault.holdings().length, 1);
    }

    function testTotalLossCollectRemovesHoldingWithoutEarlyBurn() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        _allocate(b, 100e6);
        _activate(b);
        vm.warp(b.terms().secondReleaseNotBefore);
        _revenue(b, 1); // enough gross milestone revenue, rounds to zero investor revenue
        factory.releaseSecond(address(b));
        _close(b);
        eq(b.pool(), 0);
        eq(_collect(b), 0);
        eq(vault.holdings().length, 0);
        eq(vault.totalAssets(), 900e6);
    }

    function testSettledSubUnitDustIsZeroNAVAndDoesNotBlockEntry() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        _allocate(b, 1);
        _activate(b);
        vm.warp(b.terms().secondReleaseNotBefore);
        _revenue(b, 5);
        factory.releaseSecond(address(b));
        _close(b);
        eq(b.pool(), 1);
        eq(vault.holdingValue(address(b)), 0);
        eq(vault.maxDeposit(BOB), type(uint256).max);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailBond.InvalidAmount.selector);
        vault.collect(address(b));
        // Other holders can consolidate dust with a transfer, after settlement.
        b.transfer(address(vault), b.balanceOf(address(this)));
        eq(_collect(b), 1);
        eq(vault.holdings().length, 0);
    }

    function testFuzzInflationAttackCannotProfit(uint96 rawDonation, uint64 rawVictim) public {
        uint256 donation = uint256(rawDonation) % 1e18 + 1;
        uint256 victim = uint256(rawVictim) % 1e12 + 1;
        asset.mint(ALICE, donation);
        asset.mint(BOB, victim);
        _deposit(1);
        vm.prank(ALICE);
        asset.transfer(address(vault), donation);
        uint256 quote = vault.previewDeposit(victim);
        vm.prank(BOB);
        if (quote == 0) {
            vm.expectRevert(BondrailVault.InvalidAmount.selector);
            vault.deposit(victim, BOB);
        } else {
            eq(vault.deposit(victim, BOB), quote);
            yes(vault.balanceOf(BOB) > 0);
        }
        uint256 shares = vault.balanceOf(ALICE);
        vm.prank(ALICE);
        uint256 out = vault.redeem(shares, ALICE, ALICE);
        yes(out <= donation + 1);
    }

    function testReentrancyDepositWithdrawalAndCuratorPaths() public {
        CallbackAsset token = new CallbackAsset();
        BondrailVault guarded = new BondrailVault(token, factory, address(this), address(token));
        token.mint(address(this), 1000e6);
        token.approve(address(guarded), type(uint256).max);
        token.arm(address(guarded), abi.encodeCall(guarded.deposit, (1, address(token))));
        guarded.deposit(1000e6, address(this));
        yes(token.attempted());
        yes(!token.succeeded());
        yes(bytes4(token.result()) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        BondrailBond b = _new(token, false, 100e6);
        token.arm(address(guarded), abi.encodeCall(guarded.allocate, (address(b), 1e6)));
        guarded.withdraw(1e6, address(this), address(this));
        yes(token.attempted());
        yes(!token.succeeded());
        yes(bytes4(token.result()) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        token.arm(address(guarded), abi.encodeCall(guarded.withdrawFromRaise, (address(b), 1)));
        vm.prank(address(token));
        guarded.allocate(address(b), 100e6);
        yes(token.attempted());
        yes(!token.succeeded());
        yes(bytes4(token.result()) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        token.arm(address(guarded), abi.encodeCall(guarded.withdrawFromRaise, (address(b), 1)));
        vm.prank(address(token));
        guarded.withdrawFromRaise(address(b), 10e6);
        yes(token.attempted());
        yes(!token.succeeded());
        yes(bytes4(token.result()) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
        vm.warp(b.terms().fundingDeadline);
        BondrailAccount(b.account()).cancelFunding(address(b));
        token.arm(address(guarded), abi.encodeCall(guarded.collect, (address(b))));
        vm.prank(address(token));
        guarded.collect(address(b));
        yes(token.attempted());
        yes(!token.succeeded());
        yes(bytes4(token.result()) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
    }

    function _default(BondrailBond b) internal {
        vm.warp(vm.getBlockTimestamp() + 31);
        _observe(b, 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(b, 2);
        yes(b.defaultedAt() != 0);
    }

    function testTriggerSeparatesEntryAndExitPricesAndReverses() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 200e6);
        _allocate(b, 200e6);
        _activate(b);
        vm.warp(vm.getBlockTimestamp() + 2 days);
        b.checkTrigger();
        eq(vault.entryAssets(), 1000e6);
        eq(vault.totalAssets(), 900e6);
        eq(vault.previewDeposit(100e6), 100e12);
        eq(vault.previewMint(100e12), 100e6);
        eq(vault.previewRedeem(100e12), 90e6);
        yes(vault.previewWithdraw(100e6) > 100e12);
        uint256 quoted = vault.previewDeposit(100e6);
        vm.prank(BOB);
        eq(vault.deposit(100e6, BOB), quoted);
        eq(vault.entryAssets(), 1100e6);
        eq(vault.totalAssets(), 1000e6);
        uint256 mintCost = vault.previewMint(100e12);
        vm.prank(BOB);
        eq(vault.mint(100e12, BOB), mintCost);
        uint256 burn = vault.previewWithdraw(10e6);
        vm.prank(BOB);
        eq(vault.withdraw(10e6, BOB, BOB), burn);
        _revenue(b, 100e6); // 40 investor revenue under step-up; still below cost
        vm.warp(vm.getBlockTimestamp() + 1 days);
        b.checkTrigger();
        yes(!b.triggered());
        eq(vault.totalAssets(), vault.entryAssets());
    }

    function testDefaultLinearWritedownAndRecoveryReversesLoss() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, true, 200e6);
        _allocate(b, 100e6);
        _activate(b);
        _default(b);
        uint256 start = b.defaultedAt();
        eq(vault.holdingRecovered(address(b)), 60e6); // half of undrawn 100 + stake 20
        eq(vault.totalAssets(), 1000e6);
        eq(vault.entryAssets(), 1000e6);
        vm.warp(start + 15 days);
        eq(vault.holdingValue(address(b)), 80e6); // 60 + 40/2
        eq(vault.totalAssets(), 980e6);
        eq(vault.entryAssets(), 1000e6);
        _revenue(b, 100e6); // current holder's share receives another 10
        eq(vault.holdingValue(address(b)), 85e6); // 70 + 30/2, impairment reverses by 5
        eq(vault.entryAssets(), 1000e6);
        vm.warp(start + 30 days);
        eq(vault.holdingValue(address(b)), 70e6);
        vm.warp(start + 31 days);
        eq(vault.holdingValue(address(b)), 70e6);
        _revenue(b, 50e6);
        eq(vault.holdingValue(address(b)), 75e6);
        eq(vault.entryAssets(), 1000e6);
        _close(b);
        eq(vault.holdingValue(address(b)), 75e6);
        eq(vault.holdingEntryValue(address(b)), 75e6);
        eq(_collect(b), 75e6);
        eq(vault.costBasis(address(b)), 0);
    }

    function testMaturityWritedownWithoutSettlementAndLateDefaultDoesNotRestart() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, true, 200e6);
        _allocate(b, 100e6);
        _activate(b);
        uint256 maturity = b.maturity();
        vm.warp(maturity);
        eq(vault.totalAssets(), 1000e6);
        vm.warp(maturity + 15 days);
        eq(vault.holdingValue(address(b)), 50e6);
        eq(vault.holdingEntryValue(address(b)), 100e6);
        // Default recovers undrawn + stake but the existing maturity clock continues.
        vm.prank(address(covenant));
        b.markDefault(keccak256("late-default"));
        eq(vault.holdingValue(address(b)), 80e6);
        vm.warp(maturity + 30 days);
        eq(vault.holdingValue(address(b)), 60e6);
        BondrailAccount(b.account()).closeBondAtMaturity(address(b));
        eq(vault.holdingEntryValue(address(b)), 60e6);
        eq(vault.holdingValue(address(b)), 60e6);
    }

    function testProfitVestsLinearlyAndCollectDoesNotUnlockIt() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 100e6);
        _allocate(b, 100e6);
        _activate(b);
        _revenue(b, 100e6);
        eq(vault.holdingRecovered(address(b)), 20e6);
        eq(vault.totalAssets(), 1000e6);
        _revenue(b, 200e6);
        eq(vault.unvestedIncome(), 10e6);
        eq(vault.totalAssets(), 1000e6);
        // Views are conservative even when nobody checkpoints promptly.
        vm.warp(vm.getBlockTimestamp() + 2 days);
        eq(vault.totalAssets(), 1000e6);
        vault.checkpointIncome();
        uint256 start = vault.incomeVestingStart();
        vm.warp(start + 3.5 days);
        eq(vault.totalAssets(), 1005e6);
        eq(vault.entryAssets(), 1005e6);
        eq(vault.unvestedIncome(), 5e6);
        vault.checkpointIncome(); // cannot relock without new income
        eq(vault.incomeVestingStart(), start);
        eq(_collect(b), 110e6);
        eq(vault.totalAssets(), 1005e6);
        eq(vault.unvestedIncome(), 5e6);
        vm.warp(start + 7 days);
        eq(vault.totalAssets(), 1010e6);
        eq(vault.unvestedIncome(), 0);
    }

    function testFrontRunningRepaymentCannotCaptureImmediateIncome() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 250e6);
        _allocate(b, 250e6);
        _activate(b);
        vm.prank(BOB);
        uint256 shares = vault.deposit(1000e6, BOB);
        _revenue(b, 750e6); // finishes the cap: 275 recovered, 25 profit
        eq(vault.unvestedIncome(), 25e6);
        eq(vault.previewRedeem(shares), 1000e6);
        vm.prank(BOB);
        eq(vault.redeem(shares, BOB, BOB), 1000e6);
        eq(vault.totalAssets(), 1000e6);
        // Exiting checkpointed income. One-second capture is only the linear vested fraction.
        vm.warp(vm.getBlockTimestamp() + 1);
        yes(vault.totalAssets() - 1000e6 <= uint256(25e6) / 7 days);
    }

    function testNewProfitMergesOnlyUnvestedRemainderAndSlotsCanBeReused() public {
        _deposit(1000e6);
        BondrailBond a = _new(asset, false, 100e6);
        BondrailBond b = _new(asset, false, 100e6);
        _allocate(a, 100e6);
        _allocate(b, 100e6);
        _activate(a);
        _activate(b);
        _revenue(a, 300e6);
        vault.checkpointIncome();
        vm.warp(vm.getBlockTimestamp() + 3.5 days);
        eq(vault.totalAssets(), 1005e6);
        _revenue(b, 300e6);
        eq(vault.unvestedIncome(), 15e6);
        uint256 beforeNav = vault.totalAssets();
        vault.checkpointIncome();
        eq(vault.totalAssets(), beforeNav);
        eq(vault.lockedIncome(), 15e6);
        _collect(a);
        _collect(b);
        _allocate(_new(asset, false, 100e6), 100e6);
        eq(vault.totalAssets(), 1005e6);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        eq(vault.totalAssets(), 1020e6);
    }

    function testCapSubtractsPriorRedemptionsAndIncludesStagedPrincipal() public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 200e6);
        _allocate(b, 100e6);
        _activate(b);
        eq(vault.holdingEntryValue(address(b)), 100e6);
        _revenue(b, 100e6);
        eq(b.redeem(50e6, address(this)), 5e6);
        uint256 cap = (b.effectiveRevenueCap() + b.undrawnPrincipal() - b.totalRedeemed()) * b.balanceOf(address(vault))
            / b.totalSupply();
        yes(vault.holdingEntryValue(address(b)) <= cap);
        yes(vault.holdingValue(address(b)) <= cap);
        // Releasing the second tranche changes the effective cap without creating profit.
        vm.warp(b.terms().secondReleaseNotBefore);
        factory.releaseSecond(address(b));
        eq(b.undrawnPrincipal(), 0);
        cap = (b.effectiveRevenueCap() - b.totalRedeemed()) * b.balanceOf(address(vault)) / b.totalSupply();
        yes(vault.holdingEntryValue(address(b)) <= cap);
        eq(vault.unvestedIncome(), 0);
    }

    function testFuzzExitNAVNeverExceedsEntryNAV(uint128 seed, uint32 elapsed, uint8 stage) public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, true, 300e6);
        _allocate(b, uint256(seed) % 250e6 + 1);
        _activate(b);
        _revenue(b, uint256(seed) % 800e6);
        if (stage % 4 == 0) {
            vm.warp(vm.getBlockTimestamp() + 2 days);
            b.checkTrigger();
        } else if (stage % 4 == 1) {
            _default(b);
            vm.warp(vm.getBlockTimestamp() + uint256(elapsed) % 31 days);
        } else if (stage % 4 == 2) {
            vm.warp(uint256(b.maturity()) + uint256(elapsed) % 31 days);
        } else {
            _close(b);
        }
        uint256 exitNav = vault.totalAssets();
        uint256 entryNav = vault.entryAssets();
        yes(exitNav <= entryNav);
        yes(vault.holdingValue(address(b)) <= vault.holdingEntryValue(address(b)));
        uint256 ceiling =
            (b.effectiveRevenueCap()
                    + b.undrawnPrincipal()
                    + b.principalRecovery()
                    + b.stakeRecovery()
                    - b.totalRedeemed()) * b.balanceOf(address(vault)) / b.totalSupply();
        yes(vault.holdingEntryValue(address(b)) <= ceiling);
        vault.checkpointIncome();
        eq(vault.totalAssets(), exitNav);
        eq(vault.entryAssets(), entryNav);
        vm.warp(vm.getBlockTimestamp() + 7 days);
        yes(vault.totalAssets() <= vault.entryAssets());
        uint256 shares = vault.previewDeposit(1e6);
        vm.prank(BOB);
        eq(vault.deposit(1e6, BOB), shares);
        yes(vault.totalAssets() <= vault.entryAssets());
        uint256 assets = vault.previewRedeem(shares);
        yes(assets <= 1e6);
        vm.prank(BOB);
        eq(vault.redeem(shares, BOB, BOB), assets);
    }

    /// Independent receipt oracle: snapshot, actually withdraw/refund/redeem as the vault, restore.
    /// Active/Closing redemption is counterfactual backing only; production collect forbids it.
    function _assertRealizable() internal {
        uint256 backing = vault.idleAssets();
        address[] memory positions = vault.holdings();
        for (uint256 i; i < positions.length; ++i) {
            backing += vault.holdingRealizedValue(positions[i]);
        }
        uint256 snapshot = SnapshotVm(address(vm)).snapshotState();
        address[] memory held = vault.holdings();
        for (uint256 i; i < held.length; ++i) {
            BondrailBond b = BondrailBond(held[i]);
            uint256 claims = b.balanceOf(address(vault));
            BondrailTypes.Phase p = b.phase();
            if (p == BondrailTypes.Phase.Funding) {
                vm.prank(address(vault));
                b.withdraw(claims, address(vault));
            } else if (p == BondrailTypes.Phase.Cancelled) {
                vm.prank(address(vault));
                b.refund(claims, address(vault));
            } else if (b.pool() != 0 && claims * b.pool() / b.totalSupply() == 0) {
                eq(vault.holdingRealizedValue(address(b)), 0); // bond rejects a zero-valued slice of positive pool
            } else {
                vm.prank(address(vault));
                b.redeem(claims, address(vault));
            }
        }
        eq(backing, asset.balanceOf(address(vault)));
        yes(SnapshotVm(address(vm)).revertToState(snapshot));
    }

    function testFuzzRealizedBackingMatchesReceiptsAndSettlementNAV(uint128 seed, bool defaulted) public {
        _deposit(1000e6);
        BondrailBond a = _new(asset, false, 300e6);
        BondrailBond b = _new(asset, true, 300e6);
        BondrailBond c = _new(asset, true, 300e6);
        _allocate(a, uint256(seed) % 200e6 + 1);
        _allocate(b, uint256(keccak256(abi.encode(seed))) % 200e6 + 1);
        _allocate(c, uint256(keccak256(abi.encode(seed, "c"))) % 200e6 + 1);
        _assertRealizable();
        _activate(a);
        _activate(b);
        _assertRealizable();
        _revenue(a, uint256(seed) % 100e6);
        _revenue(b, uint256(seed) % 200e6);
        asset.mint(address(a), uint256(seed) % 99e6); // surplus does not inflate NAV
        if (defaulted) {
            vm.warp(vm.getBlockTimestamp() + 31);
            _observe(b, 2);
            vm.warp(vm.getBlockTimestamp() + 30);
            _observe(b, 2);
        }
        _assertRealizable();
        vm.warp(c.terms().fundingDeadline);
        BondrailAccount(c.account()).cancelFunding(address(c));
        _assertRealizable();
        vm.warp(a.terms().maturity);
        BondrailAccount(a.account()).closeBondAtMaturity(address(a));
        BondrailAccount(b.account()).closeBondAtMaturity(address(b));
        _assertRealizable();
        vm.warp(b.settleAfter());
        b.finalizeSettlement();
        _assertRealizable();
        uint256 nav = vault.totalAssets();
        if (vault.holdingValue(address(a)) != 0 || a.pool() == 0) _collect(a);
        if (vault.holdingValue(address(b)) != 0 || b.pool() == 0) _collect(b);
        _collect(c);
        eq(vault.idleAssets(), nav);
        eq(vault.totalAssets(), nav);
    }

    function testFuzzMaximaAreExecutable(uint128 seed, uint64 rawExit) public {
        _deposit(1000e6);
        BondrailBond b = _new(asset, false, 300e6);
        _allocate(b, uint256(seed) % 250e6 + 1);
        _activate(b);
        _revenue(b, uint256(seed) % 100e6);
        uint256 maxAssets = vault.maxWithdraw(ALICE);
        uint256 amount = uint256(rawExit) % (maxAssets + 1);
        if (amount != 0) {
            vm.prank(ALICE);
            vault.withdraw(amount, ALICE, ALICE);
        }
        uint256 shares = vault.maxRedeem(ALICE);
        yes(vault.previewRedeem(shares) <= vault.idleAssets());
        if (shares != 0) {
            vm.prank(ALICE);
            vault.redeem(shares, ALICE, ALICE);
        }
        yes(b.balanceOf(address(vault)) > 0);
    }
}
