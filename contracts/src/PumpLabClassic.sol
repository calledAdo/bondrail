// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISliceAccount} from "./SliceTypes.sol";

contract LaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address holder) ERC20(name_, symbol_) {
        _mint(holder, 1_000_000_000e18);
    }
}

/// @notice Locked tier demo: an ordinary owner-administered launchpad that pays fees to a recipient
/// address. Under Slice its owner is a FeeGuard, which refuses recipient, rate and ownership changes.
contract PumpLabClassic is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Unauthorized();
    error InvalidTrade();
    error Slippage();
    IERC20 public immutable asset;
    LaunchToken public immutable token;
    address public owner;
    address public feeRecipient;
    uint16 public feeBps = 100;
    uint16 public maxNameLength;
    uint256 public virtualUSDC = 1000e6;
    uint256 public virtualToken = 1_073_000_000e18;
    uint256 public realUSDC;
    uint256 public realToken = 1_000_000_000e18;
    uint256 public constant MIN_TRADE = 100;
    event Trade(
        address indexed payer,
        bool isBuy,
        uint256 tokenAmount,
        uint256 grossUSDC,
        uint256 fee,
        address indexed recipient
    );
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event NameLengthChanged(uint16 value);
    event FeeRecipientChanged(address recipient);
    event FeeBpsChanged(uint16 bps);

    constructor(address asset_, address recipient_, string memory name_, string memory symbol_, uint16 maxNameLength_) {
        if (
            asset_ == address(0) || recipient_ == address(0) || maxNameLength_ < 8 || maxNameLength_ > 128
                || bytes(name_).length > maxNameLength_
        ) revert InvalidTrade();
        asset = IERC20(asset_);
        feeRecipient = recipient_;
        owner = msg.sender;
        maxNameLength = maxNameLength_;
        token = new LaunchToken(name_, symbol_, address(this));
    }

    function transferOwnership(address next) external {
        if (msg.sender != owner || next == address(0)) revert Unauthorized();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }

    function setMaxNameLength(uint16 length) external {
        if (msg.sender != owner || length < 8 || length > 128) revert Unauthorized();
        maxNameLength = length;
        emit NameLengthChanged(length);
    }

    /// @notice Ordinary launchpad admin. Once a FeeGuard owns this contract these are unreachable:
    /// the guard refuses both selectors, so the fee stream cannot be redirected or cut while a bond is live.
    function setFeeRecipient(address recipient) external {
        if (msg.sender != owner || recipient == address(0)) revert Unauthorized();
        feeRecipient = recipient;
        emit FeeRecipientChanged(recipient);
    }

    function setFeeBps(uint16 bps) external {
        if (msg.sender != owner || bps > 1000) revert Unauthorized();
        feeBps = bps;
        emit FeeBpsChanged(bps);
    }

    function quoteBuy(uint256 gross) public view returns (uint256 out, uint256 fee) {
        fee = Math.ceilDiv(gross * feeBps, 10_000);
        if (gross <= fee) return (0, fee);
        uint256 newY = Math.mulDiv(virtualUSDC, virtualToken, virtualUSDC + gross - fee, Math.Rounding.Ceil);
        out = virtualToken - newY;
    }

    function quoteSell(uint256 amount) public view returns (uint256 net, uint256 fee, uint256 gross) {
        uint256 newX = Math.mulDiv(virtualUSDC, virtualToken, virtualToken + amount, Math.Rounding.Ceil);
        gross = virtualUSDC - newX;
        fee = Math.ceilDiv(gross * feeBps, 10_000);
        net = gross - fee;
    }

    function buy(uint256 gross, uint256 minTokensOut, uint64 deadline) external nonReentrant returns (uint256 out) {
        if (block.timestamp > deadline || gross < MIN_TRADE) revert InvalidTrade();
        uint256 fee;
        (out, fee) = quoteBuy(gross);
        if (out == 0 || out > realToken) revert InvalidTrade();
        if (out < minTokensOut) revert Slippage();
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), gross);
        if (asset.balanceOf(address(this)) - beforeBalance != gross) revert InvalidTrade();
        virtualUSDC += gross - fee;
        virtualToken -= out;
        realUSDC += gross - fee;
        realToken -= out;
        IERC20(address(token)).safeTransfer(msg.sender, out);
        _payFee(fee);
        emit Trade(msg.sender, true, out, gross, fee, feeRecipient);
    }

    function sell(uint256 amount, uint256 minUSDCOut, uint64 deadline) external nonReentrant returns (uint256 net) {
        if (block.timestamp > deadline || amount == 0) revert InvalidTrade();
        uint256 fee;
        uint256 gross;
        (net, fee, gross) = quoteSell(amount);
        if (gross < MIN_TRADE || gross > realUSDC || net == 0) revert InvalidTrade();
        if (net < minUSDCOut) revert Slippage();
        IERC20(address(token)).safeTransferFrom(msg.sender, address(this), amount);
        virtualToken += amount;
        virtualUSDC -= gross;
        realToken += amount;
        realUSDC -= gross;
        asset.safeTransfer(msg.sender, net);
        _payFee(fee);
        emit Trade(msg.sender, false, amount, gross, fee, feeRecipient);
    }

    function _payFee(uint256 fee) private {
        asset.safeTransfer(feeRecipient, fee);
        ISliceAccount(feeRecipient).sweep();
    }
}
