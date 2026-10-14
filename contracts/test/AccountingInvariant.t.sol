// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {TestBase} from "./TestBase.sol";
import {SliceTypes} from "../src/SliceTypes.sol";
import {SliceBond} from "../src/SliceBond.sol";
import {SliceAccount} from "../src/SliceAccount.sol";
import {PumpLab} from "@slice-demo/PumpLab.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {MockERC3009} from "./mocks/MockERC3009.sol";

contract AccountingHandler is TestBase {
    MockERC3009 public asset;
    SliceFactory public factory;
    SliceAccount public router;
    SliceBond public bond;
    uint256 public receipts;
    uint256 public issuerWithdrawn;
    uint256 public holderPaid;
    uint256 private constant PK = 67890;
    SliceTypes.Terms private t;
    uint256 private settlementNonce;

    constructor() {
        asset = new MockERC3009();
        SliceCovenant c = new SliceCovenant(address(0x444), vm.addr(12345));
        factory = new SliceFactory(
            address(c), vm.addr(PK), address(new SliceBond()), address(new SliceAccount()), address(0x777), 0
        );
        c.initializeFactory(address(factory));
        router = SliceAccount(factory.createAccount(address(asset)));
        PumpLab lab = new PumpLab(address(router), "Invariant Lab", "INV");
        router.bindProject(address(lab));
        vm.prank(address(0x777));
        factory.setNativeApproval(address(lab), true);
        address source = address(lab);
        uint64 now_ = uint64(vm.getBlockTimestamp());
        t = SliceTypes.Terms(
            100e6,
            120e6,
            20e6,
            10e6,
            now_ + 120,
            now_ + 60 days,
            now_ + 150,
            now_ + 20 days,
            30,
            2000,
            5000,
            SliceTypes.MilestoneMode.Signed,
            0,
            2,
            4000,
            40e6
        );
        asset.mint(address(this), 120e6);
        asset.approve(address(factory), 20e6);
        bond = SliceBond(
            factory.createBond(
                address(router),
                t,
                SliceTypes.AdapterConfig(SliceTypes.Adapter.Native, source, keccak256("invariant-policy")),
                "Invariant Lab Revenue Claim",
                "INV-RC"
            )
        );
        asset.approve(address(bond), 100e6);
        bond.deposit(100e6);
        factory.activate(address(bond));
    }

    function receiveFees(uint64 amount, bool collect) external {
        uint256 value = uint256(amount) % 40e6;
        asset.mint(address(router), value);
        receipts += value;
        if (collect) router.sweep();
    }

    function settle(uint64 raw, uint8 payerSeed) external {
        uint256 value = uint256(raw) % 40e6 + 1;
        uint256 payerPk = uint256(payerSeed) + 1;
        address payer = vm.addr(payerPk);
        uint256 validBefore = vm.getBlockTimestamp() + 300;
        bytes32 nonce = bytes32(++settlementNonce);
        asset.mint(payer, value);
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(payerPk, asset.hashAuthorization(payer, address(router), value, 0, validBefore, nonce));
        router.settle(payer, value, 0, validBefore, nonce, v, r, s);
        receipts += value;
    }

    function sweep() external {
        router.sweep();
    }

    function withdraw(uint64 raw) external {
        uint256 credit = router.issuerCredit();
        if (credit == 0) return;
        uint256 amount = uint256(raw) % credit + 1;
        router.withdraw(address(this), amount);
        issuerWithdrawn += amount;
    }

    function advance(uint32 raw) external {
        vm.warp(vm.getBlockTimestamp() + uint256(raw) % (2 days));
    }

    function checkTrigger() external {
        uint256 today = vm.getBlockTimestamp() / 1 days;
        if (
            bond.phase() != SliceTypes.Phase.Active || bond.defaultedAt() != 0
                || today < uint256(bond.activationTime()) / 1 days + 1 + t.triggerWindowDays
                || bond.lastTriggerCheckDay() == today
        ) return;
        bond.checkTrigger();
    }

    function expire() external {
        if (bond.phase() == SliceTypes.Phase.Active && vm.getBlockTimestamp() >= t.secondReleaseDeadline) {
            bond.expireUndrawn();
        }
    }

    function release() external {
        uint64 now_ = uint64(vm.getBlockTimestamp());
        if (
            bond.phase() != SliceTypes.Phase.Active || bond.undrawnPrincipal() == 0 || now_ < t.secondReleaseNotBefore
                || now_ >= t.secondReleaseDeadline
        ) return;
        SliceTypes.Milestone memory m = SliceTypes.Milestone(
            address(bond),
            bond.policyHash(),
            bond.activationTime(),
            now_,
            10e6,
            keccak256("screened"),
            now_ + 90,
            bond.releaseNonce()
        );
        factory.releaseSecondSigned(address(bond), m, _sig(PK, factory.hashMilestone(m)));
    }

    function close() external {
        if (bond.phase() == SliceTypes.Phase.Active && vm.getBlockTimestamp() >= t.maturity) {
            router.closeBondAtMaturity(address(bond));
        }
    }

    function redeem(uint64 raw) external {
        uint256 held = bond.balanceOf(address(this));
        SliceTypes.Phase p = bond.phase();
        bool closed = p == SliceTypes.Phase.Closed;
        if (!closed && p != SliceTypes.Phase.Active && p != SliceTypes.Phase.Closing) return;
        // Before close the last claim must stay outstanding, so redeem at most held - 1.
        uint256 limit = closed ? held : (held == bond.totalSupply() ? held - 1 : held);
        if (limit == 0) return;
        uint256 amount = uint256(raw) % limit + 1;
        if (bond.pool() != 0 && amount * bond.pool() / bond.totalSupply() == 0) return;
        holderPaid += bond.redeem(amount, address(this));
    }

    function donate(uint64 raw) external {
        asset.mint(address(bond), uint256(raw) % 10e6);
    }
}

contract AccountingInvariantTest is TestBase {
    AccountingHandler public handler;
    address[] private targets;

    function setUp() public {
        vm.warp(1_800_000);
        handler = new AccountingHandler();
        targets.push(address(handler));
    }

    function targetContracts() external view returns (address[] memory) {
        return targets;
    }

    function invariantAssetsCoverEveryLiability() public view {
        SliceBond b = handler.bond();
        SliceAccount r = handler.router();
        MockERC3009 a = handler.asset();
        yes(a.balanceOf(address(b)) >= b.accountedBalance());
        yes(a.balanceOf(address(r)) >= r.issuerCredit());
        eq(b.releasedPrincipal() + b.undrawnPrincipal() + b.principalRecovery(), 100e6);
        eq(b.totalRedeemed() + b.pool(), b.totalRevenueCollected() + b.principalRecovery() + b.stakeRecovery());
        eq(handler.receipts(), a.balanceOf(address(r)) + b.totalRevenueCollected() + handler.issuerWithdrawn());
        eq(handler.holderPaid(), b.totalRedeemed());
        yes(b.totalRevenueCollected() <= b.effectiveRevenueCap());
        eq(b.revenueBps(), b.triggered() ? 4000 : 2000);
        yes(r.splitRemainder() < 10_000);
        // Early redemption only shrinks supply, and the last claim survives until Closed.
        yes(b.totalSupply() <= 100e6);
        if (b.phase() == SliceTypes.Phase.Active || b.phase() == SliceTypes.Phase.Closing) yes(b.totalSupply() > 0);
        if (b.totalSupply() == 0) eq(b.pool(), 0);
    }
}
