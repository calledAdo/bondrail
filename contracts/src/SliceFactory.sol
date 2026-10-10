// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SliceTypes, ISliceCovenant, ISliceEarner} from "./SliceTypes.sol";
import {SliceBond} from "./SliceBond.sol";
import {SliceAccount} from "./SliceAccount.sol";

/// @notice Creates accounts and bonds; gates issuance, deposits, activation and the second release.
/// Projects deploy their own contracts: a Native project inherits SliceEarner and binds itself to its
/// account. A Watched business (an x402 API) only sets its payTo to the account.
contract SliceFactory is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error InvalidTerms();
    error InvalidAdapter();
    error Unhealthy();
    error InvalidMilestone();
    error InsufficientHistory();

    IERC20 public immutable asset;
    address public immutable covenant;
    address public immutable milestoneSigner;
    address public immutable bondImplementation;
    address public immutable accountImplementation;
    /// @notice Disclosed reviewer who approves Native projects' code (pays fees only via its account).
    address public immutable reviewer;
    /// @notice Minimum time since an account's first booked payment before it can issue a bond.
    /// Time is the one part of a revenue history that cannot be faked.
    uint256 public immutable minHistory;
    bytes32 public constant MILESTONE_TYPEHASH = keccak256(
        "Milestone(address bond,bytes32 policyHash,uint64 periodStart,uint64 periodEnd,uint256 eligibleRevenue,bytes32 evidenceHash,uint64 expiresAt,uint256 nonce)"
    );

    mapping(address => bool) public isAccount;
    mapping(address => bool) public isBond;
    /// @notice Native projects whose code the reviewer has checked routes every fee through `collect`.
    mapping(address => bool) public nativeApproved;

    event AccountCreated(address indexed issuer, address indexed account);
    event NativeApproval(address indexed project, bool approved);
    event BondCreated(
        address indexed issuer,
        address indexed account,
        address indexed bond,
        SliceTypes.Adapter adapter,
        bytes32 policyHash,
        bytes32 termsHash
    );
    event SecondReleaseApproved(address indexed bond, SliceTypes.MilestoneMode mode, uint256 eligibleRevenue);

    constructor(
        address asset_,
        address covenant_,
        address milestoneSigner_,
        address bondImplementation_,
        address accountImplementation_,
        address reviewer_,
        uint256 minHistory_
    ) EIP712("SliceFactory", "1") {
        if (
            asset_.code.length == 0 || IERC20Metadata(asset_).decimals() != 6 || covenant_.code.length == 0
                || milestoneSigner_ == address(0) || bondImplementation_.code.length == 0
                || accountImplementation_.code.length == 0 || reviewer_ == address(0)
        ) revert InvalidTerms();
        asset = IERC20(asset_);
        covenant = covenant_;
        milestoneSigner = milestoneSigner_;
        bondImplementation = bondImplementation_;
        accountImplementation = accountImplementation_;
        reviewer = reviewer_;
        minHistory = minHistory_;
    }

    // ---------------------------------------------------------------- accounts and projects

    /// @notice A business's revenue account. Create it on day one: history starts at the first payment.
    function createAccount() external nonReentrant returns (address account) {
        account = Clones.clone(accountImplementation);
        isAccount[account] = true;
        SliceAccount(account).initialize(address(asset), msg.sender);
        emit AccountCreated(msg.sender, account);
    }

    /// @notice Reviewer marks a Native project as checked: its code pays every fee through `collect`.
    function setNativeApproval(address project, bool approved) external {
        if (msg.sender != reviewer) revert Unauthorized();
        nativeApproved[project] = approved;
        emit NativeApproval(project, approved);
    }

    // ---------------------------------------------------------------- bonds

    function createBond(
        address account,
        SliceTypes.Terms calldata terms_,
        SliceTypes.AdapterConfig calldata config,
        string calldata name_,
        string calldata symbol_
    ) external nonReentrant returns (address bond) {
        _issuerAccount(account);
        uint256 first = SliceAccount(account).firstRevenueAt();
        if (minHistory != 0 && (first == 0 || block.timestamp < first + minHistory)) revert InsufficientHistory();
        _validateTerms(terms_);
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0 || bytes(symbol_).length > 16) {
            revert InvalidTerms();
        }
        if (SliceAccount(account).activeBond() != address(0) || config.policyHash == bytes32(0)) {
            revert InvalidAdapter();
        }
        if (config.adapter == SliceTypes.Adapter.Native) {
            if (!_nativeOk(config.source, account)) revert InvalidAdapter();
        } else if (config.source != address(0) || terms_.stake == 0) {
            // Watched: nothing on-chain enforces the route, so a slashable stake is mandatory.
            revert InvalidAdapter();
        }
        bond = Clones.clone(bondImplementation);
        isBond[bond] = true;
        SliceBond(bond)
            .initialize(address(asset), msg.sender, account, covenant, msg.sender, terms_, config, name_, symbol_);
        if (terms_.stake != 0) {
            uint256 beforeBalance = asset.balanceOf(bond);
            asset.safeTransferFrom(msg.sender, bond, terms_.stake);
            if (asset.balanceOf(bond) - beforeBalance != terms_.stake) revert InvalidTerms();
        }
        SliceAccount(account).attach(bond);
        if (config.adapter == SliceTypes.Adapter.Watched) {
            ISliceCovenant(covenant).registerBond(bond, config.policyHash);
        }
        emit BondCreated(msg.sender, account, bond, config.adapter, config.policyHash, keccak256(abi.encode(terms_)));
    }

    /// @notice Issuer activates a fully funded bond: first release; revenue sharing starts now.
    function activate(address bond) external nonReentrant {
        SliceBond b = _issuerBond(bond);
        _healthy(b);
        SliceAccount account = SliceAccount(b.account());
        account.settleBeforeActivation(bond);
        b.activateFactoryOnly(account.cumulativeRevenue());
    }

    /// @notice Second release, on-chain mode: the account's own revenue counter since activation.
    function releaseSecond(address bond) external nonReentrant {
        SliceBond b = _issuerBond(bond);
        SliceTypes.Terms memory t = b.terms();
        if (t.milestoneMode != SliceTypes.MilestoneMode.Onchain) revert InvalidMilestone();
        uint256 earned = SliceAccount(b.account()).cumulativeRevenue() - b.revenueSnapshot();
        if (earned < t.minRevenue || block.timestamp < uint256(b.activationTime()) + t.minOperatingPeriod) {
            revert InvalidMilestone();
        }
        _healthy(b);
        b.releaseSecondFactoryOnly(keccak256(abi.encode("onchain", earned)));
        emit SecondReleaseApproved(bond, SliceTypes.MilestoneMode.Onchain, earned);
    }

    function hashMilestone(SliceTypes.Milestone memory m) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    MILESTONE_TYPEHASH,
                    m.bond,
                    m.policyHash,
                    m.periodStart,
                    m.periodEnd,
                    m.eligibleRevenue,
                    m.evidenceHash,
                    m.expiresAt,
                    m.nonce
                )
            )
        );
    }

    /// @notice Second release, signed mode: a wash-adjusted attestation from the disclosed milestone signer.
    function releaseSecondSigned(address bond, SliceTypes.Milestone calldata m, bytes calldata signature)
        external
        nonReentrant
    {
        SliceBond b = _issuerBond(bond);
        SliceTypes.Terms memory t = b.terms();
        if (
            t.milestoneMode != SliceTypes.MilestoneMode.Signed || m.bond != bond || m.policyHash != b.policyHash()
                || m.nonce != b.releaseNonce() || m.evidenceHash == bytes32(0) || m.periodStart < b.activationTime()
                || m.periodEnd > block.timestamp || m.periodEnd < m.periodStart
                || m.periodEnd - m.periodStart < t.minOperatingPeriod || m.eligibleRevenue < t.minRevenue
                || m.expiresAt < block.timestamp || uint256(m.expiresAt) > uint256(m.periodEnd) + 300
        ) revert InvalidMilestone();
        if (ECDSA.recover(hashMilestone(m), signature) != milestoneSigner) revert Unauthorized();
        _healthy(b);
        b.releaseSecondFactoryOnly(m.evidenceHash);
        emit SecondReleaseApproved(bond, SliceTypes.MilestoneMode.Signed, m.eligibleRevenue);
    }

    // ---------------------------------------------------------------- checks

    /// @notice Whether investors may deposit now: a Native project still reviewed and bound, or a Watched
    /// bond whose latest CRE observation is not a Violation. Called by the bond on every deposit.
    function depositAllowed(address bond) external view returns (bool) {
        if (!isBond[bond]) return false;
        SliceBond b = SliceBond(bond);
        if (b.adapter() == SliceTypes.Adapter.Native) return _nativeOk(b.source(), b.account());
        return !ISliceCovenant(covenant).inViolation(bond);
    }

    /// @dev Activation and the second release need more than deposits: a Watched bond needs a fresh
    /// Compliant observation.
    function _healthy(SliceBond b) private view {
        bool ok = b.adapter() == SliceTypes.Adapter.Native
            ? _nativeOk(b.source(), b.account())
            : ISliceCovenant(covenant).isHealthy(address(b));
        if (!ok) revert Unhealthy();
    }

    function _nativeOk(address source, address account) private view returns (bool) {
        return nativeApproved[source] && SliceAccount(account).project() == source
            && ISliceEarner(source).sliceAccount() == account;
    }

    function _issuerAccount(address account) private view {
        if (!isAccount[account] || SliceAccount(account).issuer() != msg.sender) revert Unauthorized();
    }

    function _issuerBond(address bond) private view returns (SliceBond b) {
        if (!isBond[bond]) revert Unauthorized();
        b = SliceBond(bond);
        if (b.issuer() != msg.sender) revert Unauthorized();
    }

    function _validateTerms(SliceTypes.Terms calldata t) private view {
        if (
            t.raiseAmount == 0 || t.repayCap < t.raiseAmount || t.minRevenue == 0 || t.minOperatingPeriod < 30
                || t.revenueBps == 0 || t.revenueBps > 5000 || (t.firstReleaseBps != 2500 && t.firstReleaseBps != 5000)
                || t.fundingDeadline <= block.timestamp || t.fundingDeadline >= t.maturity
                || t.secondReleaseNotBefore >= t.secondReleaseDeadline || t.secondReleaseDeadline >= t.maturity
                || t.secondReleaseDeadline <= t.fundingDeadline || t.maturity - t.fundingDeadline < t.minOperatingPeriod
                || Math.mulDiv(t.raiseAmount, t.firstReleaseBps, 10_000) == 0
        ) revert InvalidTerms();
    }
}
