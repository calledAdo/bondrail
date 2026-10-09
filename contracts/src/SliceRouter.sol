// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SliceTypes, ISliceBond} from "./SliceTypes.sol";

contract SliceRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Unauthorized();
    error WrongBond();
    error InvalidState();
    error InvalidAmount();
    bool private initialized;
    IERC20 public asset;
    address public factory;
    address public issuer;
    address public payout;
    address public activeBond;
    uint256 public issuerCredit;
    uint256 public splitRemainder;
    event Attached(address indexed bond);
    event Detached(address indexed bond);
    event Swept(address indexed bond, uint256 gross, uint256 investorAmount, uint256 issuerAmount, uint256 remainder);
    event IssuerWithdrawal(address indexed to, uint256 amount);

    constructor() {
        initialized = true;
    }

    function initialize(address asset_, address issuer_, address payout_) external {
        if (
            initialized || asset_ == address(0) || issuer_ == address(0) || payout_ == address(0)
                || payout_ == address(this)
        ) revert InvalidState();
        initialized = true;
        factory = msg.sender;
        asset = IERC20(asset_);
        issuer = issuer_;
        payout = payout_;
    }

    function attach(address bond) external nonReentrant {
        if (msg.sender != factory) revert Unauthorized();
        if (activeBond != address(0) || bond == address(0)) revert WrongBond();
        _creditIdle();
        activeBond = bond;
        splitRemainder = 0;
        emit Attached(bond);
    }

    function flushFunding(address expectedBond) external nonReentrant {
        if (msg.sender != factory) revert Unauthorized();
        _expected(expectedBond);
        if (ISliceBond(expectedBond).phase() != SliceTypes.Phase.Funding) revert InvalidState();
        _creditIdle();
        splitRemainder = 0;
    }

    function sweep() external nonReentrant {
        address bond = activeBond;
        if (bond == address(0) || ISliceBond(bond).phase() == SliceTypes.Phase.Funding) {
            _creditIdle();
            return;
        }
        bool capReached = _collect(bond);
        if (capReached) _close(bond, SliceTypes.CloseReason.RevenueCap);
    }

    function closeBondAtMaturity(address expectedBond) external nonReentrant {
        // Historical retries never operate on the Router's new attachment.
        SliceTypes.Phase p = ISliceBond(expectedBond).phase();
        if (p == SliceTypes.Phase.Closing || p == SliceTypes.Phase.Closed) return;
        _expected(expectedBond);
        if (block.timestamp < ISliceBond(expectedBond).maturity()) revert InvalidState();
        bool capReached = _collect(expectedBond);
        _close(expectedBond, capReached ? SliceTypes.CloseReason.RevenueCap : SliceTypes.CloseReason.Maturity);
    }

    function cancelFunding(address expectedBond) external nonReentrant {
        if (ISliceBond(expectedBond).phase() == SliceTypes.Phase.Cancelled) return;
        _expected(expectedBond);
        _creditIdle();
        ISliceBond(expectedBond).cancelFundingFromRouter();
        _detach(expectedBond);
    }

    function _collect(address bond) private returns (bool) {
        ISliceBond b = ISliceBond(bond);
        if (b.phase() != SliceTypes.Phase.Active) revert InvalidState();
        uint256 gross = asset.balanceOf(address(this)) - issuerCredit;
        uint256 bps = b.revenueBps();
        uint256 quotient = Math.mulDiv(gross, bps, 10_000);
        uint256 remainder = mulmod(gross, bps, 10_000) + splitRemainder;
        uint256 candidate = quotient + remainder / 10_000;
        splitRemainder = remainder % 10_000;
        uint256 remaining = b.remainingRevenueCap();
        uint256 toBond = Math.min(candidate, remaining);
        issuerCredit += gross - toBond;
        if (toBond != 0) {
            uint256 beforeBalance = asset.balanceOf(bond);
            asset.safeTransfer(bond, toBond);
            if (asset.balanceOf(bond) - beforeBalance != toBond) revert InvalidAmount();
            b.onRepayment(toBond);
        }
        emit Swept(bond, gross, toBond, gross - toBond, splitRemainder);
        return toBond == remaining;
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

    function _creditIdle() private {
        uint256 gross = asset.balanceOf(address(this)) - issuerCredit;
        issuerCredit += gross;
        if (gross != 0) emit Swept(activeBond, gross, 0, gross, 0);
    }

    function withdrawIssuerCredit(address to, uint256 amount) external nonReentrant {
        if (msg.sender != issuer) revert Unauthorized();
        if (to == address(0) || to == address(this) || to == activeBond || amount == 0 || amount > issuerCredit) {
            revert InvalidAmount();
        }
        issuerCredit -= amount;
        asset.safeTransfer(to, amount);
        emit IssuerWithdrawal(to, amount);
    }
}
