// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {TestBase} from "./TestBase.sol";
import {BondrailTypes} from "../src/BondrailTypes.sol";
import {BondrailBond} from "../src/BondrailBond.sol";
import {BondrailAccount} from "../src/BondrailAccount.sol";
import {BondrailFactory} from "../src/BondrailFactory.sol";
import {BondrailCovenant} from "../src/BondrailCovenant.sol";
import {PumpLab} from "@bondrail-demo/PumpLab.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @notice Native tier: revenue history from day one, proven payers, passthrough -> credit -> passthrough.
contract NativeTest is TestBase {
    MockUSDC asset;
    BondrailFactory factory;
    BondrailAccount account;
    PumpLab lab;
    BondrailBond bond;
    address issuer = address(0x111);
    address investor = address(0x222);
    address constant REVIEWER = address(0x777);
    uint256 constant TRADER_PK = 0xA11CE;
    address trader;
    BondrailTypes.Terms t;

    function setUp() public {
        vm.warp(1_800_000);
        vm.chainId(31337);
        trader = vm.addr(TRADER_PK);
        asset = new MockUSDC();
        BondrailCovenant covenant = new BondrailCovenant(address(0x444), vm.addr(12345));
        factory = new BondrailFactory(
            address(covenant), vm.addr(67890), address(new BondrailBond()), address(new BondrailAccount()), REVIEWER, 0
        );
        covenant.initializeFactory(address(factory));
        asset.mint(issuer, 1_000e6);
        asset.mint(investor, 1_000e6);
        asset.mint(trader, 100_000e6);
        vm.startPrank(issuer);
        account = BondrailAccount(factory.createAccount(address(asset)));
        // The project deploys itself on top of BondrailEarner, pointed at its account, then binds it.
        lab = new PumpLab(address(account), "Lab", "LAB");
        account.bindProject(address(lab));
        asset.approve(address(factory), type(uint256).max);
        vm.stopPrank();
        vm.prank(REVIEWER);
        factory.setNativeApproval(address(lab), true);
        // Traders approve the account, not the launchpad: the account is the payment entrypoint.
        vm.prank(trader);
        asset.approve(address(account), type(uint256).max);
        uint64 now_ = uint64(vm.getBlockTimestamp());
        t = BondrailTypes.Terms(
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
            BondrailTypes.MilestoneMode.Onchain,
            0,
            0,
            0,
            0
        );
    }

    function _buy(uint256 gross) internal {
        vm.prank(trader);
        lab.buy(gross, 0, uint64(vm.getBlockTimestamp() + 60));
    }

    function _bond() internal {
        vm.prank(issuer);
        bond = BondrailBond(
            factory.createBond(
                address(account),
                t,
                BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Native, address(lab), keccak256("native")),
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
        vm.expectRevert(BondrailAccount.Unauthorized.selector);
        account.collect(trader, 10e6, 10e6);
        vm.prank(issuer);
        vm.expectRevert(BondrailAccount.InvalidState.selector);
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
        vm.expectRevert(BondrailFactory.InvalidMilestone.selector);
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
        t.milestoneMode = BondrailTypes.MilestoneMode.Signed;
        _bond();
        for (uint256 i; i < 6; i++) {
            _buy(100e6);
        }
        vm.warp(t.secondReleaseNotBefore);
        vm.prank(issuer);
        vm.expectRevert(BondrailFactory.InvalidMilestone.selector);
        factory.releaseSecond(address(bond));
    }

    function testBackToPassthroughAfterTheCap() public {
        t.repayCap = 100e6; // cap after the 50% first release: 50 USDC
        t.revenueBps = 5000; // investors take 50% of fees, so 100 USDC of fees fills the cap
        _bond();
        vm.prank(trader);
        lab.buy(10_000e6, 0, uint64(vm.getBlockTimestamp() + 60)); // 100 USDC fee
        eq(uint256(bond.phase()), uint256(BondrailTypes.Phase.Closed));
        eq(account.activeBond(), address(0));
        eq(bond.totalRevenueCollected(), 50e6);
        uint256 credit = account.issuerCredit();
        _buy(100e6);
        eq(account.issuerCredit() - credit, 1e6); // 100% to the business again
        eq(bond.totalRevenueCollected(), 50e6);
    }

    function testNativeBondRequiresTheBoundLaunchpad() public {
        vm.prank(issuer);
        vm.expectRevert(BondrailFactory.InvalidAdapter.selector);
        factory.createBond(
            address(account),
            t,
            BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Native, address(0xBEEF), keccak256("x")),
            "X",
            "X-RC"
        );
    }

    function testUnreviewedProjectBuildsHistoryButCannotRaise() public {
        vm.prank(REVIEWER);
        factory.setNativeApproval(address(lab), false);
        _buy(100e6);
        eq(account.cumulativeRevenue(), 1e6); // history accrues regardless of review
        vm.prank(issuer);
        vm.expectRevert(BondrailFactory.InvalidAdapter.selector);
        factory.createBond(
            address(account),
            t,
            BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Native, address(lab), keccak256("native")),
            "Lab Revenue Claim",
            "LAB-RC"
        );
    }

    function testOnlyTheReviewerApproves() public {
        vm.prank(issuer);
        vm.expectRevert(BondrailFactory.Unauthorized.selector);
        factory.setNativeApproval(address(lab), true);
    }

    function testAccountRefusesAProjectThatDoesNotPointAtIt() public {
        vm.startPrank(issuer);
        BondrailAccount other = BondrailAccount(factory.createAccount(address(asset)));
        PumpLab stranger = new PumpLab(address(account), "X", "X"); // points at another account
        vm.expectRevert(BondrailAccount.InvalidState.selector);
        other.bindProject(address(stranger));
        vm.stopPrank();
    }

    // ---- withdrawing during the raise

    function _openBond() internal {
        vm.prank(issuer);
        bond = BondrailBond(
            factory.createBond(
                address(account),
                t,
                BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Native, address(lab), keccak256("native")),
                "Lab Revenue Claim",
                "LAB-RC"
            )
        );
        vm.prank(investor);
        asset.approve(address(bond), type(uint256).max);
    }

    function testInvestorWithdrawsDuringFundingAndActivationNeedsTheGapFilled() public {
        _openBond();
        uint256 before = asset.balanceOf(investor);
        vm.startPrank(investor);
        bond.deposit(t.raiseAmount);
        bond.withdraw(30e6, investor);
        vm.stopPrank();
        eq(asset.balanceOf(investor), before - t.raiseAmount + 30e6);
        eq(bond.balanceOf(investor), t.raiseAmount - 30e6);
        eq(bond.fundingEscrow(), t.raiseAmount - 30e6);
        vm.prank(issuer);
        vm.expectRevert();
        factory.activate(address(bond)); // no longer fully funded
        vm.prank(investor);
        bond.deposit(30e6);
        vm.prank(issuer);
        factory.activate(address(bond));
        vm.prank(investor);
        vm.expectRevert(BondrailBond.InvalidState.selector);
        bond.withdraw(1e6, investor); // the raise has closed
    }

    function testNoWithdrawAfterTheDeadlineOnlyRefund() public {
        _openBond();
        vm.prank(investor);
        bond.deposit(10e6);
        vm.warp(t.fundingDeadline);
        vm.prank(investor);
        vm.expectRevert(BondrailBond.InvalidState.selector);
        bond.withdraw(10e6, investor);
        account.cancelFunding(address(bond));
        vm.prank(investor);
        bond.refund(10e6, investor);
        eq(bond.balanceOf(investor), 0);
    }

    function testCannotWithdrawMoreThanHeld() public {
        _openBond();
        vm.prank(investor);
        bond.deposit(10e6);
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        bond.withdraw(10e6, address(0xBEEF));
    }

    // ---- reviewed templates: one review, any issuer, no per-project approval

    function _template() internal returns (BondrailAccount fresh, bytes memory code, bytes memory args) {
        code = type(PumpLab).creationCode;
        vm.prank(REVIEWER);
        factory.setNativeTemplate(keccak256(code), true);
        vm.prank(issuer);
        fresh = BondrailAccount(factory.createAccount(address(asset)));
        args = abi.encode(address(fresh), "Tpl", "TPL");
    }

    function testTemplateDeployBindsAndQualifiesWithoutReview() public {
        (BondrailAccount fresh, bytes memory code, bytes memory args) = _template();
        vm.prank(issuer);
        address project = factory.deployNative(address(fresh), code, args, bytes32(0));
        eq(uint256(uint160(fresh.project())), uint256(uint160(project)));
        yes(!factory.nativeApproved(project)); // never individually reviewed
        vm.prank(issuer);
        factory.createBond(
            address(fresh),
            t,
            BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Native, project, keccak256("native")),
            "Tpl Revenue Claim",
            "TPL-RC"
        );
    }

    function testTemplateRevocationBlocksItsProjects() public {
        (BondrailAccount fresh, bytes memory code, bytes memory args) = _template();
        vm.prank(issuer);
        address project = factory.deployNative(address(fresh), code, args, bytes32(0));
        vm.prank(REVIEWER);
        factory.setNativeTemplate(keccak256(code), false);
        vm.prank(issuer);
        vm.expectRevert(BondrailFactory.InvalidAdapter.selector);
        factory.createBond(
            address(fresh),
            t,
            BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Native, project, keccak256("native")),
            "Tpl Revenue Claim",
            "TPL-RC"
        );
    }

    function testTemplateRejectsUnreviewedCodeOtherAccountsAndStrangers() public {
        (BondrailAccount fresh, bytes memory code, bytes memory args) = _template();
        vm.startPrank(issuer);
        vm.expectRevert(BondrailFactory.InvalidAdapter.selector);
        factory.deployNative(address(fresh), bytes.concat(code, hex"00"), args, bytes32(0)); // not reviewed
        vm.expectRevert(BondrailFactory.InvalidAdapter.selector);
        factory.deployNative(address(fresh), code, abi.encode(address(account), "X", "X"), bytes32(0)); // wrong account
        vm.stopPrank();
        vm.prank(address(0xBAD));
        vm.expectRevert(BondrailFactory.Unauthorized.selector);
        factory.deployNative(address(fresh), code, args, bytes32(0)); // not the issuer
        vm.prank(address(0xBAD));
        vm.expectRevert(BondrailAccount.Unauthorized.selector);
        fresh.bindProjectFromFactory(address(lab));
    }

    function testTemplateCannotRebindAnAccount() public {
        (, bytes memory code,) = _template();
        vm.prank(issuer);
        vm.expectRevert(BondrailAccount.InvalidState.selector);
        factory.deployNative(address(account), code, abi.encode(address(account), "Y", "Y"), bytes32(0)); // already bound
    }

    function _balance(address token, address who) internal view returns (uint256 b) {
        (, bytes memory r) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", who));
        b = abi.decode(r, (uint256));
    }
}
