// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {BondrailCreditRegistry} from "../src/BondrailCreditRegistry.sol";
import {TestBase} from "./TestBase.sol";
import {SliceTypes} from "../src/SliceTypes.sol";
import {SliceBond} from "../src/SliceBond.sol";
import {SliceAccount} from "../src/SliceAccount.sol";
import {SliceFactory} from "../src/SliceFactory.sol";
import {SliceCovenant} from "../src/SliceCovenant.sol";
import {PumpLab} from "@slice-demo/PumpLab.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract CreditRegistryTest is TestBase {
    BondrailCreditRegistry registry;
    uint256 constant ATTESTER_PK = 999;
    event BondRecorded(address indexed account, address indexed bond);
    MockUSDC asset;
    SliceFactory factory;
    SliceCovenant covenant;
    SliceAccount router;
    PumpLab source;
    SliceBond bond;
    address issuer = address(0x111);
    address investor = address(0x222);
    address buyer = address(0x333);
    address forwarder = address(0x444);
    uint256 constant OBSERVER_PK = 12345;
    uint256 constant MILESTONE_PK = 67890;
    address constant REVIEWER = address(0x777);
    SliceTypes.Terms t;

    function setUp() public {
        vm.warp(1_800_000);
        vm.chainId(31337);
        asset = new MockUSDC();
        covenant = new SliceCovenant(forwarder, vm.addr(OBSERVER_PK));
        factory = new SliceFactory(
            address(covenant), vm.addr(MILESTONE_PK), address(new SliceBond()), address(new SliceAccount()), REVIEWER, 0
        );
        covenant.initializeFactory(address(factory));
        registry = new BondrailCreditRegistry(factory, address(this), vm.addr(ATTESTER_PK));
        asset.mint(issuer, 10_000_000e6);
        asset.mint(investor, 10_000_000e6);
        vm.startPrank(issuer);
        router = SliceAccount(factory.createAccount(address(asset)));
        // Native tier: the issuer's own project, built on SliceEarner and bound to the account.
        source = new PumpLab(address(router), "Lab", "LAB");
        router.bindProject(address(source));
        asset.approve(address(factory), type(uint256).max);
        vm.stopPrank();
        vm.prank(REVIEWER);
        factory.setNativeApproval(address(source), true);
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
            5000,
            SliceTypes.MilestoneMode.Signed,
            0,
            0,
            0,
            0
        );
    }

    function _new(bool watched) internal {
        SliceTypes.AdapterConfig memory c = SliceTypes.AdapterConfig(
            watched ? SliceTypes.Adapter.Watched : SliceTypes.Adapter.Native,
            watched ? address(0) : address(source),
            keccak256("policy-v1")
        );
        vm.prank(issuer);
        bond = SliceBond(factory.createBond(address(router), t, c, "Lab Revenue Claim", "LAB-RC"));
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
        bytes memory signature = _sig(OBSERVER_PK, covenant.hashObservation(o));
        vm.prank(forwarder);
        covenant.onReport("", abi.encode(o, signature));
    }

    function _revenue(uint256 amount) internal {
        asset.mint(address(router), amount);
        router.sweep();
    }

    function _nextTerms() internal {
        t.fundingDeadline = uint64(vm.getBlockTimestamp() + 120);
        t.maturity = uint64(vm.getBlockTimestamp() + 1200);
        t.secondReleaseNotBefore = uint64(vm.getBlockTimestamp() + 150);
        t.secondReleaseDeadline = uint64(vm.getBlockTimestamp() + 600);
    }

    function _record() internal {
        vm.prank(buyer); // no issuer/owner permission required
        registry.recordBond(address(bond));
    }

    function _cancel() internal {
        vm.warp(t.fundingDeadline);
        router.cancelFunding(address(bond));
    }

    function _attestation() internal view returns (BondrailCreditRegistry.CreditAttestation memory) {
        uint64 now_ = uint64(vm.getBlockTimestamp());
        return BondrailCreditRegistry.CreditAttestation(
            address(router),
            block.chainid,
            now_ - 1000,
            now_ - 1,
            100e6,
            20e6,
            5,
            2500,
            10e6,
            keccak256("canonical evidence"),
            now_,
            now_ + 7 days,
            42
        );
    }

    function _attest(BondrailCreditRegistry.CreditAttestation memory a) internal {
        bytes memory sig = _sig(ATTESTER_PK, registry.hashAttestation(a));
        vm.prank(buyer);
        registry.attest(a, sig);
    }

    function testRecordRejectsNonBondAndDuplicate() public {
        vm.expectRevert(BondrailCreditRegistry.InvalidBond.selector);
        registry.recordBond(address(router));
        _new(false);
        vm.expectEmit(true, true, false, false, address(registry));
        emit BondRecorded(address(router), address(bond));
        _record();
        vm.expectRevert(BondrailCreditRegistry.AlreadyRecorded.selector);
        registry.recordBond(address(bond));
        eq(registry.recordedBonds(address(router)).length, 1);
        yes(registry.recorded(address(bond)));
    }

    function testRejects65thBond() public {
        for (uint256 i; i < 64; ++i) {
            _nextTerms();
            _new(false);
            _record();
            _cancel();
        }
        _nextTerms();
        _new(false);
        vm.expectRevert(BondrailCreditRegistry.BondLimit.selector);
        registry.recordBond(address(bond));
        yes(!registry.recorded(address(bond)));
        BondrailCreditRegistry.OnchainProfile memory p = registry.onchainProfile(address(router));
        eq(p.bonds.length, 64);
        eq(p.repayment.cancelled, 64);
    }

    function testAccountViewsAndUnknownTier() public {
        vm.expectRevert(BondrailCreditRegistry.InvalidAccount.selector);
        registry.onchainProfile(buyer);
        BondrailCreditRegistry.OnchainProfile memory p = registry.onchainProfile(address(router));
        eq(p.asset, address(asset));
        eq(p.issuer, issuer);
        eq(p.project, address(source));
        eq(p.tier, 0);
        eq(p.firstRevenueAt, 0);
        eq(p.historyAge, 0);
        SliceAccount empty = SliceAccount(factory.createAccount(address(asset)));
        eq(registry.onchainProfile(address(empty)).tier, 2);
        // Native buy produces payer/volume counters; plain sweep has no proven payer.
        asset.mint(buyer, 100e6);
        vm.startPrank(buyer);
        asset.approve(address(router), 100e6);
        source.buy(100e6, 0, uint64(vm.getBlockTimestamp() + 60));
        vm.stopPrank();
        _revenue(7e6);
        vm.warp(vm.getBlockTimestamp() + 50);
        p = registry.onchainProfile(address(router));
        eq(p.cumulativeRevenue, router.cumulativeRevenue());
        eq(p.cumulativeVolume, 100e6);
        eq(p.paymentCount, 2);
        eq(p.collectedCount, 1);
        eq(p.uniquePayers, 1);
        eq(p.firstRevenueAt, router.firstRevenueAt());
        eq(p.historyAge, 50);
    }

    function testRepaymentRecordAcrossLifecycles() public {
        _new(false);
        _record();
        vm.prank(investor);
        bond.deposit(10e6);
        BondrailCreditRegistry.OnchainProfile memory p = registry.onchainProfile(address(router));
        eq(p.repayment.bondsIssued, 1);
        eq(p.repayment.funding, 1);
        eq(p.repayment.totalRaised, 0);
        _cancel();
        vm.prank(investor);
        bond.refund(10e6, investor);

        _nextTerms();
        _activate(false);
        _record();
        _revenue(300e6); // 20% share meets the staged 60e6 effective cap
        p = registry.onchainProfile(address(router));
        eq(p.repayment.fullyRepaid, 1);
        eq(p.bonds[1].repaidRatioBps, 10_000);
        eq(p.repayment.totalRepaidToInvestors, 0); // collected is not yet redeemed
        vm.prank(investor); // 60 revenue + 50 recovered principal
        bond.redeem(100e6, investor);

        _nextTerms();
        _activate(true);
        _record();
        _revenue(150e6);
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        p = registry.onchainProfile(address(router));
        eq(p.repayment.closing, 1);
        eq(p.repayment.closedAtMaturity, 1);
        eq(p.bonds[2].repaidRatioBps, 5000);
        vm.warp(bond.settleAfter());
        bond.finalizeSettlement();
        vm.prank(investor); // 30 revenue + 50 principal
        bond.redeem(100e6, investor);

        _nextTerms();
        _activate(true);
        _record();
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        yes(bond.defaultedAt() != 0);
        p = registry.onchainProfile(address(router));
        eq(p.repayment.active, 1);
        eq(p.repayment.defaulted, 1);
        vm.warp(t.maturity);
        router.closeBondAtMaturity(address(bond));
        vm.warp(bond.settleAfter());
        bond.finalizeSettlement();

        _nextTerms();
        _activate(false);
        _record();
        _revenue(10e6);
        p = registry.onchainProfile(address(router));
        eq(p.repayment.bondsIssued, 5);
        eq(p.repayment.cancelled, 1);
        eq(p.repayment.active, 1);
        eq(p.repayment.funding, 0);
        eq(p.repayment.closing, 0);
        eq(p.repayment.fullyRepaid, 1);
        eq(p.repayment.closedAtMaturity, 2);
        eq(p.repayment.defaulted, 1);
        eq(p.repayment.totalRaised, 400e6);
        eq(p.repayment.totalCollected, 92e6);
        eq(p.repayment.totalRepaidToInvestors, 190e6);
    }

    function testCapClosedDefaultRemainsDisclosedDuringGrace() public {
        _activate(true);
        _record();
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        vm.warp(vm.getBlockTimestamp() + 30);
        _observe(uint64(vm.getBlockTimestamp()), 2);
        _revenue(300e6);
        BondrailCreditRegistry.OnchainProfile memory p = registry.onchainProfile(address(router));
        eq(p.repayment.closing, 1);
        eq(p.repayment.fullyRepaid, 1);
        eq(p.repayment.defaulted, 1);
    }

    function testFuzzTotalsEqualRecordedBonds(uint8 count_, uint256 seed) public {
        uint256 count = uint256(count_ % 8) + 1;
        uint256 raised;
        uint256 collected;
        uint256 redeemed;
        uint256 cancelled;
        uint256 capClosed;
        uint256 maturityClosed;
        for (uint256 i; i < count; ++i) {
            _nextTerms();
            uint256 choice = uint256(keccak256(abi.encode(seed, i)));
            if (choice % 3 == 0) {
                _new(false);
                _record();
                _cancel();
                ++cancelled;
            } else {
                _activate(false);
                _record();
                raised += t.raiseAmount;
                _revenue(choice % 3 == 1 ? 300e6 : (choice % 300e6));
                if (bond.phase() == SliceTypes.Phase.Active) {
                    vm.warp(t.maturity);
                    router.closeBondAtMaturity(address(bond));
                    ++maturityClosed;
                } else {
                    ++capClosed;
                }
                collected += bond.totalRevenueCollected();
                vm.prank(investor);
                redeemed += bond.redeem(100e6, investor);
            }
        }
        BondrailCreditRegistry.OnchainProfile memory p = registry.onchainProfile(address(router));
        eq(p.repayment.bondsIssued, count);
        eq(p.bonds.length, count);
        eq(p.repayment.totalRaised, raised);
        eq(p.repayment.totalCollected, collected);
        eq(p.repayment.totalRepaidToInvestors, redeemed);
        eq(p.repayment.cancelled, cancelled);
        eq(p.repayment.fullyRepaid, capClosed);
        eq(p.repayment.closedAtMaturity, maturityClosed);
        eq(p.cumulativeRevenue, router.cumulativeRevenue());
    }

    function testValidSignatureStoredAndExpires() public {
        (, address signer, bool valid) = registry.attestedProfile(address(router));
        eq(signer, address(0));
        yes(!valid);
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        vm.recordLogs();
        _attest(a);
        yes(vm.getRecordedLogs().length == 1);
        (BondrailCreditRegistry.CreditAttestation memory got, address original, bool ok) =
            registry.attestedProfile(address(router));
        yes(keccak256(abi.encode(a)) == keccak256(abi.encode(got)));
        eq(original, vm.addr(ATTESTER_PK));
        yes(ok);
        yes(registry.usedNonces(address(router), a.nonce));
        vm.warp(a.expiresAt);
        (,, ok) = registry.attestedProfile(address(router));
        yes(!ok);
    }

    function testRejectWrongSignerAndDomain() public {
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        bytes memory sig = _sig(123, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.Unauthorized.selector);
        registry.attest(a, sig);
        BondrailCreditRegistry other = new BondrailCreditRegistry(factory, address(this), vm.addr(ATTESTER_PK));
        sig = _sig(ATTESTER_PK, other.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.Unauthorized.selector);
        registry.attest(a, sig);
        yes(!registry.usedNonces(address(router), a.nonce));
    }

    function testRejectWrongChain() public {
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        a.chainId++;
        bytes memory sig = _sig(ATTESTER_PK, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.InvalidAttestation.selector);
        registry.attest(a, sig);
    }

    function testRejectExpired() public {
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        a.expiresAt = a.issuedAt;
        bytes memory sig = _sig(ATTESTER_PK, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.InvalidAttestation.selector);
        registry.attest(a, sig);
    }

    function testRejectOlderPeriodAndStaleCorrection() public {
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        _attest(a);
        a.nonce++;
        a.periodEnd--;
        bytes memory sig = _sig(ATTESTER_PK, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.StaleAttestation.selector);
        registry.attest(a, sig);
        a.periodEnd++;
        sig = _sig(ATTESTER_PK, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.StaleAttestation.selector);
        registry.attest(a, sig);
        vm.warp(vm.getBlockTimestamp() + 1);
        a.issuedAt++;
        _attest(a);
        a.nonce++;
        a.periodEnd++;
        _attest(a);
    }

    function testRejectNonceReuseAcrossPeriods() public {
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        _attest(a);
        vm.warp(vm.getBlockTimestamp() + 1);
        a.periodEnd++;
        a.issuedAt++;
        bytes memory sig = _sig(ATTESTER_PK, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.NonceUsed.selector);
        registry.attest(a, sig);
    }

    function testRejectInvalidAccountAndTimeBounds() public {
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        a.account = buyer;
        vm.expectRevert(BondrailCreditRegistry.InvalidAccount.selector);
        registry.attest(a, "");
        a = _attestation();
        a.periodStart = a.periodEnd;
        vm.expectRevert(BondrailCreditRegistry.InvalidAttestation.selector);
        registry.attest(a, "");
        a = _attestation();
        a.periodEnd = a.issuedAt + 1;
        vm.expectRevert(BondrailCreditRegistry.InvalidAttestation.selector);
        registry.attest(a, "");
        a = _attestation();
        a.issuedAt++;
        vm.expectRevert(BondrailCreditRegistry.InvalidAttestation.selector);
        registry.attest(a, "");
        a = _attestation();
        a.evidenceHash = bytes32(0);
        vm.expectRevert(BondrailCreditRegistry.InvalidAttestation.selector);
        registry.attest(a, "");
        a = _attestation();
        a.topPayerShareBps = 10_001;
        vm.expectRevert(BondrailCreditRegistry.InvalidAttestation.selector);
        registry.attest(a, "");
    }

    function testAttesterRotationTimelockAndOriginalSigner() public {
        BondrailCreditRegistry.CreditAttestation memory a = _attestation();
        _attest(a);
        vm.prank(buyer);
        vm.expectRevert(BondrailCreditRegistry.Unauthorized.selector);
        registry.proposeAttester(buyer);
        vm.expectRevert(BondrailCreditRegistry.InvalidState.selector);
        registry.acceptAttester();
        vm.expectRevert(BondrailCreditRegistry.InvalidConfiguration.selector);
        registry.proposeAttester(address(0));
        registry.proposeAttester(vm.addr(123));
        vm.warp(vm.getBlockTimestamp() + 1 days);
        registry.proposeAttester(vm.addr(456)); // restarting proposal restarts full delay
        vm.warp(vm.getBlockTimestamp() + 1 days);
        vm.expectRevert(BondrailCreditRegistry.TooEarly.selector);
        registry.acceptAttester();
        vm.warp(registry.attesterChangeAfter());
        vm.prank(buyer);
        vm.expectRevert(BondrailCreditRegistry.Unauthorized.selector);
        registry.acceptAttester();
        registry.acceptAttester();
        eq(registry.attester(), vm.addr(456));
        eq(registry.pendingAttester(), address(0));
        eq(registry.attesterChangeAfter(), 0);
        (, address original, bool valid) = registry.attestedProfile(address(router));
        eq(original, vm.addr(ATTESTER_PK));
        yes(valid);
        a.issuedAt = uint64(vm.getBlockTimestamp());
        a.periodEnd = a.issuedAt;
        bytes memory sig = _sig(456, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.NonceUsed.selector);
        registry.attest(a, sig);
        a.nonce++;
        sig = _sig(ATTESTER_PK, registry.hashAttestation(a));
        vm.expectRevert(BondrailCreditRegistry.Unauthorized.selector);
        registry.attest(a, sig);
        sig = _sig(456, registry.hashAttestation(a));
        registry.attest(a, sig);
    }
}
