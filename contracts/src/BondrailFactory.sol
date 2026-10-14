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
import {BondrailTypes, IBondrailCovenant, IBondrailEarner} from "./BondrailTypes.sol";
import {BondrailBond} from "./BondrailBond.sol";
import {BondrailAccount} from "./BondrailAccount.sol";

/// @notice Creates accounts and bonds; gates issuance, deposits, activation and the second release.
/// Projects deploy their own contracts: a Native project inherits BondrailEarner and binds itself to its
/// account. A Watched business (an x402 API) only sets its payTo to the account.
contract BondrailFactory is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error InvalidTerms();
    error InvalidAdapter();
    error Unhealthy();
    error InvalidMilestone();
    error InsufficientHistory();
    error UnsupportedAsset();

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
    /// @notice Lifetime issuance count, including cancelled and defaulted bonds.
    mapping(address account => uint256) public bondsCreated;
    /// @notice Native projects whose code the reviewer has checked routes every fee through `collect`.
    mapping(address => bool) public nativeApproved;
    /// @notice Reviewed templates, by the hash of their creation code (constructor arguments excluded).
    /// Reviewed once; any issuer can then deploy one with `deployNative` and raise without a new review.
    mapping(bytes32 initCodeHash => bool) public nativeTemplate;
    /// @notice The template a project was deployed from by `deployNative` (zero for individually reviewed ones).
    mapping(address project => bytes32) public templateOf;

    event AccountCreated(address indexed issuer, address indexed account, address indexed asset);
    event NativeApproval(address indexed project, bool approved);
    event NativeTemplate(bytes32 indexed initCodeHash, bool approved);
    event NativeDeployed(address indexed account, address indexed project, bytes32 indexed initCodeHash);
    event BondCreated(
        address indexed issuer,
        address indexed account,
        address indexed bond,
        BondrailTypes.Adapter adapter,
        bytes32 policyHash,
        bytes32 termsHash
    );
    event SecondReleaseApproved(address indexed bond, BondrailTypes.MilestoneMode mode, uint256 eligibleRevenue);

    constructor(
        address covenant_,
        address milestoneSigner_,
        address bondImplementation_,
        address accountImplementation_,
        address reviewer_,
        uint256 minHistory_
    ) EIP712("BondrailFactory", "1") {
        if (
            covenant_.code.length == 0 || milestoneSigner_ == address(0) || bondImplementation_.code.length == 0
                || accountImplementation_.code.length == 0 || reviewer_ == address(0)
        ) revert InvalidTerms();
        covenant = covenant_;
        milestoneSigner = milestoneSigner_;
        bondImplementation = bondImplementation_;
        accountImplementation = accountImplementation_;
        reviewer = reviewer_;
        minHistory = minHistory_;
    }

    // ---------------------------------------------------------------- accounts and projects

    /// @notice A business's revenue account in one asset: the token it charges fees in, any ERC-20.
    /// Create it on day one: history starts at the first payment. Its bonds raise, repay and take stake
    /// in the same asset. Bondrail does not vet assets; the marketplace shows which asset a bond repays in.
    function createAccount(address asset_) external nonReentrant returns (address account) {
        if (asset_.code.length == 0) revert UnsupportedAsset();
        IERC20Metadata(asset_).decimals(); // claims mint 1:1 and share its decimals
        account = Clones.clone(accountImplementation);
        isAccount[account] = true;
        BondrailAccount(account).initialize(asset_, msg.sender);
        emit AccountCreated(msg.sender, account, asset_);
    }

    /// @notice Reviewer marks a Native project as checked: its code pays every fee through `collect`.
    function setNativeApproval(address project, bool approved) external {
        if (msg.sender != reviewer) revert Unauthorized();
        nativeApproved[project] = approved;
        emit NativeApproval(project, approved);
    }

    /// @notice Reviewer approves (or revokes) a template: creation code whose every fee goes through the
    /// account passed as its first constructor argument. Revoking it revokes every project built from it.
    function setNativeTemplate(bytes32 initCodeHash, bool approved) external {
        if (msg.sender != reviewer) revert Unauthorized();
        nativeTemplate[initCodeHash] = approved;
        emit NativeTemplate(initCodeHash, approved);
    }

    /// @notice Deploys a reviewed template for the caller's account and binds it, in one transaction.
    /// `args` is the ABI-encoded constructor arguments and must start with the account, so the deployed
    /// code is exactly the reviewed code pointed at this account. No per-project review is needed.
    function deployNative(address account, bytes calldata creationCode, bytes calldata args, bytes32 salt)
        external
        nonReentrant
        returns (address project)
    {
        _issuerAccount(account);
        bytes32 codeHash = keccak256(creationCode);
        if (!nativeTemplate[codeHash]) revert InvalidAdapter();
        if (args.length < 32 || abi.decode(args[:32], (address)) != account) revert InvalidAdapter();
        bytes memory initCode = bytes.concat(creationCode, args);
        bytes32 fullSalt = keccak256(abi.encode(account, salt));
        assembly ("memory-safe") {
            project := create2(0, add(initCode, 0x20), mload(initCode), fullSalt)
        }
        if (project == address(0)) revert InvalidAdapter();
        templateOf[project] = codeHash;
        BondrailAccount(account).bindProjectFromFactory(project); // also checks it points at the account
        emit NativeDeployed(account, project, codeHash);
    }

    // ---------------------------------------------------------------- bonds

    function createBond(
        address account,
        BondrailTypes.Terms calldata terms_,
        BondrailTypes.AdapterConfig calldata config,
        string calldata name_,
        string calldata symbol_
    ) external nonReentrant returns (address bond) {
        _issuerAccount(account);
        uint256 first = BondrailAccount(account).firstRevenueAt();
        if (minHistory != 0 && (first == 0 || block.timestamp < first + minHistory)) revert InsufficientHistory();
        _validateTerms(terms_);
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0 || bytes(symbol_).length > 16) {
            revert InvalidTerms();
        }
        if (BondrailAccount(account).activeBond() != address(0) || config.policyHash == bytes32(0)) {
            revert InvalidAdapter();
        }
        if (config.adapter == BondrailTypes.Adapter.Native) {
            if (!_nativeOk(config.source, account)) revert InvalidAdapter();
        } else if (config.source != address(0) || terms_.stake == 0 || terms_.minFeeBps != 0) {
            // Watched: nothing on-chain enforces the route, so a slashable stake is mandatory (and there
            // is no collect call for a fee floor to apply to).
            revert InvalidAdapter();
        }
        IERC20 asset = BondrailAccount(account).asset();
        bond = Clones.clone(bondImplementation);
        isBond[bond] = true;
        BondrailBond(bond)
            .initialize(address(asset), msg.sender, account, covenant, msg.sender, terms_, config, name_, symbol_);
        if (terms_.stake != 0) {
            uint256 beforeBalance = asset.balanceOf(bond);
            asset.safeTransferFrom(msg.sender, bond, terms_.stake);
            if (asset.balanceOf(bond) - beforeBalance != terms_.stake) revert InvalidTerms();
        }
        BondrailAccount(account).attach(bond);
        if (config.adapter == BondrailTypes.Adapter.Watched) {
            IBondrailCovenant(covenant).registerBond(bond, config.policyHash);
        }
        ++bondsCreated[account];
        emit BondCreated(msg.sender, account, bond, config.adapter, config.policyHash, keccak256(abi.encode(terms_)));
    }

    /// @notice Issuer activates a fully funded bond: first release; revenue sharing starts now.
    function activate(address bond) external nonReentrant {
        BondrailBond b = _issuerBond(bond);
        _healthy(b);
        BondrailAccount account = BondrailAccount(b.account());
        account.settleBeforeActivation(bond);
        b.activateFactoryOnly(account.cumulativeRevenue());
    }

    /// @notice Second release, on-chain mode: the account's own revenue counter since activation.
    function releaseSecond(address bond) external nonReentrant {
        BondrailBond b = _issuerBond(bond);
        BondrailTypes.Terms memory t = b.terms();
        if (t.milestoneMode != BondrailTypes.MilestoneMode.Onchain) revert InvalidMilestone();
        uint256 earned = BondrailAccount(b.account()).cumulativeRevenue() - b.revenueSnapshot();
        if (earned < t.minRevenue || block.timestamp < uint256(b.activationTime()) + t.minOperatingPeriod) {
            revert InvalidMilestone();
        }
        _healthy(b);
        b.releaseSecondFactoryOnly(keccak256(abi.encode("onchain", earned)));
        emit SecondReleaseApproved(bond, BondrailTypes.MilestoneMode.Onchain, earned);
    }

    function hashMilestone(BondrailTypes.Milestone memory m) public view returns (bytes32) {
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
    function releaseSecondSigned(address bond, BondrailTypes.Milestone calldata m, bytes calldata signature)
        external
        nonReentrant
    {
        BondrailBond b = _issuerBond(bond);
        BondrailTypes.Terms memory t = b.terms();
        if (
            t.milestoneMode != BondrailTypes.MilestoneMode.Signed || m.bond != bond || m.policyHash != b.policyHash()
                || m.nonce != b.releaseNonce() || m.evidenceHash == bytes32(0) || m.periodStart < b.activationTime()
                || m.periodEnd > block.timestamp || m.periodEnd < m.periodStart
                || m.periodEnd - m.periodStart < t.minOperatingPeriod || m.eligibleRevenue < t.minRevenue
                || m.expiresAt < block.timestamp || uint256(m.expiresAt) > uint256(m.periodEnd) + 300
        ) revert InvalidMilestone();
        if (ECDSA.recover(hashMilestone(m), signature) != milestoneSigner) revert Unauthorized();
        _healthy(b);
        b.releaseSecondFactoryOnly(m.evidenceHash);
        emit SecondReleaseApproved(bond, BondrailTypes.MilestoneMode.Signed, m.eligibleRevenue);
    }

    // ---------------------------------------------------------------- checks

    /// @notice Whether investors may deposit now: a Native project still reviewed and bound, or a Watched
    /// bond whose latest CRE observation is not a Violation. Called by the bond on every deposit.
    function depositAllowed(address bond) external view returns (bool) {
        if (!isBond[bond]) return false;
        BondrailBond b = BondrailBond(bond);
        if (b.adapter() == BondrailTypes.Adapter.Native) return _nativeOk(b.source(), b.account());
        return !IBondrailCovenant(covenant).inViolation(bond);
    }

    /// @dev Activation and the second release need more than deposits: a Watched bond needs a fresh
    /// Compliant observation.
    function _healthy(BondrailBond b) private view {
        bool ok = b.adapter() == BondrailTypes.Adapter.Native
            ? _nativeOk(b.source(), b.account())
            : IBondrailCovenant(covenant).isHealthy(address(b));
        if (!ok) revert Unhealthy();
    }

    function _nativeOk(address source, address account) private view returns (bool) {
        bytes32 template = templateOf[source];
        bool reviewed = nativeApproved[source] || (template != bytes32(0) && nativeTemplate[template]);
        return reviewed && BondrailAccount(account).project() == source && IBondrailEarner(source).bondrailAccount() == account;
    }

    function _issuerAccount(address account) private view {
        if (!isAccount[account] || BondrailAccount(account).issuer() != msg.sender) revert Unauthorized();
    }

    function _issuerBond(address bond) private view returns (BondrailBond b) {
        if (!isBond[bond]) revert Unauthorized();
        b = BondrailBond(bond);
        if (b.issuer() != msg.sender) revert Unauthorized();
    }

    function _validateTerms(BondrailTypes.Terms calldata t) private view {
        if (t.triggerRevenue != 0 || t.triggerWindowDays != 0 || t.stepUpBps != 0) {
            if (
                t.triggerRevenue == 0 || t.triggerWindowDays == 0 || t.triggerWindowDays > 30
                    || t.stepUpBps <= t.revenueBps || t.stepUpBps > 5000
            ) revert InvalidTerms();
        }
        if (
            t.raiseAmount == 0 || t.repayCap < t.raiseAmount || t.minRevenue == 0 || t.minOperatingPeriod < 30
                || t.revenueBps == 0 || t.revenueBps > 5000 || (t.firstReleaseBps != 2500 && t.firstReleaseBps != 5000)
                || t.fundingDeadline <= block.timestamp || t.fundingDeadline >= t.maturity
                || t.secondReleaseNotBefore >= t.secondReleaseDeadline || t.secondReleaseDeadline >= t.maturity
                || t.secondReleaseDeadline <= t.fundingDeadline || t.maturity - t.fundingDeadline < t.minOperatingPeriod
                || Math.mulDiv(t.raiseAmount, t.firstReleaseBps, 10_000) == 0 || t.minFeeBps > 10_000
        ) revert InvalidTerms();
    }
}
