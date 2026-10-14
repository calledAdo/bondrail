// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {BondrailEarner} from "@bondrail/BondrailEarner.sol";
import {IBondrailAccount} from "@bondrail/BondrailTypes.sol";
import {LaunchToken} from "./LaunchToken.sol";

/// @notice DEMO, Native tier: a launchpad built on Bondrail from day one (inherits BondrailEarner).
///
/// Every USDC a trader pays in or is paid out goes through the launchpad's BondrailAccount. Buys use `_collect`:
/// the account pulls the payment from the trader, keeps the 1% fee and forwards the rest here. Sells use
/// `_settleOut`: the proceeds go out through the account, which keeps the 1% fee and pays the trader.
/// The account is immutable and there is no other fee path, so fees cannot be redirected, and every
/// fee since launch is in the account's on-chain history with the trader as its proven payer.
/// Buyers approve (or permit) the account, not this contract, for USDC; sellers approve only the token.
contract PumpLab is BondrailEarner, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error InvalidTrade();
    error Slippage();

    uint16 public constant FEE_BPS = 100;
    uint256 public constant MIN_TRADE = 100;
    IERC20 public immutable asset;
    LaunchToken public immutable token;
    uint256 public virtualUSDC = 1000e6;
    uint256 public virtualToken = 1_073_000_000e18;
    uint256 public realUSDC;
    uint256 public realToken = 1_000_000_000e18;

    event Trade(address indexed trader, bool isBuy, uint256 tokenAmount, uint256 grossUSDC, uint256 fee);

    /// @dev The quote asset is the account's asset (USDC here: the virtual reserves assume 6 decimals).
    constructor(address account_, string memory name_, string memory symbol_) BondrailEarner(account_) {
        asset = IERC20(IBondrailAccount(account_).asset());
        token = new LaunchToken(name_, symbol_, address(this));
    }

    function feeBps() external pure returns (uint16) {
        return FEE_BPS;
    }

    function quoteBuy(uint256 gross) public view returns (uint256 out, uint256 fee) {
        fee = Math.ceilDiv(gross * FEE_BPS, 10_000);
        if (gross <= fee) return (0, fee);
        uint256 newY = Math.mulDiv(virtualUSDC, virtualToken, virtualUSDC + gross - fee, Math.Rounding.Ceil);
        out = virtualToken - newY;
    }

    function quoteSell(uint256 amount) public view returns (uint256 net, uint256 fee, uint256 gross) {
        uint256 newX = Math.mulDiv(virtualUSDC, virtualToken, virtualToken + amount, Math.Rounding.Ceil);
        gross = virtualUSDC - newX;
        fee = Math.ceilDiv(gross * FEE_BPS, 10_000);
        net = gross - fee;
    }

    /// @notice Buy with USDC. The account pulls `gross` from the trader, keeps the fee, sends the rest here.
    /// Needs a USDC allowance from the trader to the account.
    function buy(uint256 gross, uint256 minTokensOut, uint64 deadline) external nonReentrant returns (uint256 out) {
        return _buy(gross, minTokensOut, deadline, false, 0, 0, bytes32(0), bytes32(0));
    }

    /// @notice Buy in one transaction with an EIP-2612 permit for the account: no standing approval.
    function buyWithPermit(
        uint256 gross,
        uint256 minTokensOut,
        uint64 deadline,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 out) {
        return _buy(gross, minTokensOut, deadline, true, permitDeadline, v, r, s);
    }

    function _buy(
        uint256 gross,
        uint256 minTokensOut,
        uint64 deadline,
        bool withPermit,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) private returns (uint256 out) {
        if (block.timestamp > deadline || gross < MIN_TRADE) revert InvalidTrade();
        uint256 fee;
        (out, fee) = quoteBuy(gross);
        if (out == 0 || out > realToken) revert InvalidTrade();
        if (out < minTokensOut) revert Slippage();
        uint256 beforeBalance = asset.balanceOf(address(this));
        uint256 net = withPermit
            ? _collectWithPermit(msg.sender, gross, fee, permitDeadline, v, r, s)
            : _collect(msg.sender, gross, fee);
        if (net != gross - fee || asset.balanceOf(address(this)) - beforeBalance != net) revert InvalidTrade();
        virtualUSDC += net;
        virtualToken -= out;
        realUSDC += net;
        realToken -= out;
        IERC20(address(token)).safeTransfer(msg.sender, out);
        emit Trade(msg.sender, true, out, gross, fee);
    }

    /// @notice Sell tokens. The gross proceeds go out through the account (`_settleOut`), which keeps the
    /// fee and pays the trader the rest: the seller needs no USDC approval.
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
        _settleOut(msg.sender, gross, fee);
        emit Trade(msg.sender, false, amount, gross, fee);
    }
}
