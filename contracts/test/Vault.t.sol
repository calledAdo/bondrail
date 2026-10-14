// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./TestBase.sol";
import {BondrailVault} from "../src/BondrailVault.sol";
import {SliceBond} from "../src/SliceBond.sol";
import {SliceAccount} from "../src/SliceAccount.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {SliceTypes} from "../src/SliceTypes.sol";
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
    SliceFactory factory;
    SliceCovenant covenant;
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
        covenant = new SliceCovenant(FORWARDER, vm.addr(OBSERVER_PK));
        factory = new SliceFactory(
            address(covenant), address(this), address(new SliceBond()), address(new SliceAccount()), address(this), 0
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

    function _new(MockUSDC token, bool watched, uint256 raise) internal returns (SliceBond b) {
        SliceAccount account = SliceAccount(factory.createAccount(address(token)));
        MockEarner source = new MockEarner(address(account));
        account.bindProject(address(source));
        factory.setNativeApproval(address(source), true);
        SliceTypes.Terms memory t;
        t.raiseAmount = raise;
        t.repayCap = raise * 12 / 10;
        t.stake = watched ? 20e6 : 0;
        t.minRevenue = 1;
        t.fundingDeadline = uint64(vm.getBlockTimestamp() + 1 days);
        t.maturity = uint64(vm.getBlockTimestamp() + 10 days);
        t.secondReleaseNotBefore = uint64(vm.getBlockTimestamp() + 30);
        t.secondReleaseDeadline = uint64(vm.getBlockTimestamp() + 5 days);
        t.minOperatingPeriod = 30;
        t.revenueBps = 2000;
        t.firstReleaseBps = 5000;
        token.mint(address(this), t.stake);
        token.approve(address(factory), t.stake);
        b = SliceBond(
            factory.createBond(
                address(account),
                t,
                SliceTypes.AdapterConfig(
                    watched ? SliceTypes.Adapter.Watched : SliceTypes.Adapter.Native,
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

    function _allocate(SliceBond b, uint256 amount) internal {
        vm.prank(CURATOR);
        vault.allocate(address(b), amount);
    }

    function _collect(SliceBond b) internal returns (uint256) {
        vm.prank(CURATOR);
        return vault.collect(address(b));
    }

    function _observe(SliceBond b, uint8 result) internal {
        uint64 at = uint64(vm.getBlockTimestamp());
        SliceTypes.Observation memory o = SliceTypes.Observation(
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

    function _activate(SliceBond b) internal {
        uint256 gap = b.terms().raiseAmount - b.fundingEscrow();
        if (gap != 0) {
            asset.mint(address(this), gap);
            asset.approve(address(b), gap);
            b.deposit(gap);
        }
        if (b.adapter() == SliceTypes.Adapter.Watched) _observe(b, 1);
        factory.activate(address(b));
    }

    function _revenue(SliceBond b, uint256 amount) internal {
        asset.mint(b.account(), amount);
        SliceAccount(b.account()).sweep();
    }

    function _close(SliceBond b) internal {
        vm.warp(b.terms().maturity);
        SliceAccount(b.account()).closeBondAtMaturity(address(b));
        if (b.phase() == SliceTypes.Phase.Closing) {
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
        SliceBond b = _new(other, false, 100e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.WrongAsset.selector);
        vault.allocate(address(b), 10e6);
    }

    function testAllocationRejectsRevokedNativeAndWatchedViolation() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, false, 100e6);
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
        SliceBond b = _new(asset, false, 500e6);
        _allocate(b, 100e6);
        _allocate(b, 150e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.ConcentrationLimit.selector);
        vault.allocate(address(b), 1);
        eq(vault.totalAssets(), 1000e6);
        eq(asset.allowance(address(vault), address(b)), 0);
    }

    function testAllocationUsesNAVAfterActivationMarkdown() public {
        _deposit(1000e6);
        SliceBond a = _new(asset, false, 250e6);
        SliceBond b = _new(asset, false, 250e6);
        _allocate(a, 250e6);
        _activate(a);
        eq(vault.totalAssets(), 750e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.ConcentrationLimit.selector);
        vault.allocate(address(b), 200e6);
        _allocate(b, 187.5e6);
    }

    function testFundingDeadlineRollsBackTrackingAndApproval() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, false, 250e6);
        vm.warp(b.terms().fundingDeadline);
        vm.prank(CURATOR);
        vm.expectRevert(SliceBond.InvalidState.selector);
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
        SliceBond b = _new(asset, false, 1000);
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
        new BondrailVault(asset, SliceFactory(address(0)), address(this), CURATOR);
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
        SliceBond b = _new(asset, false, 250e6);
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
        SliceBond extra = _new(asset, false, 100e6);
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
        SliceBond b = _new(asset, false, 100e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit Allocated(address(b), 100e6);
        _allocate(b, 100e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit RaiseWithdrawn(address(b), 30e6);
        vm.prank(CURATOR);
        vault.withdrawFromRaise(address(b), 30e6);
        eq(vault.holdingValue(address(b)), 70e6);
        eq(vault.totalAssets(), 1000e6);
        vm.prank(CURATOR);
        vault.withdrawFromRaise(address(b), 70e6);
        eq(vault.holdings().length, 0);
        _allocate(b, 10e6);
        eq(vault.holdings().length, 1);
    }

    function testNAVFundingActiveRevenueClosedCollect() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, false, 100e6);
        _allocate(b, 100e6);
        eq(vault.totalAssets(), 1000e6);
        _activate(b);
        eq(vault.totalAssets(), 900e6); // even undrawn principal is excluded until recovered
        eq(b.undrawnPrincipal(), 50e6);
        asset.mint(address(b), 99e6); // unaccounted donation is not backing
        eq(vault.totalAssets(), 900e6);
        _revenue(b, 100e6);
        eq(vault.totalAssets(), 920e6);
        _revenue(b, 200e6); // cap closes Native immediately, recovers undrawn 50
        eq(uint256(b.phase()), uint256(SliceTypes.Phase.Closed));
        eq(vault.totalAssets(), 1010e6);
        vm.expectEmit(true, false, false, true, address(vault));
        emit Collected(address(b), 100e6, 110e6);
        eq(_collect(b), 110e6);
        eq(vault.idleAssets(), 1010e6);
        eq(vault.totalAssets(), 1010e6);
        eq(vault.holdings().length, 0);
    }

    function testEntryWindowsAlsoCloseForZeroValuedClaimsAndMint() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, true, 100e6);
        _allocate(b, 100e6);
        yes(vault.depositsOpen());
        _activate(b);
        yes(!vault.depositsOpen());
        eq(vault.holdingValue(address(b)), 0);
        eq(vault.maxDeposit(BOB), 0);
        eq(vault.maxMint(BOB), 0);
        vm.prank(BOB);
        vm.expectRevert();
        vault.deposit(1e6, BOB);
        vm.prank(BOB);
        vm.expectRevert();
        vault.mint(1e12, BOB);
        _revenue(b, 300e6);
        eq(uint256(b.phase()), uint256(SliceTypes.Phase.Closing));
        yes(!vault.depositsOpen());
        vm.warp(b.settleAfter());
        yes(!vault.depositsOpen()); // elapsed grace is not finalized settlement
        b.finalizeSettlement();
        yes(vault.depositsOpen());
        vm.prank(BOB);
        vault.deposit(1e6, BOB);
    }

    function testNeverRedeemActiveOrClosingEvenAfterGrace() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, true, 200e6);
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
        SliceAccount(b.account()).closeBondAtMaturity(address(b));
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
        SliceBond b = _new(asset, true, 100e6);
        _allocate(b, 40e6);
        vm.warp(b.terms().fundingDeadline);
        vm.prank(CURATOR);
        vm.expectRevert(SliceBond.InvalidState.selector);
        vault.withdrawFromRaise(address(b), 40e6);
        eq(vault.totalAssets(), 1000e6);
        SliceAccount(b.account()).cancelFunding(address(b));
        eq(b.stakeReturnCredit(), 20e6);
        eq(vault.holdingValue(address(b)), 40e6);
        yes(vault.depositsOpen());
        eq(_collect(b), 40e6);
        eq(vault.totalAssets(), 1000e6);
        eq(vault.holdings().length, 0);
    }

    function testDefaultKeepsRealizedRecoveryRevenueAndSlashedStake() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, true, 200e6);
        _allocate(b, 100e6);
        _activate(b);
        _revenue(b, 100e6);
        vm.warp(vm.getBlockTimestamp() + 31);
        _observe(b, 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(b, 2);
        yes(b.defaultedAt() != 0);
        eq(b.pool(), 140e6); // recovered 100 + revenue 20 + stake 20
        eq(vault.holdingValue(address(b)), 70e6);
        eq(vault.totalAssets(), 970e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.InvalidState.selector);
        vault.collect(address(b));
        _revenue(b, 50e6); // default does not terminate revenue collection
        eq(vault.holdingValue(address(b)), 75e6);
        _close(b);
        eq(_collect(b), 75e6);
        eq(vault.totalAssets(), 975e6);
    }

    function testWithdrawalsUseOnlyIdleWithoutBurningClaims() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, false, 250e6);
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
        SliceBond b = _new(asset, false, 100e6);
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
        SliceBond b = _new(asset, false, 100e6);
        vm.prank(CURATOR);
        vm.expectRevert(BondrailVault.Unauthorized.selector);
        vault.allocate(address(b), 10e6);
        vm.prank(ALICE);
        vault.allocate(address(b), 10e6);
    }

    function testInvalidAmountsStatesAndUntrackedBonds() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, false, 100e6);
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
        SliceBond b = _new(asset, false, 200e6);
        _activate(b);
        b.transfer(address(vault), 1e6);
        eq(vault.holdingValue(address(b)), 0);
        eq(vault.holdings().length, 0);
        eq(vault.totalAssets(), 1000e6);
        SliceBond tracked = _new(asset, false, 200e6);
        _allocate(tracked, 50e6);
        _activate(tracked);
        tracked.transfer(address(vault), 50e6);
        _revenue(tracked, 100e6);
        eq(vault.holdingValue(address(tracked)), 10e6);
        eq(vault.holdings().length, 1);
    }

    function testTotalLossCollectRemovesHoldingWithoutEarlyBurn() public {
        _deposit(1000e6);
        SliceBond b = _new(asset, false, 100e6);
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
        SliceBond b = _new(asset, false, 100e6);
        _allocate(b, 1);
        _activate(b);
        vm.warp(b.terms().secondReleaseNotBefore);
        _revenue(b, 5);
        factory.releaseSecond(address(b));
        _close(b);
        eq(b.pool(), 1);
        eq(vault.holdingValue(address(b)), 0);
        yes(vault.depositsOpen());
        vm.prank(CURATOR);
        vm.expectRevert(SliceBond.InvalidAmount.selector);
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
        SliceBond b = _new(token, false, 100e6);
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
        SliceAccount(b.account()).cancelFunding(address(b));
        token.arm(address(guarded), abi.encodeCall(guarded.collect, (address(b))));
        vm.prank(address(token));
        guarded.collect(address(b));
        yes(token.attempted());
        yes(!token.succeeded());
        yes(bytes4(token.result()) == bytes4(keccak256("ReentrancyGuardReentrantCall()")));
    }

    /// Independent receipt oracle: snapshot, actually withdraw/refund/redeem as the vault, restore.
    /// Active/Closing redemption is counterfactual backing only; production collect forbids it.
    function _assertRealizable() internal {
        uint256 nav = vault.totalAssets();
        uint256 snapshot = SnapshotVm(address(vm)).snapshotState();
        address[] memory held = vault.holdings();
        for (uint256 i; i < held.length; ++i) {
            SliceBond b = SliceBond(held[i]);
            uint256 claims = b.balanceOf(address(vault));
            SliceTypes.Phase p = b.phase();
            if (p == SliceTypes.Phase.Funding) {
                vm.prank(address(vault));
                b.withdraw(claims, address(vault));
            } else if (p == SliceTypes.Phase.Cancelled) {
                vm.prank(address(vault));
                b.refund(claims, address(vault));
            } else if (b.pool() != 0 && claims * b.pool() / b.totalSupply() == 0) {
                eq(vault.holdingValue(address(b)), 0); // bond rejects a zero-valued slice of positive pool
            } else {
                vm.prank(address(vault));
                b.redeem(claims, address(vault));
            }
        }
        yes(nav <= asset.balanceOf(address(vault)));
        yes(SnapshotVm(address(vm)).revertToState(snapshot));
    }

    function testFuzzNAVNeverExceedsActualRealizableBacking(uint128 seed, bool defaulted) public {
        _deposit(1000e6);
        SliceBond a = _new(asset, false, 300e6);
        SliceBond b = _new(asset, true, 300e6);
        SliceBond c = _new(asset, true, 300e6);
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
        SliceAccount(c.account()).cancelFunding(address(c));
        _assertRealizable();
        vm.warp(a.terms().maturity);
        SliceAccount(a.account()).closeBondAtMaturity(address(a));
        SliceAccount(b.account()).closeBondAtMaturity(address(b));
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
        SliceBond b = _new(asset, false, 300e6);
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
