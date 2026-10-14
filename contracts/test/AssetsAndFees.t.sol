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
import {MockToken18} from "./mocks/MockToken18.sol";
import {MockEarner} from "./mocks/MockEarner.sol";

/// @notice Per-account assets, money out through the account (settleOut), volume history and the fee floor.
contract AssetsAndFeesTest is TestBase {
    MockUSDC usdc;
    MockToken18 weth;
    BondrailFactory factory;
    address issuer = address(0x111);
    address investor = address(0x222);
    address payer = address(0x333);
    address constant REVIEWER = address(0x777);

    function setUp() public {
        vm.warp(1_800_000);
        usdc = new MockUSDC();
        weth = new MockToken18();
        BondrailCovenant covenant = new BondrailCovenant(address(0x444), vm.addr(12345));
        factory = new BondrailFactory(
            address(covenant), vm.addr(67890), address(new BondrailBond()), address(new BondrailAccount()), REVIEWER, 0
        );
        covenant.initializeFactory(address(factory));
    }

    function _terms(uint256 unit, uint16 minFeeBps) internal view returns (BondrailTypes.Terms memory) {
        uint64 n = uint64(vm.getBlockTimestamp());
        return BondrailTypes.Terms(
            100 * unit,
            120 * unit,
            0,
            unit,
            n + 120,
            n + 2000,
            n + 150,
            n + 1500,
            60,
            2000,
            5000,
            BondrailTypes.MilestoneMode.Onchain,
            minFeeBps,
            0,
            0,
            0
        );
    }

    /// Account + bound, reviewed MockEarner in `asset`.
    function _native(address asset) internal returns (BondrailAccount account, MockEarner earner) {
        vm.startPrank(issuer);
        account = BondrailAccount(factory.createAccount(asset));
        earner = new MockEarner(address(account));
        account.bindProject(address(earner));
        vm.stopPrank();
        vm.prank(REVIEWER);
        factory.setNativeApproval(address(earner), true);
    }

    function _bond(BondrailAccount account, address source, BondrailTypes.Terms memory t) internal returns (BondrailBond b) {
        vm.prank(issuer);
        b = BondrailBond(
            factory.createBond(
                address(account),
                t,
                BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Native, source, keccak256("p")),
                "Claim",
                "CLM"
            )
        );
    }

    function _fundAndActivate(BondrailBond b, MockToken18 token, uint256 amount) internal {
        token.mint(investor, amount);
        vm.startPrank(investor);
        token.approve(address(b), amount);
        b.deposit(amount);
        vm.stopPrank();
        vm.prank(issuer);
        factory.activate(address(b));
    }

    function testAnyTokenContractCanBeAnAccountsAsset() public {
        vm.startPrank(issuer);
        eq(address(BondrailAccount(factory.createAccount(address(weth))).asset()), address(weth));
        eq(address(BondrailAccount(factory.createAccount(address(usdc))).asset()), address(usdc));
        vm.expectRevert(BondrailFactory.UnsupportedAsset.selector);
        factory.createAccount(address(0xdead)); // not a contract
        vm.expectRevert();
        factory.createAccount(address(this)); // a contract that is not an ERC-20
        vm.stopPrank();
    }

    function testSellerIsPaidThroughTheAccountWithoutAnyApproval() public {
        vm.startPrank(issuer);
        BondrailAccount account = BondrailAccount(factory.createAccount(address(usdc)));
        PumpLab lab = new PumpLab(address(account), "Lab", "LAB");
        account.bindProject(address(lab));
        vm.stopPrank();
        // A buyer, then a seller who got the token elsewhere and never approved USDC to anyone.
        usdc.mint(payer, 1000e6);
        vm.startPrank(payer);
        usdc.approve(address(account), type(uint256).max);
        uint256 tokens = lab.buy(1000e6, 1, uint64(vm.getBlockTimestamp()));
        lab.token().transfer(investor, tokens);
        vm.stopPrank();
        eq(usdc.allowance(investor, address(account)), 0);
        vm.startPrank(investor);
        lab.token().approve(address(lab), tokens);
        uint256 received = lab.sell(tokens, 0, uint64(vm.getBlockTimestamp()));
        vm.stopPrank();
        eq(usdc.balanceOf(investor), received);
        uint256 sellFee = account.cumulativeRevenue() - 10e6; // the buy's fee was 10 USDC
        yes(sellFee * 100 >= received + sellFee); // at least 1% of the sell's gross proceeds
        eq(account.collectedCount(), 2);
        eq(account.uniquePayers(), 2); // the seller is a proven payer too: the account paid them
        eq(account.cumulativeVolume(), 1000e6 + received + sellFee);
        eq(usdc.balanceOf(address(lab)), lab.realUSDC());
    }

    function testFeeFloorBindsOnlyWhileTheBondIsActive() public {
        (BondrailAccount account, MockEarner earner) = _native(address(weth));
        weth.mint(payer, 1000e18);
        weth.mint(address(earner), 1000e18);
        vm.prank(payer);
        weth.approve(address(account), type(uint256).max);
        vm.prank(payer);
        earner.payIn(10e18, 0); // passthrough: a zero-fee promo is fine, it is just recorded
        BondrailBond b = _bond(account, address(earner), _terms(1e18, 100)); // floor: 1%
        vm.prank(payer);
        earner.payIn(10e18, 0); // still Funding: no floor yet
        _fundAndActivate(b, weth, 100e18);
        vm.prank(payer);
        vm.expectRevert(BondrailAccount.FeeBelowFloor.selector);
        earner.payIn(10e18, 0.09e18); // 0.9% < 1%
        vm.expectRevert(BondrailAccount.FeeBelowFloor.selector);
        earner.payOut(payer, 10e18, 0.09e18);
        vm.prank(payer);
        earner.payIn(10e18, 0.1e18); // exactly 1%
        earner.payOut(payer, 10e18, 0.2e18);
        eq(account.cumulativeVolume(), 40e18);
        eq(b.totalRevenueCollected(), 0.06e18); // 20% of the 0.3 in fees since activation
    }

    function testAccountInAnEighteenDecimalAssetRaisesAndRepaysInIt() public {
        (BondrailAccount account, MockEarner earner) = _native(address(weth));
        BondrailBond b = _bond(account, address(earner), _terms(1e18, 0));
        eq(b.decimals(), 18);
        eq(address(b.asset()), address(weth));
        _fundAndActivate(b, weth, 100e18);
        eq(weth.balanceOf(issuer), 50e18); // first release, in WETH
        weth.mint(address(earner), 100e18);
        earner.payOut(payer, 100e18, 1e18);
        eq(weth.balanceOf(payer), 99e18);
        eq(b.pool(), 0.2e18);
        eq(account.issuerCredit(), 0.8e18);
    }

    function testWatchedBondsTakeNoFeeFloor() public {
        vm.startPrank(issuer);
        BondrailAccount account = BondrailAccount(factory.createAccount(address(usdc)));
        usdc.approve(address(factory), type(uint256).max);
        vm.stopPrank();
        usdc.mint(issuer, 10e6);
        BondrailTypes.Terms memory t = _terms(1e6, 100);
        t.stake = 1e6;
        vm.prank(issuer);
        vm.expectRevert(BondrailFactory.InvalidAdapter.selector);
        factory.createBond(
            address(account),
            t,
            BondrailTypes.AdapterConfig(BondrailTypes.Adapter.Watched, address(0), keccak256("p")),
            "C",
            "C"
        );
    }

    function testDownwardRebaseNeverBricksTheAccount() public {
        (BondrailAccount account, MockEarner earner) = _native(address(weth));
        weth.mint(address(earner), 10e18);
        earner.payOut(payer, 10e18, 1e18); // 1 WETH of fee credited to the issuer
        weth.rebaseDown(address(account), 0.4e18); // balance 0.6 < credit 1.0
        account.sweep(); // books nothing, does not revert
        eq(account.cumulativeRevenue(), 1e18);
        weth.mint(address(earner), 10e18);
        earner.payOut(payer, 10e18, 1e18); // payments still work
        eq(account.cumulativeRevenue(), 2e18);
    }
}
