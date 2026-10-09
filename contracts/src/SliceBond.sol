// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SliceTypes} from "./SliceTypes.sol";

/// @notice One fungible class: fund, stage principal, collect revenue, then redeem once collection and evidence close.
contract SliceBond is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Unauthorized();
    error InvalidState();
    error InvalidAmount();
    error TooEarly();
    error TransferLocked();
    error LastHolderWaitsForClose();
    bool private initialized;
    IERC20 public asset;
    address public factory;
    address public issuer;
    address public router;
    address public covenant;
    address public raiseRecipient;
    address public guard;
    address public source;
    bytes32 public policyHash;
    SliceTypes.Adapter public adapter;
    SliceTypes.Phase public phase;
    SliceTypes.CloseReason public closeReason;
    SliceTypes.Terms private _terms;
    uint64 public activationTime;
    uint64 public collectionClosedAt;
    uint64 public settleAfter;
    uint64 public defaultedAt;
    uint256 public collectionClosedBlock;
    bytes32 public defaultEvidenceHash;
    uint256 public fundingEscrow;
    uint256 public releasedPrincipal;
    uint256 public undrawnPrincipal;
    uint256 public principalRecovery;
    uint256 public totalRevenueCollected;
    uint256 public stakeHeld;
    uint256 public stakeRecovery;
    uint256 public stakeReturnCredit;
    uint256 public pool;
    uint256 public totalRedeemed;
    uint256 public releaseNonce;
    uint64 public constant REPORT_GRACE = 120;

    event Deposited(address indexed payer, uint256 amount, uint256 funded);
    event Activated(address indexed issuer, uint256 released, uint256 undrawn, uint256 effectiveCap);
    event PrincipalReleased(uint256 amount, uint256 releasedTotal, uint256 effectiveCap, bytes32 evidenceHash);
    event UndrawnRecovered(uint256 amount, uint256 recoveryTotal);
    event RevenueReceived(uint256 amount, uint256 totalRevenue, uint256 pool);
    event DefaultRecorded(bytes32 indexed evidenceHash, uint256 stakeRecovered);
    event CollectionClosed(SliceTypes.CloseReason reason, uint64 closedAt, uint64 settleAfter, uint256 pool);
    event SettlementFinalized(uint256 pool, uint256 supply, uint256 issuerStakeCredit);
    event FundingCancelled(uint256 refundable, uint256 issuerStakeCredit);
    event Refunded(address indexed holder, address indexed receiver, uint256 amount);
    event Redeemed(address indexed holder, address indexed receiver, uint256 tokens, uint256 amount);
    event StakeClaimed(address indexed receiver, uint256 amount);

    string private _claimName;
    string private _claimSymbol;

    constructor() ERC20("", "") {
        initialized = true;
    }

    /// @dev Clones carry their own name and symbol so each bond is distinguishable on Kuru and in wallets.
    function name() public view override returns (string memory) {
        return _claimName;
    }

    function symbol() public view override returns (string memory) {
        return _claimSymbol;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
    modifier onlyFactory() {
        if (msg.sender != factory) revert Unauthorized();
        _;
    }
    modifier onlyRouter() {
        if (msg.sender != router) revert Unauthorized();
        _;
    }

    function initialize(
        address asset_,
        address issuer_,
        address router_,
        address covenant_,
        address recipient_,
        SliceTypes.Terms calldata terms_,
        SliceTypes.AdapterConfig calldata config,
        string calldata name_,
        string calldata symbol_
    ) external {
        if (
            initialized || asset_ == address(0) || issuer_ == address(0) || router_ == address(0)
                || recipient_ == address(0)
        ) revert InvalidState();
        initialized = true;
        _claimName = name_;
        _claimSymbol = symbol_;
        factory = msg.sender;
        asset = IERC20(asset_);
        issuer = issuer_;
        router = router_;
        covenant = covenant_;
        raiseRecipient = recipient_;
        _terms = terms_;
        adapter = config.adapter;
        source = config.source;
        guard = config.guard;
        policyHash = config.policyHash;
        stakeHeld = terms_.stake;
    }

    function terms() external view returns (SliceTypes.Terms memory) {
        return _terms;
    }

    function revenueBps() external view returns (uint16) {
        return _terms.revenueBps;
    }

    function maturity() external view returns (uint64) {
        return _terms.maturity;
    }

    function revenuePool() external view returns (uint256) {
        return totalRevenueCollected;
    }

    function effectiveRevenueCap() public view returns (uint256) {
        return Math.mulDiv(_terms.repayCap, releasedPrincipal, _terms.raiseAmount);
    }

    function remainingRevenueCap() public view returns (uint256) {
        return effectiveRevenueCap() - totalRevenueCollected;
    }

    function accountedBalance() public view returns (uint256) {
        return fundingEscrow + undrawnPrincipal + pool + stakeHeld + stakeReturnCredit;
    }

    function deposit(uint256 amount) external nonReentrant {
        if (phase != SliceTypes.Phase.Funding || block.timestamp >= _terms.fundingDeadline) revert InvalidState();
        if (amount == 0 || amount > _terms.raiseAmount - fundingEscrow) revert InvalidAmount();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert InvalidAmount();
        fundingEscrow += amount;
        _mint(msg.sender, amount);
        emit Deposited(msg.sender, amount, fundingEscrow);
    }

    function activateFactoryOnly() external onlyFactory nonReentrant {
        if (
            phase != SliceTypes.Phase.Funding || fundingEscrow != _terms.raiseAmount
                || block.timestamp >= _terms.fundingDeadline
        ) revert InvalidState();
        uint256 first = Math.mulDiv(_terms.raiseAmount, _terms.firstReleaseBps, 10_000);
        if (first == 0) revert InvalidAmount();
        phase = SliceTypes.Phase.Active;
        activationTime = uint64(block.timestamp);
        fundingEscrow = 0;
        releasedPrincipal = first;
        undrawnPrincipal = _terms.raiseAmount - first;
        asset.safeTransfer(raiseRecipient, first);
        emit Activated(issuer, first, undrawnPrincipal, effectiveRevenueCap());
    }

    function releaseSecondFactoryOnly(bytes32 evidenceHash) external onlyFactory nonReentrant {
        if (
            phase != SliceTypes.Phase.Active || defaultedAt != 0 || undrawnPrincipal == 0
                || block.timestamp < _terms.secondReleaseNotBefore || block.timestamp >= _terms.secondReleaseDeadline
        ) revert InvalidState();
        uint256 amount = undrawnPrincipal;
        undrawnPrincipal = 0;
        releasedPrincipal += amount;
        releaseNonce++;
        asset.safeTransfer(raiseRecipient, amount);
        emit PrincipalReleased(amount, releasedPrincipal, effectiveRevenueCap(), evidenceHash);
    }

    function expireUndrawn() external nonReentrant {
        if (phase != SliceTypes.Phase.Active || block.timestamp < _terms.secondReleaseDeadline) revert TooEarly();
        _recoverUndrawn();
    }

    function _recoverUndrawn() private {
        uint256 amount = undrawnPrincipal;
        if (amount == 0) return;
        undrawnPrincipal = 0;
        principalRecovery += amount;
        pool += amount;
        emit UndrawnRecovered(amount, principalRecovery);
    }

    function cancelFundingFromRouter() external onlyRouter nonReentrant {
        if (phase != SliceTypes.Phase.Funding || block.timestamp < _terms.fundingDeadline) revert InvalidState();
        phase = SliceTypes.Phase.Cancelled;
        stakeReturnCredit += stakeHeld;
        stakeHeld = 0;
        emit FundingCancelled(fundingEscrow, stakeReturnCredit);
    }

    function refund(uint256 amount, address to) external nonReentrant {
        if (phase != SliceTypes.Phase.Cancelled) revert InvalidState();
        _validPayment(amount, to);
        _burn(msg.sender, amount);
        fundingEscrow -= amount;
        asset.safeTransfer(to, amount);
        emit Refunded(msg.sender, to, amount);
    }

    function onRepayment(uint256 amount) external onlyRouter nonReentrant {
        if (phase != SliceTypes.Phase.Active || amount == 0 || amount > remainingRevenueCap()) revert InvalidState();
        // Direct donations are surplus; this authenticated callback is the only revenue-credit entry.
        if (asset.balanceOf(address(this)) < accountedBalance() + amount) revert InvalidAmount();
        totalRevenueCollected += amount;
        pool += amount;
        emit RevenueReceived(amount, totalRevenueCollected, pool);
    }

    function finalizeCollection(SliceTypes.CloseReason reason) external onlyRouter nonReentrant {
        if (phase != SliceTypes.Phase.Active || reason == SliceTypes.CloseReason.None) revert InvalidState();
        if (reason == SliceTypes.CloseReason.RevenueCap && remainingRevenueCap() != 0) revert InvalidState();
        if (reason == SliceTypes.CloseReason.Maturity && block.timestamp < _terms.maturity) revert TooEarly();
        _recoverUndrawn();
        closeReason = reason;
        collectionClosedAt = uint64(block.timestamp);
        collectionClosedBlock = block.number;
        if (adapter == SliceTypes.Adapter.Watched) {
            phase = SliceTypes.Phase.Closing;
            settleAfter = uint64(block.timestamp) + REPORT_GRACE;
        } else {
            _finishSettlement();
        }
        emit CollectionClosed(reason, collectionClosedAt, settleAfter, pool);
    }

    function markDefault(bytes32 evidenceHash) external nonReentrant {
        if (msg.sender != covenant || adapter != SliceTypes.Adapter.Watched) revert Unauthorized();
        if (defaultedAt != 0) return;
        if (phase != SliceTypes.Phase.Active && !(phase == SliceTypes.Phase.Closing && block.timestamp < settleAfter)) {
            revert InvalidState();
        }
        defaultedAt = uint64(block.timestamp);
        defaultEvidenceHash = evidenceHash;
        _recoverUndrawn();
        uint256 amount = stakeHeld;
        stakeHeld = 0;
        stakeRecovery += amount;
        pool += amount;
        emit DefaultRecorded(evidenceHash, amount);
    }

    function finalizeSettlement() external nonReentrant {
        if (phase == SliceTypes.Phase.Closed) return;
        if (phase != SliceTypes.Phase.Closing || block.timestamp < settleAfter) revert TooEarly();
        _finishSettlement();
    }

    function _finishSettlement() private {
        phase = SliceTypes.Phase.Closed;
        stakeReturnCredit += stakeHeld;
        stakeHeld = 0;
        emit SettlementFinalized(pool, totalSupply(), stakeReturnCredit);
    }

    /// @notice Burn claims for a pro-rata share of the pool collected so far. Allowed while revenue is still
    /// being collected: the pool only grows, so a leaver takes today's share and remaining holders keep a
    /// proportional claim on later revenue, recovered principal and any slashed stake. The last claim
    /// cannot be burned before the bond is Closed, so no inflow can land in a pool nobody owns.
    function redeem(uint256 tokens, address to) external nonReentrant returns (uint256 amount) {
        SliceTypes.Phase p = phase;
        if (p != SliceTypes.Phase.Active && p != SliceTypes.Phase.Closing && p != SliceTypes.Phase.Closed) {
            revert InvalidState();
        }
        _validPayment(tokens, to);
        uint256 supply = totalSupply();
        if (tokens == supply && p != SliceTypes.Phase.Closed) revert LastHolderWaitsForClose();
        amount = tokens == supply ? pool : Math.mulDiv(tokens, pool, supply);
        if (pool != 0 && amount == 0) revert InvalidAmount();
        _burn(msg.sender, tokens);
        pool -= amount;
        totalRedeemed += amount;
        if (amount != 0) asset.safeTransfer(to, amount);
        emit Redeemed(msg.sender, to, tokens, amount);
    }

    /// @notice USDC a holder would receive per 1e6 claim units if they redeemed now.
    function backingPerToken() external view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? 0 : Math.mulDiv(pool, 1e6, supply);
    }

    function claimStake(address to, uint256 amount) external nonReentrant {
        if (msg.sender != issuer) revert Unauthorized();
        _validPayment(amount, to);
        if (amount > stakeReturnCredit) revert InvalidAmount();
        stakeReturnCredit -= amount;
        asset.safeTransfer(to, amount);
        emit StakeClaimed(to, amount);
    }

    function _validPayment(uint256 amount, address to) private view {
        if (amount == 0 || to == address(0) || to == address(this) || to == router) revert InvalidAmount();
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (
            from != address(0) && to != address(0)
                && (phase == SliceTypes.Phase.Funding || phase == SliceTypes.Phase.Cancelled)
        ) revert TransferLocked();
        super._update(from, to, amount);
    }
}
