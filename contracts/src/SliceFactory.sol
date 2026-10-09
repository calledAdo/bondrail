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
import {FeeGuard} from "./FeeGuard.sol";

/// @notice Creates accounts, guards and bonds; gates activation and the second release.
/// Projects deploy their own contracts: a Native project inherits SliceEarner, a Locked project keeps
/// its existing contract and hands ownership to a FeeGuard created here.
contract SliceFactory is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error InvalidTerms();
    error InvalidAdapter();
    error Unhealthy();
    error InvalidMilestone();

    IERC20 public immutable asset;
    address public immutable covenant;
    address public immutable milestoneSigner;
    address public immutable bondImplementation;
    address public immutable accountImplementation;
    /// @notice Disclosed reviewer who approves Native projects' code (pays fees only via its account).
    address public immutable reviewer;
    bytes32 public constant MILESTONE_TYPEHASH = keccak256(
        "Milestone(address bond,bytes32 policyHash,uint64 periodStart,uint64 periodEnd,uint256 eligibleRevenue,bytes32 evidenceHash,uint64 expiresAt,uint256 nonce)"
    );

    mapping(address => bool) public isAccount;
    mapping(address => bool) public isBond;
    /// @notice Native projects whose code the reviewer has checked routes every fee through `collect`.
    mapping(address => bool) public nativeApproved;
    /// @notice Guards this factory created (their code is known).
    mapping(address => bool) public recognizedGuard;

    event AccountCreated(address indexed issuer, address indexed account);
    event NativeApproval(address indexed project, bool approved);
    event GuardCreated(address indexed issuer, address indexed account, address indexed target, address guard);
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
        address reviewer_
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
    }

    // ---------------------------------------------------------------- accounts and sources

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

    /// @notice Locked tier: a guard for an existing owner-administered fee contract. After creating it,
    /// the issuer points the target's fee recipient at the account and transfers ownership to the guard.
    function createGuard(
        address account,
        address target,
        bytes4 recipientGetter,
        bytes4 feeGetter,
        uint256 minFee,
        bytes4[] calldata allowedSelectors
    ) external nonReentrant returns (address guard) {
        _issuerAccount(account);
        guard = address(
            new FeeGuard(target, msg.sender, account, recipientGetter, feeGetter, minFee, allowedSelectors)
        );
        recognizedGuard[guard] = true;
        emit GuardCreated(msg.sender, account, target, guard);
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
        _validateTerms(terms_);
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0 || bytes(symbol_).length > 16) {
            revert InvalidTerms();
        }
        if (SliceAccount(account).activeBond() != address(0) || config.policyHash == bytes32(0)) {
            revert InvalidAdapter();
        }
        if (config.adapter == SliceTypes.Adapter.Native) {
            if (config.guard != address(0)) revert InvalidAdapter();
            _native(config.source, account);
        } else if (config.adapter == SliceTypes.Adapter.Locked) {
            _locked(config.guard, config.source, account, msg.sender);
        } else if (config.guard != address(0) || config.source != address(0) || terms_.stake == 0) {
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

    function _healthy(SliceBond b) private view {
        SliceTypes.Adapter a = b.adapter();
        if (a == SliceTypes.Adapter.Native) _native(b.source(), b.account());
        else if (a == SliceTypes.Adapter.Locked) _locked(b.guard(), b.source(), b.account(), b.issuer());
        else if (!ISliceCovenant(covenant).isHealthy(address(b))) revert Unhealthy();
    }

    function _native(address source, address account) private view {
        if (
            !nativeApproved[source] || SliceAccount(account).project() != source
                || ISliceEarner(source).sliceAccount() != account
        ) revert InvalidAdapter();
    }

    function _locked(address guard, address source, address account, address issuer) private view {
        if (!recognizedGuard[guard]) revert InvalidAdapter();
        FeeGuard g = FeeGuard(guard);
        if (g.target() != source || g.account() != account || g.issuer() != issuer || !g.isLocked()) {
            revert Unhealthy();
        }
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
