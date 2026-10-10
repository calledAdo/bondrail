// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SliceTypes, ISliceBond} from "./SliceTypes.sol";

/// @notice Watched-adapter covenant. Observations arrive only through Chainlink CRE reports (`onReport`
/// from the pinned forwarder), and each must also carry the pinned observer's EIP-712 signature, because
/// the simulation forwarder alone does not authenticate who produced a report.
contract SliceCovenant is EIP712, ReentrancyGuard {
    error Unauthorized();
    error InvalidObservation();
    error DuplicateEpoch();
    error AlreadyInitialized();
    address public immutable forwarder;
    address public immutable observationSigner;
    address public immutable initializer;
    address public factory;
    uint64 public constant EPOCH_SECONDS = 30;
    uint64 public constant MAX_AGE = 90;
    uint64 public constant MAX_CLOCK_SKEW = 5;
    bytes32 public constant OBSERVATION_TYPEHASH = keccak256(
        "Observation(address bond,bytes32 policyHash,uint64 epoch,uint64 observedAt,uint64 expiresAt,uint8 result,address observedPayTo,bytes32 offerHash,bytes32 evidenceHash)"
    );

    struct Slot {
        uint64 epoch;
        uint64 observedAt;
        uint64 expiresAt;
        uint8 result;
        bytes32 digest;
    }
    mapping(address => bytes32) public policyHashes;
    mapping(address => mapping(uint8 => Slot)) private slots;
    mapping(address => uint64) public latestEpoch;
    mapping(address => bool) public hasObservation;
    event FactoryInitialized(address indexed factory);
    event WatchRegistered(address indexed bond, bytes32 indexed policyHash);
    event ObservationAccepted(
        address indexed bond,
        uint64 indexed epoch,
        uint8 result,
        uint64 observedAt,
        bytes32 evidenceHash,
        bytes32 digest
    );
    event CovenantDefault(address indexed bond, uint64 firstEpoch, uint64 secondEpoch, bytes32 evidenceHash);

    constructor(address forwarder_, address signer_) EIP712("SliceCovenant", "1") {
        if (forwarder_ == address(0) || signer_ == address(0)) revert Unauthorized();
        forwarder = forwarder_;
        observationSigner = signer_;
        initializer = msg.sender;
    }

    function initializeFactory(address factory_) external {
        if (msg.sender != initializer) revert Unauthorized();
        if (factory != address(0) || factory_.code.length == 0) revert AlreadyInitialized();
        factory = factory_;
        emit FactoryInitialized(factory_);
    }

    function registerBond(address bond, bytes32 policyHash) external {
        if (msg.sender != factory) revert Unauthorized();
        if (policyHash == bytes32(0) || policyHashes[bond] != bytes32(0)) revert InvalidObservation();
        policyHashes[bond] = policyHash;
        emit WatchRegistered(bond, policyHash);
    }

    function hashObservation(SliceTypes.Observation memory o) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    OBSERVATION_TYPEHASH,
                    o.bond,
                    o.policyHash,
                    o.epoch,
                    o.observedAt,
                    o.expiresAt,
                    o.result,
                    o.observedPayTo,
                    o.offerHash,
                    o.evidenceHash
                )
            )
        );
    }

    function onReport(bytes calldata, bytes calldata report) external nonReentrant {
        if (msg.sender != forwarder) revert Unauthorized();
        (SliceTypes.Observation memory o, bytes memory signature) = abi.decode(report, (SliceTypes.Observation, bytes));
        _submit(o, signature);
    }

    function _submit(SliceTypes.Observation memory o, bytes memory signature) private {
        if (
            o.policyHash == bytes32(0) || policyHashes[o.bond] != o.policyHash || o.result > 2 || o.observedAt == 0
                || o.epoch != o.observedAt / EPOCH_SECONDS || o.observedAt > block.timestamp + MAX_CLOCK_SKEW
                || block.timestamp > uint256(o.observedAt) + MAX_AGE || o.expiresAt < block.timestamp
                || o.expiresAt < o.observedAt || uint256(o.expiresAt) > uint256(o.observedAt) + MAX_AGE
        ) revert InvalidObservation();
        bytes32 digest = hashObservation(o);
        if (ECDSA.recover(digest, signature) != observationSigner) revert Unauthorized();
        ISliceBond b = ISliceBond(o.bond);
        SliceTypes.Phase p = b.phase();
        if (p == SliceTypes.Phase.Cancelled || p == SliceTypes.Phase.Closed) revert InvalidObservation();
        if (
            p == SliceTypes.Phase.Closing
                && (block.timestamp >= b.settleAfter() || o.observedAt >= b.collectionClosedAt())
        ) revert InvalidObservation();
        if (o.result == 1 && o.observedPayTo != b.account()) revert InvalidObservation();
        Slot storage slot = slots[o.bond][uint8(o.epoch % 8)];
        if (slot.observedAt != 0 && slot.epoch == o.epoch) revert DuplicateEpoch();
        // Accepted epochs span at most four buckets; eight bounded slots cannot erase fresh evidence.
        slot.epoch = o.epoch;
        slot.observedAt = o.observedAt;
        slot.expiresAt = o.expiresAt;
        slot.result = o.result;
        slot.digest = digest;
        if (!hasObservation[o.bond] || o.epoch > latestEpoch[o.bond]) {
            latestEpoch[o.bond] = o.epoch;
            hasObservation[o.bond] = true;
        }
        emit ObservationAccepted(o.bond, o.epoch, o.result, o.observedAt, o.evidenceHash, digest);
        if (o.result != 2 || p == SliceTypes.Phase.Funding || b.defaultedAt() != 0) return;
        if (o.epoch > 0) _checkPair(b, o.bond, o.epoch - 1, o.epoch);
        if (b.defaultedAt() == 0) _checkPair(b, o.bond, o.epoch, o.epoch + 1);
    }

    function _checkPair(ISliceBond b, address bond, uint64 first, uint64 second) private {
        Slot storage a = slots[bond][uint8(first % 8)];
        Slot storage c = slots[bond][uint8(second % 8)];
        uint64 activated = b.activationTime();
        uint64 cutoff = b.collectionClosedAt();
        if (
            a.epoch != first || c.epoch != second || a.result != 2 || c.result != 2 || a.observedAt <= activated
                || c.observedAt <= activated || (cutoff != 0 && (a.observedAt >= cutoff || c.observedAt >= cutoff))
        ) return;
        bytes32 evidence = keccak256(abi.encode(a.digest, c.digest));
        b.markDefault(evidence);
        emit CovenantDefault(bond, first, second, evidence);
    }

    function isHealthy(address bond) external view returns (bool) {
        if (!hasObservation[bond]) return false;
        Slot storage s = slots[bond][uint8(latestEpoch[bond] % 8)];
        return s.result == 1 && s.expiresAt >= block.timestamp && uint256(s.observedAt) + MAX_AGE >= block.timestamp
            && s.observedAt <= block.timestamp + MAX_CLOCK_SKEW && ISliceBond(bond).defaultedAt() == 0;
    }

    /// @notice True when the bond defaulted or its latest observation is a Violation. Deposits check this:
    /// unlike `isHealthy` it needs no fresh report, so a bond can raise between CRE runs.
    function inViolation(address bond) external view returns (bool) {
        if (ISliceBond(bond).defaultedAt() != 0) return true;
        return hasObservation[bond] && slots[bond][uint8(latestEpoch[bond] % 8)].result == 2;
    }

    function observationAt(address bond, uint64 epoch) external view returns (Slot memory s) {
        s = slots[bond][uint8(epoch % 8)];
        if (s.epoch != epoch) delete s;
    }
}
