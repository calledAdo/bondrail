// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./TestBase.sol";
import {SliceTypes} from "../src/SliceTypes.sol";
import {SliceAccount} from "../src/SliceAccount.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {SliceBond} from "../src/SliceBond.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {MockERC3009} from "./mocks/MockERC3009.sol";
import {MockEarner} from "./mocks/MockEarner.sol";

// A token that short-delivers an otherwise valid authorized payment.
contract ShortERC3009 is MockERC3009 {
    function _update(address from, address to, uint256 amount) internal override {
        super._update(from, to, from == address(0) ? amount : amount - 1);
    }
}

contract SettleTest is TestBase {
    uint256 constant PAYER_PK = 0xA11CE;
    MockERC3009 asset;
    SliceAccount account;
    SliceFactory factory;
    SliceBond bond;
    address payer;
    uint256 deadline;

    function setUp() public {
        vm.warp(1_800_000);
        payer = vm.addr(PAYER_PK);
        deadline = vm.getBlockTimestamp() + 300;
        asset = new MockERC3009();
        SliceCovenant c = new SliceCovenant(address(0x444), vm.addr(12345));
        factory = new SliceFactory(
            address(c), vm.addr(67890), address(new SliceBond()), address(new SliceAccount()), address(this), 0
        );
        c.initializeFactory(address(factory));
        account = SliceAccount(factory.createAccount(address(asset)));
        asset.mint(payer, 10_000e6);
    }

    function signature(address to, uint256 value, bytes32 nonce) internal returns (uint8, bytes32, bytes32) {
        return vm.sign(PAYER_PK, asset.hashAuthorization(payer, to, value, 0, deadline, nonce));
    }

    function pay(uint256 value, uint256 nonce) internal {
        (uint8 v, bytes32 r, bytes32 s) = signature(address(account), value, bytes32(nonce));
        vm.prank(address(0xFAC)); // anyone can relay; no approval or bound project needed
        account.settle(payer, value, 0, deadline, bytes32(nonce), v, r, s);
    }

    function activate() internal {
        MockEarner project = new MockEarner(address(account));
        account.bindProject(address(project));
        factory.setNativeApproval(address(project), true);
        uint64 now_ = uint64(vm.getBlockTimestamp());
        SliceTypes.Terms memory t = SliceTypes.Terms(
            100e6,
            100e6,
            0,
            1e6,
            now_ + 120,
            now_ + 2000,
            now_ + 150,
            now_ + 1500,
            60,
            2000,
            5000,
            SliceTypes.MilestoneMode.Onchain,
            10_000
        );
        bond = SliceBond(
            factory.createBond(
                address(account),
                t,
                SliceTypes.AdapterConfig(SliceTypes.Adapter.Native, address(project), keccak256("native")),
                "Claim",
                "RC"
            )
        );
        asset.mint(address(this), 100e6);
        asset.approve(address(bond), 100e6);
        bond.deposit(100e6);
        factory.activate(address(bond));
    }

    function testPassthroughProvesPayerAndCountsEachPayment() public {
        pay(7e6, 1);
        pay(3e6, 2);
        eq(account.issuerCredit(), 10e6);
        eq(account.cumulativeRevenue(), 10e6);
        eq(account.cumulativeVolume(), 10e6);
        eq(account.paymentCount(), 2);
        eq(account.collectedCount(), 2);
        eq(account.uniquePayers(), 1);
        yes(account.isPayer(payer));
        eq(asset.allowance(payer, address(account)), 0);
        uint256 otherPk = 0xB0B;
        address other = vm.addr(otherPk);
        asset.mint(other, 1);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(otherPk, asset.hashAuthorization(other, address(account), 1, 0, deadline, bytes32(uint256(1))));
        account.settle(other, 1, 0, deadline, bytes32(uint256(1)), v, r, s);
        eq(account.uniquePayers(), 2);
        eq(account.collectedCount(), 3);
        eq(account.revenueByDay(vm.getBlockTimestamp() / 1 days), 10e6 + 1);
    }

    function testNativeActiveSplitAndRoundingCarry() public {
        activate(); // even a bound Native account with a 100% fee floor accepts settle
        pay(3, 1);
        eq(bond.totalRevenueCollected(), 0);
        eq(account.splitRemainder(), 6000);
        pay(3, 2);
        eq(bond.totalRevenueCollected(), 1);
        eq(asset.balanceOf(address(bond)), bond.accountedBalance());
        eq(account.issuerCredit(), 5);
        eq(account.splitRemainder(), 2000);
        eq(account.cumulativeVolume(), 6);
    }

    function testReplayRevertsWithoutBookingTwice() public {
        pay(10, 1);
        (uint8 v, bytes32 r, bytes32 s) = signature(address(account), 10, bytes32(uint256(1)));
        vm.expectRevert(bytes("authorization used"));
        account.settle(payer, 10, 0, deadline, bytes32(uint256(1)), v, r, s);
        eq(account.paymentCount(), 1);
        eq(account.issuerCredit(), 10);
    }

    function testWrongSignedRecipientReverts() public {
        (uint8 v, bytes32 r, bytes32 s) = signature(address(0xBAD), 10, bytes32(uint256(1)));
        vm.expectRevert(bytes("signature"));
        account.settle(payer, 10, 0, deadline, bytes32(uint256(1)), v, r, s);
        eq(account.paymentCount(), 0);
    }

    function testZeroValueReverts() public {
        vm.expectRevert(SliceAccount.InvalidAmount.selector);
        account.settle(payer, 0, 0, deadline, bytes32(0), 27, bytes32(0), bytes32(0));
    }

    function testZeroPayerReverts() public {
        vm.expectRevert(SliceAccount.InvalidAmount.selector);
        account.settle(address(0), 1, 0, deadline, bytes32(0), 27, bytes32(0), bytes32(0));
    }

    function testSelfPayerReverts() public {
        vm.expectRevert(SliceAccount.InvalidAmount.selector);
        account.settle(address(account), 1, 0, deadline, bytes32(0), 27, bytes32(0), bytes32(0));
    }

    function testPreExistingBalanceOnlyBookedBySweep() public {
        activate();
        asset.mint(address(account), 100);
        pay(10, 1);
        eq(account.cumulativeRevenue(), 10);
        eq(account.issuerCredit(), 8);
        eq(bond.totalRevenueCollected(), 2);
        account.sweep();
        eq(account.cumulativeRevenue(), 110);
        eq(account.issuerCredit(), 88);
        eq(bond.totalRevenueCollected(), 22);
        eq(account.collectedCount(), 1);
        eq(account.cumulativeVolume(), 10);
    }

    function testCapClosesBondInSettlementTransaction() public {
        activate();
        pay(300e6, 1); // candidate 60; effective cap is 50 after first release
        eq(bond.totalRevenueCollected(), 50e6);
        eq(uint256(bond.phase()), uint256(SliceTypes.Phase.Closed));
        eq(account.activeBond(), address(0));
        eq(account.issuerCredit(), 250e6);
        eq(account.splitRemainder(), 0);
        pay(1e6, 2);
        eq(account.issuerCredit(), 251e6);
    }

    function testDirectTokenFrontRunLeavesOnlySweepableFunds() public {
        (uint8 v, bytes32 r, bytes32 s) = signature(address(account), 10, bytes32(uint256(1)));
        asset.transferWithAuthorization(payer, address(account), 10, 0, deadline, bytes32(uint256(1)), v, r, s);
        vm.expectRevert(bytes("authorization used"));
        account.settle(payer, 10, 0, deadline, bytes32(uint256(1)), v, r, s);
        eq(account.cumulativeRevenue(), 0);
        account.sweep();
        eq(account.cumulativeRevenue(), 10);
        eq(account.collectedCount(), 0);
        eq(account.uniquePayers(), 0);
    }

    function testExpiredAuthorizationReverts() public {
        (uint8 v, bytes32 r, bytes32 s) = signature(address(account), 10, bytes32(uint256(1)));
        vm.warp(deadline);
        vm.expectRevert(bytes("authorization window"));
        account.settle(payer, 10, 0, deadline, bytes32(uint256(1)), v, r, s);
    }

    function testNotYetValidAuthorizationReverts() public {
        uint256 after_ = vm.getBlockTimestamp();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            PAYER_PK, asset.hashAuthorization(payer, address(account), 10, after_, deadline, bytes32(uint256(1)))
        );
        vm.expectRevert(bytes("authorization window"));
        account.settle(payer, 10, after_, deadline, bytes32(uint256(1)), v, r, s);
    }

    function testShortTransferRollsBackAuthorizationAndAccounting() public {
        asset = new ShortERC3009();
        account = SliceAccount(factory.createAccount(address(asset)));
        asset.mint(payer, 100);
        (uint8 v, bytes32 r, bytes32 s) = signature(address(account), 10, bytes32(uint256(1)));
        vm.expectRevert(SliceAccount.InvalidAmount.selector);
        account.settle(payer, 10, 0, deadline, bytes32(uint256(1)), v, r, s);
        eq(account.paymentCount(), 0);
        eq(asset.balanceOf(address(account)), 0);
        yes(!asset.authorizationState(payer, bytes32(uint256(1))));
    }
}
