// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {NativeProject} from "../src/NativeProject.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {BondrailAccount} from "@bondrail/contracts/src/BondrailAccount.sol";
import {BondrailBond} from "@bondrail/contracts/src/BondrailBond.sol";
import {BondrailFactory} from "@bondrail/contracts/src/BondrailFactory.sol";
import {BondrailCovenant} from "@bondrail/contracts/src/BondrailCovenant.sol";
import {BondrailCreditRegistry} from "@bondrail/contracts/src/BondrailCreditRegistry.sol";
import {BondrailVault} from "@bondrail/contracts/src/BondrailVault.sol";
import {BondrailTypes} from "@bondrail/contracts/src/BondrailTypes.sol";
import {IBondrailCreditRegistry} from "@bondrail/contracts/src/IBondrailCreditRegistry.sol";
import {IBondrailVault} from "@bondrail/contracts/src/IBondrailVault.sol";

interface Vm {
    function prank(address) external;
    function expectRevert(bytes4) external;
}

contract TestAsset is ERC20 {
    constructor() ERC20("Local asset", "LOCAL") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

contract NativeProjectTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    TestAsset asset;
    BondrailFactory factory;
    BondrailAccount account;
    NativeProject project;
    address constant PAYER = address(0xBEEF);

    function setUp() public {
        asset = new TestAsset();
        BondrailCovenant covenant = new BondrailCovenant(address(this), address(this));
        factory = new BondrailFactory(address(covenant), address(this), address(new BondrailBond()),
            address(new BondrailAccount()), address(this), 0);
        covenant.initializeFactory(address(factory));
        account = BondrailAccount(factory.createAccount(address(asset)));
        project = new NativeProject(address(account));
        account.bindProject(address(project));
        asset.mint(PAYER, 200e6);
        vm.prank(PAYER);
        asset.approve(address(account), type(uint256).max);
    }

    function testCollectBeforeAndDuringReviewedRaise() public {
        vm.prank(PAYER);
        require(project.pay(10e6) == 9_900_000, "net before raise");
        require(account.cumulativeRevenue() == 100_000, "fee booked");
        require(account.issuerCredit() == 100_000, "passthrough credit");
        require(account.isPayer(PAYER), "proven payer");

        BondrailTypes.Terms memory t;
        t.raiseAmount = 100e6;
        t.repayCap = 120e6;
        t.minRevenue = 1e6;
        t.fundingDeadline = uint64(block.timestamp + 120);
        t.maturity = uint64(block.timestamp + 2000);
        t.secondReleaseNotBefore = uint64(block.timestamp + 150);
        t.secondReleaseDeadline = uint64(block.timestamp + 1500);
        t.minOperatingPeriod = 60;
        t.revenueBps = 2000;
        t.firstReleaseBps = 5000;
        t.minFeeBps = 100;
        BondrailTypes.AdapterConfig memory config = BondrailTypes.AdapterConfig(
            BondrailTypes.Adapter.Native, address(project), keccak256("local-test-review"));
        vm.expectRevert(BondrailFactory.InvalidAdapter.selector);
        factory.createBond(address(account), t, config, "Claims", "CLAIM");
        factory.setNativeApproval(address(project), true); // local reviewer only; not a production approval
        BondrailBond bond = BondrailBond(factory.createBond(address(account), t, config, "Claims", "CLAIM"));
        asset.mint(address(this), 100e6);
        asset.approve(address(bond), 100e6);
        bond.deposit(100e6);
        factory.activate(address(bond));
        vm.prank(PAYER);
        require(project.pay(100e6) == 99e6, "net during bond");
        require(asset.balanceOf(address(project)) == 108_900_000, "net routed to project");
        require(account.cumulativeRevenue() == 1_100_000, "fees recorded");
        require(account.issuerCredit() == 900_000, "issuer split");
        require(bond.pool() == 200_000 && bond.totalRevenueCollected() == 200_000, "investor split");

        BondrailCreditRegistry registry = new BondrailCreditRegistry(factory, address(this), address(this));
        IBondrailCreditRegistry api = IBondrailCreditRegistry(address(registry));
        api.recordBond(address(bond));
        IBondrailCreditRegistry.OnchainProfile memory p = api.onchainProfile(address(account));
        require(p.complete && p.bondsCreated == 1 && p.bonds.length == 1, "nested profile decoded");
        require(p.bonds[0].collected == 200_000 && p.repayment.active == 1, "bond record decoded");
        (IBondrailCreditRegistry.CreditAttestation memory a, address signer, bool valid) =
            api.attestedProfile(address(account));
        require(!valid && signer == address(0) && a.account == address(0), "missing assessment decoded");
    }

    function testVaultInterfaceDepositAndExit() public {
        BondrailVault vault = new BondrailVault(asset, factory, address(this), address(this));
        IBondrailVault api = IBondrailVault(address(vault));
        asset.mint(address(this), 10e6);
        asset.approve(address(vault), 10e6);
        uint256 expected = api.previewDeposit(10e6);
        uint256 shares = api.deposit(10e6, address(this));
        require(shares == expected && api.balanceOf(address(this)) == shares, "entry quote");
        require(api.idleAssets() == 10e6 && api.maxWithdraw(address(this)) == 10e6, "liquid balance");
        require(api.redeem(shares, address(this), address(this)) == 10e6, "exit");
    }
}
