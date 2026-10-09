// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./TestBase.sol";
import {SliceTypes} from "../src/SliceTypes.sol";
import {SliceBond} from "../src/SliceBond.sol";
import {SliceAccount} from "../src/SliceAccount.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {PumpLab} from "../src/PumpLab.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Native tier: revenue history from day one, proven payers, passthrough -> credit -> passthrough.
contract NativeTest is TestBase {
    MockUSDC asset;
    SliceFactory factory;
    SliceAccount account;
    PumpLab lab;
    SliceBond bond;
    address issuer = address(0x111);
    address investor = address(0x222);
    uint256 constant TRADER_PK = 0xA11CE;
    address trader;
    SliceTypes.Terms t;

    function setUp() public {
        vm.warp(1_800_000);
        vm.chainId(31337);
        trader = vm.addr(TRADER_PK);
        asset = new MockUSDC();
        SliceCovenant covenant = new SliceCovenant(address(0x444), vm.addr(12345));
        factory = new SliceFactory(
            address(asset), address(covenant), vm.addr(67890), address(new SliceBond()), address(new SliceAccount())
        );
        covenant.initializeFactory(address(factory));
        asset.mint(issuer, 1_000e6);
        asset.mint(investor, 1_000e6);
        asset.mint(trader, 100_000e6);
        vm.startPrank(issuer);
        account = SliceAccount(factory.createAccount());
        lab = PumpLab(factory.createNativeLaunchpad(address(account), "Lab", "LAB"));
        asset.approve(address(factory), type(uint256).max);
        vm.stopPrank();
        // Traders approve the account, not the launchpad: the account is the payment entrypoint.
        vm.prank(trader);
        asset.approve(address(account), type(uint256).max);
        uint64 now_ = uint64(vm.getBlockTimestamp());
        t = SliceTypes.Terms(
            100e6,
            120e6,
            0,
            5e6,
            now_ + 120,
            now_ + 2000,
            now_ + 150,
            now_ + 1500,
            60,
            2000,
            5000,
            SliceTypes.MilestoneMode.Onchain
        );
    }

    function _buy(uint256 gross) internal {
        vm.prank(trader);
        lab.buy(gross, 0, uint64(vm.getBlockTimestamp() + 60));
    }

    function _bond() internal {
        vm.prank(issuer);
        bond = SliceBond(
            factory.createBond(
                address(account),
                t,
                SliceTypes.AdapterConfig(SliceTypes.Adapter.Native, address(lab), address(0), keccak256("native")),
                "Lab Revenue Claim",
                "LAB-RC"
            )
        );
        vm.startPrank(investor);
        asset.approve(address(bond), t.raiseAmount);
        bond.deposit(t.raiseAmount);
        vm.stopPrank();
        vm.prank(issuer);
        factory.activate(address(bond));
    }

    function testHistoryAccruesFromDayOneInPassthrough() public {
        _buy(100e6);
        _buy(50e6);
        // 1% fee on each buy; no bond yet, so all of it is the business's.
        eq(account.cumulativeRevenue(), 1.5e6);
        eq(account.paymentCount(), 2);
        eq(account.collectedCount(), 2);
        eq(account.uniquePayers(), 1);
        yes(account.isPayer(trader));
        eq(account.issuerCredit(), 1.5e6);
        eq(account.revenueByDay(vm.getBlockTimestamp() / 1 days), 1.5e6);
        eq(asset.balanceOf(address(lab)), 148.5e6); // the net stays with the launchpad
    }

    function testOnlyTheBoundProjectCanPull() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(SliceAccount.Unauthorized.selector);
        account.collect(trader, 10e6, 10e6);
        vm.prank(issuer);
        vm.expectRevert(SliceAccount.InvalidState.selector);
        account.bindProject(address(this)); // binding is one-time
    }

    function testPermitBuyNeedsNoStandingApproval() public {
        vm.prank(trader);
        asset.approve(address(account), 0);
        uint256 gross = 10e6;
        uint256 deadline = vm.getBlockTimestamp() + 600;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                trader,
                address(account),
                gross,
                asset.nonces(trader),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", asset.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRADER_PK, digest);
        vm.prank(trader);
        lab.buyWithPermit(gross, 0, uint64(deadline), deadline, v, r, s);
        eq(account.cumulativeRevenue(), 0.1e6);
        eq(asset.allowance(trader, address(account)), 0);
    }

    function testCreditModeSplitsEachFeeImmediately() public {
        _buy(100e6); // pre-bond history
        _bond();
        _buy(100e6); // fee 1 USDC: 20% to the bond in the same transaction, no keeper
        eq(bond.totalRevenueCollected(), 0.2e6);
        eq(bond.pool(), 0.2e6);
        eq(account.issuerCredit(), 1e6 + 0.8e6);
        eq(account.cumulativeRevenue(), 2e6);
        eq(bond.revenueSnapshot(), 1e6);
    }

    function testSellFeeIsPaidByTheTrader() public {
        _buy(100e6);
        address token = address(lab.token());
        uint256 held = _balance(token, trader);
        uint256 before = asset.balanceOf(trader);
        vm.startPrank(trader);
        (bool ok,) = token.call(abi.encodeWithSignature("approve(address,uint256)", address(lab), held));
        yes(ok);
        uint256 net = lab.sell(held / 2, 0, uint64(vm.getBlockTimestamp() + 60));
        vm.stopPrank();
        eq(asset.balanceOf(trader) - before, net);
        eq(account.paymentCount(), 2);
    }

    function testOnchainMilestoneReleasesOnlyAfterRevenueAndTime() public {
        _bond();
        vm.warp(t.secondReleaseNotBefore);
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.InvalidMilestone.selector);
        factory.releaseSecond(address(bond)); // no revenue yet
        for (uint256 i; i < 5; i++) {
            _buy(100e6); // 5 USDC of fees since activation
        }
        vm.prank(issuer);
        factory.releaseSecond(address(bond));
        eq(bond.undrawnPrincipal(), 0);
        eq(bond.releasedPrincipal(), 100e6);
    }

    function testSignedModeRejectsOnchainRelease() public {
        t.milestoneMode = SliceTypes.MilestoneMode.Signed;
        _bond();
        for (uint256 i; i < 6; i++) {
            _buy(100e6);
        }
        vm.warp(t.secondReleaseNotBefore);
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.InvalidMilestone.selector);
        factory.releaseSecond(address(bond));
    }

    function testBackToPassthroughAfterTheCap() public {
        t.repayCap = 100e6; // cap after the 50% first release: 50 USDC
        t.revenueBps = 5000; // investors take 50% of fees, so 100 USDC of fees fills the cap
        _bond();
        vm.prank(trader);
        lab.buy(10_000e6, 0, uint64(vm.getBlockTimestamp() + 60)); // 100 USDC fee
        eq(uint256(bond.phase()), uint256(SliceTypes.Phase.Closed));
        eq(account.activeBond(), address(0));
        eq(bond.totalRevenueCollected(), 50e6);
        uint256 credit = account.issuerCredit();
        _buy(100e6);
        eq(account.issuerCredit() - credit, 1e6); // 100% to the business again
        eq(bond.totalRevenueCollected(), 50e6);
    }

    function testNativeBondRequiresTheBoundLaunchpad() public {
        vm.prank(issuer);
        vm.expectRevert(SliceFactory.InvalidAdapter.selector);
        factory.createBond(
            address(account),
            t,
            SliceTypes.AdapterConfig(SliceTypes.Adapter.Native, address(0xBEEF), address(0), keccak256("x")),
            "X",
            "X-RC"
        );
    }

    function _balance(address token, address who) internal view returns (uint256 b) {
        (, bytes memory r) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", who));
        b = abi.decode(r, (uint256));
    }
}
