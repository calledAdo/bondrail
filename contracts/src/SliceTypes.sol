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
    enum Adapter {
        Locked,
        Watched
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
    }

    struct AdapterConfig {
        Adapter adapter;
        address source;
        address guard;
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

interface ISliceRouter {
    function issuer() external view returns (address);
    function asset() external view returns (address);
    function activeBond() external view returns (address);
    function payout() external view returns (address);
    function attach(address bond) external;
    function flushFunding(address expectedBond) external;
    function sweep() external;
    function closeBondAtMaturity(address expectedBond) external;
    function cancelFunding(address expectedBond) external;
}

interface ISliceBond {
    function phase() external view returns (SliceTypes.Phase);
    function revenueBps() external view returns (uint16);
    function maturity() external view returns (uint64);
    function remainingRevenueCap() external view returns (uint256);
    function onRepayment(uint256 amount) external;
    function finalizeCollection(SliceTypes.CloseReason reason) external;
    function cancelFundingFromRouter() external;
    function activationTime() external view returns (uint64);
    function collectionClosedAt() external view returns (uint64);
    function settleAfter() external view returns (uint64);
    function defaultedAt() external view returns (uint64);
    function policyHash() external view returns (bytes32);
    function router() external view returns (address);
    function markDefault(bytes32 evidenceHash) external;
}

interface ISliceCovenant {
    function registerBond(address bond, bytes32 policyHash) external;
    function isHealthy(address bond) external view returns (bool);
}

interface IFeeGuard {
    function isLocked() external view returns (bool);
    function issuer() external view returns (address);
    function router() external view returns (address);
    function target() external view returns (address);
}
