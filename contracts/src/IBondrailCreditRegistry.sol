// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondrailTypes} from "./BondrailTypes.sol";

/// @notice Integration ABI for BondrailCreditRegistry; return layouts are checked against the implementation.
/// @dev Booked history includes self-payments. Attested fields depend on the current attester.
interface IBondrailCreditRegistry {
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

    function factory() external view returns (address);
    function owner() external view returns (address);
    function attester() external view returns (address);
    function pendingAttester() external view returns (address);
    function attesterChangeAfter() external view returns (uint256);
    function MAX_BONDS() external view returns (uint256);
    function ATTESTER_DELAY() external view returns (uint256);
    function ATTESTATION_TYPEHASH() external view returns (bytes32);
    function recorded(address bond) external view returns (bool);
    function usedNonces(address account, uint256 nonce) external view returns (bool);
    function recordBond(address bond) external;
    function recordedBonds(address account) external view returns (address[] memory);
    function onchainProfile(address account) external view returns (OnchainProfile memory);
    function hashAttestation(CreditAttestation memory attestation) external view returns (bytes32);
    function attest(CreditAttestation calldata attestation, bytes calldata signature) external;
    function attestedProfile(address account)
        external view returns (CreditAttestation memory attestation, address signer, bool valid);
    function proposeAttester(address next) external;
    function acceptAttester() external;
}
