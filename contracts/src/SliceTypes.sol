// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library SliceTypes {
    enum Phase {
        Funding,
        Active,
        Closing,
        Closed,
        Cancelled
    }
    enum CloseReason {
        None,
        RevenueCap,
        Maturity
    }
    /// @notice How the bond knows fees reach the account: Native (enforced by the project's code, reviewed)
    /// or Watched (an off-chain route, checked by Chainlink CRE and backed by a slashable stake).
    enum Adapter {
        Native,
        Watched
    }

    /// @notice How the second capital release is proven.
    enum MilestoneMode {
        Onchain, // account revenue since activation >= minRevenue (trustless; counts all revenue)
        Signed // EIP-712 attestation from the factory's disclosed milestone signer (wash-adjusted)
    }

    struct Terms {
        uint256 raiseAmount;
        uint256 repayCap;
        uint256 stake;
        uint256 minRevenue;
        uint64 fundingDeadline;
        uint64 maturity;
        uint64 secondReleaseNotBefore;
        uint64 secondReleaseDeadline;
        uint32 minOperatingPeriod;
        uint16 revenueBps;
        uint16 firstReleaseBps;
        MilestoneMode milestoneMode;
    }

    struct AdapterConfig {
        Adapter adapter;
        address source;
        bytes32 policyHash;
    }

    struct Observation {
        address bond;
        bytes32 policyHash;
        uint64 epoch;
        uint64 observedAt;
        uint64 expiresAt;
        uint8 result;
        address observedPayTo;
        bytes32 offerHash;
        bytes32 evidenceHash;
    }

    struct Milestone {
        address bond;
        bytes32 policyHash;
        uint64 periodStart;
        uint64 periodEnd;
        uint256 eligibleRevenue;
        bytes32 evidenceHash;
        uint64 expiresAt;
        uint256 nonce;
    }
}

/// @notice Implemented by Native projects (see SliceEarner): the account they pay every fee through.
interface ISliceEarner {
    function sliceAccount() external view returns (address);
}

interface ISliceAccount {
    function issuer() external view returns (address);
    function asset() external view returns (address);
    function project() external view returns (address);
    function activeBond() external view returns (address);
    function cumulativeRevenue() external view returns (uint256);
    function collect(address payer, uint256 gross, uint256 fee) external returns (uint256 net);
    function collectWithPermit(
        address payer,
        uint256 gross,
        uint256 fee,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 net);
    function sweep() external;
    function attach(address bond) external;
    function settleBeforeActivation(address expectedBond) external;
    function bindProject(address project) external;
}

interface ISliceBond {
    function phase() external view returns (SliceTypes.Phase);
    function revenueBps() external view returns (uint16);
    function maturity() external view returns (uint64);
    function remainingRevenueCap() external view returns (uint256);
    function onRepayment(uint256 amount) external;
    function finalizeCollection(SliceTypes.CloseReason reason) external;
    function cancelFundingFromAccount() external;
    function activationTime() external view returns (uint64);
    function collectionClosedAt() external view returns (uint64);
    function settleAfter() external view returns (uint64);
    function defaultedAt() external view returns (uint64);
    function policyHash() external view returns (bytes32);
    function account() external view returns (address);
    function markDefault(bytes32 evidenceHash) external;
}

interface ISliceCovenant {
    function registerBond(address bond, bytes32 policyHash) external;
    function isHealthy(address bond) external view returns (bool);
    function inViolation(address bond) external view returns (bool);
}

interface ISliceFactory {
    function depositAllowed(address bond) external view returns (bool);
}
