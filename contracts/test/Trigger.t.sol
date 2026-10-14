// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase, Vm} from "./TestBase.sol";
import {SliceTypes} from "../src/SliceTypes.sol";
import {SliceBond} from "../src/SliceBond.sol";
import {SliceAccount} from "../src/SliceAccount.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {MockERC3009} from "./mocks/MockERC3009.sol";
import {MockEarner} from "./mocks/MockEarner.sol";

contract TriggerTest is TestBase {
    MockERC3009 asset;
    SliceFactory factory;
    SliceCovenant covenant;
    SliceAccount account;
    MockEarner earner;
    SliceBond bond;
    SliceTypes.Terms t;
    uint256 constant PAYER_PK = 1234;
    uint256 constant OBSERVER_PK = 5678;
    address constant FORWARDER = address(0x444);
    uint256 nonce;

    event TriggerChanged(bool triggered);
    event TriggerChecked(uint256 windowRevenue, bool triggered);

    function setUp() public {
        vm.warp(100 days + 12 hours);
        asset = new MockERC3009();
        covenant = new SliceCovenant(FORWARDER, vm.addr(OBSERVER_PK));
        factory = new SliceFactory(
            address(covenant), address(this), address(new SliceBond()), address(new SliceAccount()), address(this), 0
        );
        covenant.initializeFactory(address(factory));
        account = SliceAccount(factory.createAccount(address(asset)));
        earner = new MockEarner(address(account));
        account.bindProject(address(earner));
        factory.setNativeApproval(address(earner), true);
        t.raiseAmount = 100e6;
        t.repayCap = 120e6;
        t.stake = 20e6;
        t.minRevenue = 1;
        t.fundingDeadline = uint64(vm.getBlockTimestamp() + 1 days);
        t.maturity = uint64(vm.getBlockTimestamp() + 90 days);
        t.secondReleaseNotBefore = uint64(vm.getBlockTimestamp() + 30);
        t.secondReleaseDeadline = uint64(vm.getBlockTimestamp() + 60 days);
        t.minOperatingPeriod = 30;
        t.revenueBps = 2500;
        t.firstReleaseBps = 5000;
        t.triggerWindowDays = 2;
        t.stepUpBps = 4000;
        t.triggerRevenue = 10;
        asset.mint(address(this), 120e6);
        asset.approve(address(factory), type(uint256).max);
    }

    function _create(bool watched) internal {
        bond = SliceBond(
            factory.createBond(
                address(account),
                t,
                SliceTypes.AdapterConfig(
                    watched ? SliceTypes.Adapter.Watched : SliceTypes.Adapter.Native,
                    watched ? address(0) : address(earner),
                    keccak256("trigger")
                ),
                "Trigger Claim",
                "TRG"
            )
        );
    }

    function _activate(bool watched) internal {
        _create(watched);
        asset.approve(address(bond), t.raiseAmount);
        bond.deposit(t.raiseAmount);
        if (watched) {
            uint64 now_ = uint64(vm.getBlockTimestamp());
            SliceTypes.Observation memory o = SliceTypes.Observation(
                address(bond),
                bond.policyHash(),
                now_ / 30,
                now_,
                now_ + 90,
                1,
                address(account),
                keccak256("offer"),
                keccak256("evidence")
            );
            bytes memory sig = _sig(OBSERVER_PK, covenant.hashObservation(o));
            vm.prank(FORWARDER);
            covenant.onReport("", abi.encode(o, sig));
        }
        factory.activate(address(bond));
    }

    function _day(uint256 offset) internal {
        vm.warp((uint256(bond.activationTime()) / 1 days + offset) * 1 days);
    }

    // Exercise every revenue entrypoint; the token verifies real EIP-3009 signatures.
    function _pay(uint256 amount, uint8 kind) internal {
        if (kind % 4 == 0) {
            asset.mint(address(account), amount);
            account.sweep();
        } else if (kind % 4 == 1) {
            asset.mint(address(this), amount);
            asset.approve(address(account), amount);
            earner.payIn(amount, amount);
        } else if (kind % 4 == 2) {
            asset.mint(address(earner), amount);
            earner.payOut(address(this), amount, amount);
        } else {
            address payer = vm.addr(PAYER_PK);
            asset.mint(payer, amount);
            uint256 deadline = vm.getBlockTimestamp() + 300;
            bytes32 id = bytes32(++nonce);
            (uint8 v, bytes32 r, bytes32 s) =
                vm.sign(PAYER_PK, asset.hashAuthorization(payer, address(account), amount, 0, deadline, id));
            account.settle(payer, amount, 0, deadline, id, v, r, s);
        }
    }

    function testDisabledTriggerKeepsBaseShare() public {
        t.triggerRevenue = 0;
        t.triggerWindowDays = 0;
        t.stepUpBps = 0;
        _activate(false);
        _day(3);
        vm.expectRevert(SliceBond.InvalidState.selector);
        bond.checkTrigger();
        eq(bond.revenueBps(), 2500);
        _pay(12, 1);
        eq(bond.totalRevenueCollected(), 3);
    }

    function testFuzzValidationAllOrNoneAndBounds(uint8 mask, uint16 days_, uint16 step) public {
        t.triggerRevenue = mask & 1 == 0 ? 0 : 10;
        t.triggerWindowDays = mask & 2 == 0 ? 0 : days_;
        t.stepUpBps = mask & 4 == 0 ? 0 : step;
        bool disabled = t.triggerRevenue == 0 && t.triggerWindowDays == 0 && t.stepUpBps == 0;
        bool valid = t.triggerRevenue > 0 && t.triggerWindowDays >= 1 && t.triggerWindowDays <= 30
            && t.stepUpBps > t.revenueBps && t.stepUpBps <= 5000;
        if (!disabled && !valid) vm.expectRevert(SliceFactory.InvalidTerms.selector);
        _create(false);
    }

    function testValidationExplicitBoundaries() public {
        t.triggerWindowDays = 31;
        vm.expectRevert(SliceFactory.InvalidTerms.selector);
        _create(false);
        t.triggerWindowDays = 1;
        t.stepUpBps = 2500;
        vm.expectRevert(SliceFactory.InvalidTerms.selector);
        _create(false);
        t.stepUpBps = 5001;
        vm.expectRevert(SliceFactory.InvalidTerms.selector);
        _create(false);
        t.stepUpBps = 2501;
        _create(false);
        eq(bond.terms().triggerWindowDays, 1);
    }

    function testThirtyDayWindowAndMaximumShare() public {
        t.triggerWindowDays = 30;
        t.stepUpBps = 5000;
        _activate(false);
        _day(1);
        _pay(9, 0);
        _day(30);
        vm.expectRevert(SliceBond.TooEarly.selector);
        bond.checkTrigger();
        _day(31);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChanged(true);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChecked(9, true);
        bond.checkTrigger();
        yes(bond.triggered());
        eq(bond.revenueBps(), 5000);
    }

    function testNeedsFullWindowAndExcludesEarlierDays() public {
        _pay(100, 0); // historical revenue before the activation day
        vm.warp(101 days);
        _activate(false);
        _day(3);
        vm.warp(vm.getBlockTimestamp() - 1);
        vm.expectRevert(SliceBond.TooEarly.selector);
        bond.checkTrigger();
        eq(bond.lastTriggerCheckDay(), 0);
        _day(3);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChanged(true);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChecked(0, true);
        vm.prank(address(0xBEEF)); // permissionless
        bond.checkTrigger();
        yes(bond.triggered());
    }

    function testFuzzFirstEligibleDay(uint8 rawWindow, uint32 activationSecond, bool watched) public {
        t.triggerWindowDays = uint16(rawWindow % 30) + 1;
        vm.warp(100 days + uint256(activationSecond) % 1 days);
        _activate(watched);
        _day(t.triggerWindowDays);
        vm.expectRevert(SliceBond.TooEarly.selector);
        bond.checkTrigger();
        _day(1 + t.triggerWindowDays);
        uint256 firstCheck = vm.getBlockTimestamp();
        vm.warp(firstCheck - 1);
        vm.expectRevert(SliceBond.TooEarly.selector);
        bond.checkTrigger();
        eq(bond.lastTriggerCheckDay(), 0);
        vm.warp(firstCheck);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChanged(true);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChecked(0, true);
        bond.checkTrigger();
        eq(bond.lastTriggerCheckDay(), firstCheck / 1 days);
    }

    function testFuzzActivationDayRevenueNeverCounted(uint16 beforeActivation, uint16 afterActivation, bool watched)
        public
    {
        uint256 beforeRevenue = uint256(beforeActivation) % 1000 + 10;
        uint256 afterRevenue = uint256(afterActivation) % 1000 + 10;
        _pay(beforeRevenue, 0); // passthrough history on the activation day
        vm.warp(vm.getBlockTimestamp() + 1);
        _activate(watched);
        vm.warp(vm.getBlockTimestamp() + 1);
        _pay(afterRevenue, 3); // same day's active revenue must also be excluded
        eq(account.revenueByDay(uint256(bond.activationTime()) / 1 days), beforeRevenue + afterRevenue);
        _day(1);
        _pay(3, 1);
        _day(2);
        _pay(4, 2);
        _day(3);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChanged(true);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChecked(7, true);
        bond.checkTrigger();
        yes(bond.triggered());
        _day(4);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChecked(4, true);
        bond.checkTrigger();
        yes(bond.triggered());
    }

    function testLowRevenueStepsUpWithExactCarryAndRecovery() public {
        _activate(false);
        _pay(3, 1); // 0 paid, 7500 carry at 25%
        _day(3);
        bond.checkTrigger();
        eq(bond.baseRevenueBps(), 2500);
        eq(bond.terms().revenueBps, 2500);
        eq(bond.revenueBps(), 4000);
        _pay(3, 1); // 1 paid, 9500 carry at 40%
        eq(bond.totalRevenueCollected(), 1);
        eq(account.issuerCredit(), 5);
        eq(account.splitRemainder(), 9500);
        _pay(7, 3); // 3 more paid, 7500 carry; today's revenue is exactly the threshold
        eq(bond.totalRevenueCollected(), 4);
        _day(4);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChanged(false);
        vm.expectEmit(false, false, false, true, address(bond));
        emit TriggerChecked(10, false);
        bond.checkTrigger();
        eq(bond.revenueBps(), 2500);
        _pay(1, 2); // carry preserved through recovery: 7500 + 2500 pays 1
        eq(bond.totalRevenueCollected(), 5);
        eq(account.issuerCredit(), 9);
        eq(account.splitRemainder(), 0);
        eq(bond.effectiveRevenueCap(), 60e6);
        eq(bond.remainingRevenueCap(), 60e6 - 5);
    }

    function testOncePerUtcDayAndOnlyChangesEmitChanged() public {
        _activate(false);
        _day(3);
        bond.checkTrigger();
        vm.warp(vm.getBlockTimestamp() + 1 days - 1);
        vm.expectRevert(SliceBond.AlreadyCheckedToday.selector);
        bond.checkTrigger();
        _day(4);
        vm.recordLogs();
        bond.checkTrigger();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        eq(logs.length, 1);
        yes(logs[0].topics[0] == keccak256("TriggerChecked(uint256,bool)"));
        (uint256 revenue, bool state) = abi.decode(logs[0].data, (uint256, bool));
        eq(revenue, 0);
        yes(state);
        eq(bond.lastTriggerCheckDay(), 104);
    }

    function testCurrentPartialDayExcludedAndNoAutomaticPaymentEvaluation() public {
        _activate(false);
        _day(3);
        _pay(10, 3);
        yes(!bond.triggered());
        eq(bond.totalRevenueCollected(), 2); // still base until checked
        bond.checkTrigger(); // current day's ten units do not count
        yes(bond.triggered());
        _day(4);
        bond.checkTrigger();
        yes(!bond.triggered());
    }

    function testWatchedTriggerAndDefaultFreeze() public {
        _activate(true);
        _day(3);
        bond.checkTrigger();
        _pay(10, 3);
        eq(bond.totalRevenueCollected(), 4);
        vm.prank(address(covenant));
        bond.markDefault(keccak256("default"));
        _day(4);
        vm.expectRevert(SliceBond.InvalidState.selector);
        bond.checkTrigger();
        yes(bond.triggered());
        eq(bond.revenueBps(), 4000);
    }

    function testFundingAndCancelledCannotCheck() public {
        _create(false);
        vm.expectRevert(SliceBond.InvalidState.selector);
        bond.checkTrigger();
        vm.warp(t.fundingDeadline);
        account.cancelFunding(address(bond));
        vm.expectRevert(SliceBond.InvalidState.selector);
        bond.checkTrigger();
    }

    function testClosingAndClosedCannotCheck() public {
        _activate(true);
        vm.warp(t.maturity);
        account.closeBondAtMaturity(address(bond));
        vm.expectRevert(SliceBond.InvalidState.selector);
        bond.checkTrigger();
        vm.warp(bond.settleAfter());
        bond.finalizeSettlement();
        vm.expectRevert(SliceBond.InvalidState.selector);
        bond.checkTrigger();
    }

    function testSteppedUpCapClosesAtExactAmount() public {
        _activate(false);
        _pay(3, 1); // retain fractional carry across the trigger
        _day(3);
        bond.checkTrigger();
        _pay(150e6 - 2, 3); // 59,999,999 with 9500 carry, just below the cap
        eq(bond.totalRevenueCollected(), 60e6 - 1);
        eq(bond.remainingRevenueCap(), 1);
        eq(uint256(bond.phase()), uint256(SliceTypes.Phase.Active));
        _pay(100, 2); // candidate 40; pay only the final unit
        eq(bond.totalRevenueCollected(), 60e6);
        eq(bond.remainingRevenueCap(), 0);
        eq(bond.effectiveRevenueCap(), 60e6);
        eq(account.issuerCredit(), 90e6 + 101);
        eq(account.activeBond(), address(0));
        eq(account.splitRemainder(), 0);
        eq(uint256(bond.phase()), uint256(SliceTypes.Phase.Closed));
        eq(uint256(bond.closeReason()), uint256(SliceTypes.CloseReason.RevenueCap));
        _pay(5, 0);
        eq(account.issuerCredit(), 90e6 + 106);
    }

    function testFuzzPaymentsUseEffectiveShare(uint256 seed, bool watched) public {
        t.triggerWindowDays = 1;
        t.triggerRevenue = 4e6;
        _activate(watched);
        uint256 weighted;
        uint256 total;
        uint256 yesterday;
        for (uint256 i; i < 12; ++i) {
            if (i > 0) _day(i);
            if (i > 1) {
                bond.checkTrigger();
                yes(bond.triggered() == (yesterday < t.triggerRevenue));
            }
            uint256 rate = i > 1 && yesterday < t.triggerRevenue ? 4000 : 2500;
            uint256 amount = uint256(keccak256(abi.encode(seed, i))) % 10e6 + 1;
            _pay(amount, uint8(i));
            weighted += amount * rate;
            total += amount;
            eq(bond.revenueBps(), rate);
            eq(bond.totalRevenueCollected(), weighted / 10_000);
            eq(account.splitRemainder(), weighted % 10_000);
            eq(account.issuerCredit(), total - weighted / 10_000);
            eq(asset.balanceOf(address(bond)), bond.accountedBalance());
            yesterday = amount;
        }
    }
}
