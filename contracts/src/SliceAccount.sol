// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SliceTypes, ISliceBond, ISliceEarner} from "./SliceTypes.sol";

/// @notice A business's revenue address and payment entrypoint, from day one.
///
/// Each account holds one asset, chosen at creation: the token the business charges fees in (any ERC-20,
/// e.g. USDC or WETH). Its bonds raise and repay in that asset. Money arrives three ways:
///   - collect: money in. The bound Native project asks the account to pull a payment from the payer;
///     the account keeps the fee and forwards the rest to the project (payer proven by the pull).
///   - settleOut: money out. The project hands a payout to the account, which pays the payer the payout
///     minus the fee and keeps the fee (for fees charged on what the payer receives).
///   - receive: a plain transfer (an x402 settlement, or anything sent to the account), booked by sweep().
///
/// Every booked payment adds to an on-chain credit history. With no active bond (passthrough) all
/// revenue is credited to the issuer; while a bond is Active the bond's share is split off first.
contract SliceAccount is ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error WrongBond();
    error InvalidState();
    error InvalidAmount();
    error FeeBelowFloor();

    bool private initialized;
    IERC20 public asset;
    address public factory;
    address public issuer;
    /// @notice The Native project allowed to call collect (zero for Watched businesses).
    address public project;
    address public activeBond;
    /// @notice Revenue already credited to the business, withdrawable by the issuer.
    uint256 public issuerCredit;
    /// @notice Sub-unit rounding of the investor share, carried so micro-payments never round to zero.
    uint256 public splitRemainder;

    // ---- credit history, from the first payment ----
    uint256 public cumulativeRevenue;
    /// @notice Gross payment volume behind collected fees (in and out); with the fees it shows the fee rate.
    uint256 public cumulativeVolume;
    uint64 public paymentCount;
    uint64 public collectedCount;
    uint64 public uniquePayers;
    uint64 public firstRevenueAt;
    uint64 public lastRevenueAt;
    mapping(uint256 day => uint256) public revenueByDay;
    mapping(address payer => bool) public isPayer;

    event ProjectBound(address indexed project);
    /// @notice A Native payment: `outgoing` is false when the payer paid in, true when the payer was paid out.
    event Collected(address indexed payer, uint256 gross, uint256 fee, bool outgoing);
    event Revenue(
        address indexed bond, address indexed payer, uint256 amount, uint256 toBond, uint256 toIssuer, bool collected
    );
    event Attached(address indexed bond);
    event Detached(address indexed bond);
    event Withdrawal(address indexed to, uint256 amount);

    constructor() {
        initialized = true;
    }

    function initialize(address asset_, address issuer_) external {
        if (initialized || asset_ == address(0) || issuer_ == address(0)) revert InvalidState();
        initialized = true;
        factory = msg.sender;
        asset = IERC20(asset_);
        issuer = issuer_;
    }

    /// @notice One-time binding of the Native project that may pull payments through this account.
    /// The project must already point at this account (ISliceEarner), which it cannot change later.
    function bindProject(address project_) external {
        if (msg.sender != issuer) revert Unauthorized();
        _bind(project_);
    }

    /// @notice Binding done by the factory when it deploys a reviewed template for the issuer.
    function bindProjectFromFactory(address project_) external {
        if (msg.sender != factory) revert Unauthorized();
        _bind(project_);
    }

    function _bind(address project_) private {
        if (project != address(0) || project_.code.length == 0) revert InvalidState();
        if (ISliceEarner(project_).sliceAccount() != address(this)) revert InvalidState();
        project = project_;
        emit ProjectBound(project_);
    }

    // ---------------------------------------------------------------- payments in

    /// @notice Native payment: pull `gross` from `payer`, keep `fee` as revenue, forward the rest to the project.
    function collect(address payer, uint256 gross, uint256 fee) external nonReentrant returns (uint256 net) {
        return _collect(payer, gross, fee);
    }

    /// @notice Same as collect, using the payer's EIP-2612 signature instead of a standing approval.
    /// A failed permit (e.g. already used by a front-runner) is ignored; the pull then needs an allowance.
    function collectWithPermit(
        address payer,
        uint256 gross,
        uint256 fee,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 net) {
        try IERC20Permit(address(asset)).permit(payer, address(this), gross, deadline, v, r, s) {} catch {}
        return _collect(payer, gross, fee);
    }

    /// @notice Native payment out: pull `gross` from the project, pay `gross - fee` to `payer`, keep `fee`.
    /// For fees charged on what the payer receives (e.g. a sell paid in the quote asset).
    function settleOut(address payer, uint256 gross, uint256 fee) external nonReentrant returns (uint256 net) {
        _checkPayment(payer, gross, fee);
        _pull(msg.sender, gross);
        net = gross - fee;
        if (net != 0) asset.safeTransfer(payer, net);
        emit Collected(payer, gross, fee, true);
        _bookCollected(payer, gross, fee);
    }

    /// @notice Books asset that arrived by plain transfer (x402 settlements, other transfers).
    function sweep() external nonReentrant {
        uint256 amount = _unbooked();
        if (amount != 0) _book(address(0), amount, false);
    }

    function _collect(address payer, uint256 gross, uint256 fee) private returns (uint256 net) {
        _checkPayment(payer, gross, fee);
        _pull(payer, gross);
        net = gross - fee;
        if (net != 0) asset.safeTransfer(project, net);
        emit Collected(payer, gross, fee, false);
        _bookCollected(payer, gross, fee);
    }

    /// @dev Only the bound project; and while a bond is Active, the fee rate may not drop below its floor.
    function _checkPayment(address payer, uint256 gross, uint256 fee) private view {
        if (msg.sender != project || project == address(0)) revert Unauthorized();
        if (payer == address(0) || payer == address(this) || fee > gross || gross == 0) revert InvalidAmount();
        address bond = activeBond;
        if (bond != address(0) && ISliceBond(bond).phase() == SliceTypes.Phase.Active) {
            if (fee * 10_000 < gross * ISliceBond(bond).minFeeBps()) revert FeeBelowFloor();
        }
    }

    function _pull(address from, uint256 amount) private {
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(from, address(this), amount);
        if (asset.balanceOf(address(this)) - beforeBalance != amount) revert InvalidAmount();
    }

    function _bookCollected(address payer, uint256 gross, uint256 fee) private {
        cumulativeVolume += gross;
        if (fee != 0) _book(payer, fee, true);
    }

    /// @dev A token that rebases down can leave the balance below the issuer's credit: book nothing
    /// rather than revert, so payments and bond settlement keep working.
    function _unbooked() private view returns (uint256) {
        uint256 balance = asset.balanceOf(address(this));
        return balance > issuerCredit ? balance - issuerCredit : 0;
    }

    // ---------------------------------------------------------------- booking and splitting

    function _book(address payer, uint256 amount, bool collected) private {
        cumulativeRevenue += amount;
        paymentCount++;
        if (collected) {
            collectedCount++;
            if (!isPayer[payer]) {
                isPayer[payer] = true;
                uniquePayers++;
            }
        }
        revenueByDay[block.timestamp / 1 days] += amount;
        if (firstRevenueAt == 0) firstRevenueAt = uint64(block.timestamp);
        lastRevenueAt = uint64(block.timestamp);

        address bond = activeBond;
        if (bond == address(0) || ISliceBond(bond).phase() != SliceTypes.Phase.Active) {
            // Passthrough: no bond, or investors are still funding and are owed nothing yet.
            issuerCredit += amount;
            emit Revenue(bond, payer, amount, 0, amount, collected);
            return;
        }
        (uint256 toBond, bool capReached) = _split(ISliceBond(bond), amount);
        issuerCredit += amount - toBond;
        emit Revenue(bond, payer, amount, toBond, amount - toBond, collected);
        if (capReached) _close(bond, SliceTypes.CloseReason.RevenueCap);
    }

    /// @dev Investor share with a rounding carry, capped at what the bond may still collect.
    function _split(ISliceBond b, uint256 amount) private returns (uint256 toBond, bool capReached) {
        uint256 bps = b.revenueBps();
        uint256 carry = mulmod(amount, bps, 10_000) + splitRemainder;
        uint256 candidate = Math.mulDiv(amount, bps, 10_000) + carry / 10_000;
        splitRemainder = carry % 10_000;
        uint256 remaining = b.remainingRevenueCap();
        toBond = Math.min(candidate, remaining);
        if (toBond != 0) {
            uint256 beforeBalance = asset.balanceOf(address(b));
            asset.safeTransfer(address(b), toBond);
            if (asset.balanceOf(address(b)) - beforeBalance != toBond) revert InvalidAmount();
            b.onRepayment(toBond);
        }
        capReached = toBond == remaining;
    }

    // ---------------------------------------------------------------- bond lifecycle

    function attach(address bond) external nonReentrant {
        if (msg.sender != factory) revert Unauthorized();
        if (activeBond != address(0) || bond == address(0)) revert WrongBond();
        uint256 amount = _unbooked();
        if (amount != 0) _book(address(0), amount, false); // earlier receipts are passthrough revenue
        activeBond = bond;
        splitRemainder = 0;
        emit Attached(bond);
    }

    /// @notice Called by the factory right before activation: receipts during funding stay passthrough.
    function settleBeforeActivation(address expectedBond) external nonReentrant {
        if (msg.sender != factory) revert Unauthorized();
        _expected(expectedBond);
        if (ISliceBond(expectedBond).phase() != SliceTypes.Phase.Funding) revert InvalidState();
        uint256 amount = _unbooked();
        if (amount != 0) _book(address(0), amount, false);
        splitRemainder = 0;
    }

    /// @notice Anyone, at or after maturity: books pending receipts, then closes collection and detaches.
    function closeBondAtMaturity(address expectedBond) external nonReentrant {
        SliceTypes.Phase p = ISliceBond(expectedBond).phase();
        if (p == SliceTypes.Phase.Closing || p == SliceTypes.Phase.Closed) return;
        _expected(expectedBond);
        if (p != SliceTypes.Phase.Active || block.timestamp < ISliceBond(expectedBond).maturity()) {
            revert InvalidState();
        }
        uint256 amount = _unbooked();
        if (amount != 0) _book(address(0), amount, false); // may itself close on the cap
        if (activeBond == expectedBond) _close(expectedBond, SliceTypes.CloseReason.Maturity);
    }

    /// @notice Anyone, after an unfilled funding deadline: cancels the raise and detaches.
    function cancelFunding(address expectedBond) external nonReentrant {
        if (ISliceBond(expectedBond).phase() == SliceTypes.Phase.Cancelled) return;
        _expected(expectedBond);
        uint256 amount = _unbooked();
        if (amount != 0) _book(address(0), amount, false);
        ISliceBond(expectedBond).cancelFundingFromAccount();
        _detach(expectedBond);
    }

    function _close(address bond, SliceTypes.CloseReason reason) private {
        ISliceBond(bond).finalizeCollection(reason);
        _detach(bond);
    }

    function _detach(address bond) private {
        _expected(bond);
        activeBond = address(0);
        splitRemainder = 0;
        emit Detached(bond);
    }

    function _expected(address bond) private view {
        if (bond == address(0) || activeBond != bond) revert WrongBond();
    }

    // ---------------------------------------------------------------- business share out

    function withdraw(address to, uint256 amount) external nonReentrant {
        if (msg.sender != issuer) revert Unauthorized();
        if (to == address(0) || to == address(this) || to == activeBond || amount == 0 || amount > issuerCredit) {
            revert InvalidAmount();
        }
        issuerCredit -= amount;
        asset.safeTransfer(to, amount);
        emit Withdrawal(to, amount);
    }
}
