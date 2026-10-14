// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BondrailFactory} from "./BondrailFactory.sol";
import {BondrailAccount} from "./BondrailAccount.sol";
import {BondrailBond} from "./BondrailBond.sol";
import {BondrailTypes} from "./BondrailTypes.sol";

/// @notice Factory-scoped booked history plus separately signed underwriting assertions.
/// @dev Bond history covers recorded bonds; complete compares coverage to factory issuance. Booked payers can self-pay;
/// defaults preserve the existing covenant's trust. See docs/credit/DESIGN.md before lending.
contract BondrailCreditRegistry is EIP712 {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidAccount();
    error InvalidBond();
    error AlreadyRecorded();
    error BondLimit();
    error InvalidAttestation();
    error StaleAttestation();
    error NonceUsed();
    error TooEarly();
    error InvalidState();

    uint256 public constant MAX_BONDS = 64;
    uint256 public constant ATTESTER_DELAY = 2 days;
    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "CreditAttestation(address account,uint256 chainId,uint64 periodStart,uint64 periodEnd,uint256 attributedRevenue,uint256 excludedRevenue,uint256 distinctPayers,uint16 topPayerShareBps,uint256 creditLine,bytes32 evidenceHash,uint64 issuedAt,uint64 expiresAt,uint256 nonce)"
    );

    struct CreditAttestation {
        address account;
        uint256 chainId;
        uint64 periodStart;
        uint64 periodEnd;
        uint256 attributedRevenue;
        uint256 excludedRevenue;
        uint256 distinctPayers;
        uint16 topPayerShareBps;
        uint256 creditLine;
        bytes32 evidenceHash;
        uint64 issuedAt;
        uint64 expiresAt;
        uint256 nonce;
    }

    struct BondRecord {
        address bond;
        BondrailTypes.Adapter adapter;
        BondrailTypes.Phase phase;
        BondrailTypes.CloseReason closeReason;
        uint64 defaultedAt;
        uint256 raised;
        uint256 collected;
        uint256 effectiveCap;
        uint256 repaidRatioBps;
        uint256 repaidToInvestors;
    }

    struct RepaymentRecord {
        uint256 bondsIssued;
        uint256 funding;
        uint256 active;
        uint256 closing;
        uint256 fullyRepaid;
        uint256 closedAtMaturity;
        uint256 cancelled;
        uint256 defaulted;
        uint256 totalRaised;
        uint256 totalCollected;
        uint256 totalRepaidToInvestors;
    }

    struct OnchainProfile {
        address asset;
        address issuer;
        address project;
        uint8 tier; // 0 Native (project bound), 1 Watched (recorded bond), 2 Unknown
        uint64 firstRevenueAt;
        uint256 historyAge; // seconds
        uint256 cumulativeRevenue;
        uint256 cumulativeVolume;
        uint64 paymentCount;
        uint64 collectedCount;
        uint64 uniquePayers;
        uint256 bondsCreated;
        bool complete;
        RepaymentRecord repayment;
        BondRecord[] bonds;
    }

    BondrailFactory public immutable factory;
    address public immutable owner;
    address public attester;
    address public pendingAttester;
    uint256 public attesterChangeAfter;
    mapping(address => address[]) private _bonds;
    mapping(address => bool) public recorded;
    mapping(address => CreditAttestation) private _attestations;
    mapping(address => address) private _signers;
    mapping(address => mapping(uint256 => bool)) public usedNonces;

    event BondRecorded(address indexed account, address indexed bond);
    event Attested(
        address indexed account,
        address indexed signer,
        uint256 chainId,
        uint64 periodStart,
        uint64 periodEnd,
        uint256 attributedRevenue,
        uint256 excludedRevenue,
        uint256 distinctPayers,
        uint16 topPayerShareBps,
        uint256 creditLine,
        bytes32 evidenceHash,
        uint64 issuedAt,
        uint64 expiresAt,
        uint256 nonce
    );
    event AttesterProposed(address indexed attester, uint256 executableAt);
    event AttesterChanged(address indexed previousAttester, address indexed attester);

    constructor(BondrailFactory factory_, address owner_, address attester_) EIP712("BondrailCreditRegistry", "1") {
        if (address(factory_).code.length == 0 || owner_ == address(0) || attester_ == address(0)) {
            revert InvalidConfiguration();
        }
        factory = factory_;
        owner = owner_;
        attester = attester_;
        emit AttesterChanged(address(0), attester_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function proposeAttester(address next) external onlyOwner {
        if (next == address(0)) revert InvalidConfiguration();
        pendingAttester = next;
        attesterChangeAfter = block.timestamp + ATTESTER_DELAY;
        emit AttesterProposed(next, attesterChangeAfter);
    }

    function acceptAttester() external onlyOwner {
        address next = pendingAttester;
        if (next == address(0)) revert InvalidState();
        if (block.timestamp < attesterChangeAfter) revert TooEarly();
        address previous = attester;
        attester = next;
        delete pendingAttester;
        delete attesterChangeAfter;
        emit AttesterChanged(previous, next);
    }

    function recordBond(address bond) external {
        if (!factory.isBond(bond)) revert InvalidBond();
        if (recorded[bond]) revert AlreadyRecorded();
        address account = BondrailBond(bond).account();
        if (_bonds[account].length == MAX_BONDS) revert BondLimit();
        recorded[bond] = true;
        _bonds[account].push(bond);
        emit BondRecorded(account, bond);
    }

    function recordedBonds(address account) external view returns (address[] memory) {
        return _bonds[account];
    }

    function onchainProfile(address account) external view returns (OnchainProfile memory p) {
        if (!factory.isAccount(account)) revert InvalidAccount();
        BondrailAccount a = BondrailAccount(account);
        p.asset = address(a.asset());
        p.issuer = a.issuer();
        p.project = a.project();
        uint256 count = _bonds[account].length;
        p.bondsCreated = factory.bondsCreated(account);
        p.complete = count == p.bondsCreated;
        p.tier = p.project != address(0) ? 0 : count != 0 ? 1 : 2;
        p.firstRevenueAt = a.firstRevenueAt();
        p.historyAge = p.firstRevenueAt == 0 ? 0 : block.timestamp - p.firstRevenueAt;
        p.cumulativeRevenue = a.cumulativeRevenue();
        p.cumulativeVolume = a.cumulativeVolume();
        p.paymentCount = a.paymentCount();
        p.collectedCount = a.collectedCount();
        p.uniquePayers = a.uniquePayers();
        p.repayment.bondsIssued = count;
        p.bonds = new BondRecord[](count);
        for (uint256 i; i < count; ++i) {
            BondrailBond b = BondrailBond(_bonds[account][i]);
            BondRecord memory r;
            r.bond = address(b);
            r.adapter = b.adapter();
            r.phase = b.phase();
            r.closeReason = b.closeReason();
            r.defaultedAt = b.defaultedAt();
            r.raised = b.activationTime() == 0 ? 0 : b.terms().raiseAmount;
            r.collected = b.totalRevenueCollected();
            r.effectiveCap = b.effectiveRevenueCap();
            r.repaidRatioBps = r.effectiveCap == 0 ? 0 : Math.mulDiv(r.collected, 10_000, r.effectiveCap);
            r.repaidToInvestors = b.totalRedeemed();
            p.bonds[i] = r;
            if (r.phase == BondrailTypes.Phase.Funding) ++p.repayment.funding;
            if (r.phase == BondrailTypes.Phase.Active) ++p.repayment.active;
            if (r.phase == BondrailTypes.Phase.Closing) ++p.repayment.closing;
            if (r.phase == BondrailTypes.Phase.Cancelled) ++p.repayment.cancelled;
            if (r.closeReason == BondrailTypes.CloseReason.RevenueCap) ++p.repayment.fullyRepaid;
            if (r.closeReason == BondrailTypes.CloseReason.Maturity) ++p.repayment.closedAtMaturity;
            if (r.defaultedAt != 0) ++p.repayment.defaulted;
            p.repayment.totalRaised += r.raised;
            p.repayment.totalCollected += r.collected;
            p.repayment.totalRepaidToInvestors += r.repaidToInvestors;
        }
    }

    function hashAttestation(CreditAttestation memory a) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ATTESTATION_TYPEHASH, a)));
    }

    /// @notice Anyone can relay. Equal-period corrections must have a newer issue time.
    function attest(CreditAttestation calldata a, bytes calldata signature) external {
        if (!factory.isAccount(a.account)) revert InvalidAccount();
        if (
            a.chainId != block.chainid || a.periodStart >= a.periodEnd || a.periodEnd > a.issuedAt
                || a.issuedAt > block.timestamp || a.expiresAt <= block.timestamp || a.evidenceHash == bytes32(0)
                || a.topPayerShareBps > 10_000
        ) revert InvalidAttestation();
        if (usedNonces[a.account][a.nonce]) revert NonceUsed();
        CreditAttestation storage previous = _attestations[a.account];
        if (a.periodEnd < previous.periodEnd || (a.periodEnd == previous.periodEnd && a.issuedAt <= previous.issuedAt)) revert StaleAttestation();
        address signer = ECDSA.recover(hashAttestation(a), signature);
        if (signer != attester) revert Unauthorized();
        usedNonces[a.account][a.nonce] = true;
        _attestations[a.account] = a;
        _signers[a.account] = signer;
        emit Attested(
            a.account,
            signer,
            a.chainId,
            a.periodStart,
            a.periodEnd,
            a.attributedRevenue,
            a.excludedRevenue,
            a.distinctPayers,
            a.topPayerShareBps,
            a.creditLine,
            a.evidenceHash,
            a.issuedAt,
            a.expiresAt,
            a.nonce
        );
    }

    /// @notice Valid means signed by the current attester and unexpired, not independently verified.
    /// The stored payload and original signer remain visible after rotation or expiry.
    function attestedProfile(address account)
        external
        view
        returns (CreditAttestation memory attestation, address signer, bool valid)
    {
        attestation = _attestations[account];
        signer = _signers[account];
        valid = signer != address(0) && signer == attester && block.timestamp < attestation.expiresAt;
    }
}
