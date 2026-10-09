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
import {SliceTypes, ISliceCovenant} from "./SliceTypes.sol";
import {SliceBond} from "./SliceBond.sol";
import {SliceRouter} from "./SliceRouter.sol";
import {PumpLab} from "./PumpLab.sol";
import {FeeGuard} from "./FeeGuard.sol";

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
    address public immutable routerImplementation;
    bytes32 public constant MILESTONE_TYPEHASH = keccak256(
        "Milestone(address bond,bytes32 policyHash,uint64 periodStart,uint64 periodEnd,uint256 eligibleRevenue,bytes32 evidenceHash,uint64 expiresAt,uint256 nonce)"
    );
    mapping(address => bool) public isRouter;
    mapping(address => bool) public isBond;
    mapping(address => bool) public recognizedGuard;
    mapping(address => address) public sourceGuard;
    event RouterCreated(address indexed issuer, address indexed router);
    event LockedSourceCreated(
        address indexed issuer, address indexed router, address source, address guard, address token
    );
    event BondCreated(
        address indexed issuer,
        address indexed router,
        address indexed bond,
        SliceTypes.Adapter adapter,
        bytes32 policyHash,
        bytes32 termsHash
    );
    event MilestoneAccepted(address indexed bond, bytes32 indexed evidenceHash, uint256 eligibleRevenue, uint256 nonce);

    constructor(
        address asset_,
        address covenant_,
        address milestoneSigner_,
        address bondImplementation_,
        address routerImplementation_
    ) EIP712("SliceFactory", "1") {
        if (
            asset_.code.length == 0 || IERC20Metadata(asset_).decimals() != 6 || covenant_.code.length == 0
                || milestoneSigner_ == address(0) || bondImplementation_.code.length == 0
                || routerImplementation_.code.length == 0
        ) revert InvalidTerms();
        asset = IERC20(asset_);
        covenant = covenant_;
        milestoneSigner = milestoneSigner_;
        bondImplementation = bondImplementation_;
        routerImplementation = routerImplementation_;
    }

    function createRouter() external nonReentrant returns (address router) {
        router = Clones.clone(routerImplementation);
        isRouter[router] = true;
        SliceRouter(router).initialize(address(asset), msg.sender, msg.sender);
        emit RouterCreated(msg.sender, router);
    }

    function createLockedSource(address router, string calldata name_, string calldata symbol_, uint16 maxNameLength)
        external
        nonReentrant
        returns (address source, address guard)
    {
        _issuerRouter(router);
        if (SliceRouter(router).activeBond() != address(0)) revert InvalidAdapter();
        PumpLab p = new PumpLab(address(asset), router, name_, symbol_, maxNameLength);
        FeeGuard g = new FeeGuard(address(p), msg.sender, router);
        p.transferOwnership(address(g));
        source = address(p);
        guard = address(g);
        recognizedGuard[guard] = true;
        sourceGuard[source] = guard;
        emit LockedSourceCreated(msg.sender, router, source, guard, address(p.token()));
    }

    function createBond(
        address router,
        SliceTypes.Terms calldata terms_,
        SliceTypes.AdapterConfig calldata config,
        string calldata name_,
        string calldata symbol_
    ) external nonReentrant returns (address bond) {
        _issuerRouter(router);
        _validateTerms(terms_);
        if (bytes(name_).length == 0 || bytes(symbol_).length == 0 || bytes(symbol_).length > 16) {
            revert InvalidTerms();
        }
        if (SliceRouter(router).activeBond() != address(0) || config.policyHash == bytes32(0)) revert InvalidAdapter();
        if (config.adapter == SliceTypes.Adapter.Locked) {
            _locked(config.guard, config.source, router, msg.sender);
        } else if (config.guard != address(0) || terms_.stake == 0) {
            revert InvalidAdapter();
        }
        bond = Clones.clone(bondImplementation);
        isBond[bond] = true;
        SliceBond(bond)
            .initialize(
                address(asset),
                msg.sender,
                router,
                covenant,
                SliceRouter(router).payout(),
                terms_,
                config,
                name_,
                symbol_
            );
        if (terms_.stake != 0) {
            uint256 beforeBalance = asset.balanceOf(bond);
            asset.safeTransferFrom(msg.sender, bond, terms_.stake);
            if (asset.balanceOf(bond) - beforeBalance != terms_.stake) revert InvalidTerms();
        }
        SliceRouter(router).attach(bond);
        if (config.adapter == SliceTypes.Adapter.Watched) {
            ISliceCovenant(covenant).registerBond(bond, config.policyHash);
        }
        emit BondCreated(msg.sender, router, bond, config.adapter, config.policyHash, keccak256(abi.encode(terms_)));
    }

    function activate(address bond) external nonReentrant {
        SliceBond b = _issuerBond(bond);
        _healthy(b);
        SliceRouter(b.router()).flushFunding(bond);
        b.activateFactoryOnly();
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

    function releaseSecond(address bond, SliceTypes.Milestone calldata m, bytes calldata signature)
        external
        nonReentrant
    {
        SliceBond b = _issuerBond(bond);
        SliceTypes.Terms memory t = b.terms();
        if (
            m.bond != bond || m.policyHash != b.policyHash() || m.nonce != b.releaseNonce()
                || m.evidenceHash == bytes32(0) || m.periodStart < b.activationTime() || m.periodEnd > block.timestamp
                || m.periodEnd < m.periodStart || m.periodEnd - m.periodStart < t.minOperatingPeriod
                || m.eligibleRevenue < t.minRevenue || m.expiresAt < block.timestamp
                || uint256(m.expiresAt) > uint256(m.periodEnd) + 300
        ) revert InvalidMilestone();
        if (ECDSA.recover(hashMilestone(m), signature) != milestoneSigner) revert Unauthorized();
        _healthy(b);
        b.releaseSecondFactoryOnly(m.evidenceHash);
        emit MilestoneAccepted(bond, m.evidenceHash, m.eligibleRevenue, m.nonce);
    }

    function _healthy(SliceBond b) private view {
        if (b.adapter() == SliceTypes.Adapter.Locked) _locked(b.guard(), b.source(), b.router(), b.issuer());
        else if (!ISliceCovenant(covenant).isHealthy(address(b))) revert Unhealthy();
    }

    function _locked(address guard, address source, address router, address issuer) private view {
        if (!recognizedGuard[guard] || sourceGuard[source] != guard) revert InvalidAdapter();
        FeeGuard g = FeeGuard(guard);
        if (g.target() != source || g.router() != router || g.issuer() != issuer || !g.isLocked()) revert Unhealthy();
    }

    function _issuerRouter(address router) private view {
        if (!isRouter[router] || SliceRouter(router).issuer() != msg.sender) revert Unauthorized();
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
