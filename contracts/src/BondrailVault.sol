// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BondrailBond} from "./BondrailBond.sol";
import {BondrailFactory} from "./BondrailFactory.sol";
import {BondrailTypes} from "./BondrailTypes.sol";

/// @notice Carried-cost credit vault with separate entry/exit NAV and seven-day income vesting.
/// @dev Requires an exact-transfer, non-rebasing asset. Limits apply at allocation time, not to exits.
contract BondrailVault is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;

    error Unauthorized();
    error InvalidConfiguration();
    error InvalidBond();
    error WrongAsset();
    error Unhealthy();
    error InvalidState();
    error InvalidAmount();
    error BondLimit();
    error ConcentrationLimit();
    error IdleBuffer();
    error TooEarly();

    uint256 public constant MAX_BOND_BPS = 2500;
    uint256 public constant MAX_BONDS = 16;
    uint256 public constant MIN_IDLE_BPS = 2000;
    uint256 public constant CURATOR_DELAY = 2 days;
    uint256 public constant WRITEDOWN_PERIOD = 30 days;
    uint256 public constant INCOME_VESTING_PERIOD = 7 days;

    BondrailFactory public immutable factory;
    address public immutable owner;
    address public curator;
    address public pendingCurator;
    uint256 public curatorChangeAfter;
    address[] private _holdings;
    mapping(address => uint256) private _indexPlusOne;
    mapping(address => uint256) public costBasis;
    mapping(address => uint256) private _profitAccounted;
    uint256 public lockedIncome;
    uint256 public incomeVestingStart;

    event Allocated(address indexed bond, uint256 assets);
    event Collected(address indexed bond, uint256 claims, uint256 assets);
    event RaiseWithdrawn(address indexed bond, uint256 assets);
    event CuratorProposed(address indexed curator, uint256 executableAt);
    event CuratorChanged(address indexed previousCurator, address indexed curator);
    event IncomeCheckpointed(uint256 newIncome, uint256 lockedIncome);

    constructor(IERC20 asset_, BondrailFactory factory_, address owner_, address curator_)
        ERC20("Bondrail Credit", "brCREDIT")
        ERC4626(asset_)
    {
        if (
            address(asset_).code.length == 0 || address(factory_).code.length == 0 || owner_ == address(0)
                || curator_ == address(0) || IERC20Metadata(address(asset_)).decimals() > 249
        ) revert InvalidConfiguration();
        factory = factory_;
        owner = owner_;
        curator = curator_;
        emit CuratorChanged(address(0), curator_);
    }

    modifier onlyCurator() {
        if (msg.sender != curator) revert Unauthorized();
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    /// @notice Replacing a proposal restarts the full delay. The owner has no fund-transfer powers.
    function proposeCurator(address next) external onlyOwner {
        if (next == address(0)) revert InvalidConfiguration();
        pendingCurator = next;
        curatorChangeAfter = block.timestamp + CURATOR_DELAY;
        emit CuratorProposed(next, curatorChangeAfter);
    }

    function acceptCurator() external onlyOwner {
        address next = pendingCurator;
        if (next == address(0)) revert InvalidState();
        if (block.timestamp < curatorChangeAfter) revert TooEarly();
        address previous = curator;
        curator = next;
        delete pendingCurator;
        delete curatorChangeAfter;
        emit CuratorChanged(previous, next);
    }

    function holdings() external view returns (address[] memory) {
        return _holdings;
    }

    function idleAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /// @notice Untracked token gifts are excluded. Pool value is backing, not immediately available cash.
    function holdingRealizedValue(address bond) public view returns (uint256) {
        if (_indexPlusOne[bond] == 0) return 0;
        BondrailBond b = BondrailBond(bond);
        uint256 claims = b.balanceOf(address(this));
        if (claims == 0) return 0;
        BondrailTypes.Phase p = b.phase();
        if (p == BondrailTypes.Phase.Funding || p == BondrailTypes.Phase.Cancelled) return claims;
        return Math.mulDiv(claims, b.pool(), b.totalSupply());
    }

    /// @notice Exit carrying value before the vault-wide income vesting deduction.
    function holdingValue(address bond) public view returns (uint256) {
        (, uint256 exitValue) = _holdingValues(bond);
        return exitValue;
    }

    /// @notice Entry carrying value ignores trigger/default impairment, but not settlement losses.
    function holdingEntryValue(address bond) public view returns (uint256) {
        (uint256 entryValue,) = _holdingValues(bond);
        return entryValue;
    }

    /// @notice Current claims' pro-rata cumulative pool inflows, including principal and stake recovery.
    function holdingRecovered(address bond) public view returns (uint256) {
        if (_indexPlusOne[bond] == 0) return 0;
        BondrailBond b = BondrailBond(bond);
        uint256 claims = b.balanceOf(address(this));
        if (claims == 0) return 0;
        return
            Math.mulDiv(claims, b.totalRevenueCollected() + b.principalRecovery() + b.stakeRecovery(), b.totalSupply());
    }

    function _holdingValues(address bond) private view returns (uint256 entryValue, uint256 exitValue) {
        uint256 realized = holdingRealizedValue(bond);
        if (_indexPlusOne[bond] == 0) return (0, 0);
        BondrailBond b = BondrailBond(bond);
        if (b.phase() != BondrailTypes.Phase.Active) return (realized, realized);
        uint256 claims = b.balanceOf(address(this));
        if (claims == 0) return (0, 0);
        uint256 unrecovered = costBasis[bond] - Math.min(costBasis[bond], holdingRecovered(bond));
        // The revenue cap scales with released principal. Undrawn/refunded principal and slashed
        // stake are separate backing. Remove receipts already paid to other redeeming holders.
        uint256 ceiling = Math.mulDiv(
            claims,
            b.effectiveRevenueCap() + b.undrawnPrincipal() + b.principalRecovery() + b.stakeRecovery()
                - b.totalRedeemed(),
            b.totalSupply()
        );
        entryValue = Math.min(realized + unrecovered, ceiling);
        uint256 start = b.defaultedAt();
        uint256 maturity = b.maturity();
        // A late default must not restart a maturity writedown.
        if (block.timestamp >= maturity && (start == 0 || maturity < start)) start = maturity;
        if (start != 0) {
            uint256 elapsed = Math.min(block.timestamp - start, WRITEDOWN_PERIOD);
            unrecovered = Math.mulDiv(unrecovered, WRITEDOWN_PERIOD - elapsed, WRITEDOWN_PERIOD);
        } else if (b.triggered()) {
            unrecovered /= 2;
        }
        exitValue = Math.min(realized + unrecovered, ceiling);
    }

    /// @notice Conservative exit NAV. convertToAssets/convertToShares and exit previews use this rate.
    function totalAssets() public view override returns (uint256) {
        return _nav(false);
    }

    /// @notice Entry NAV excludes unrealized impairments. Use entry previews for deposits/mints.
    function entryAssets() public view returns (uint256) {
        return _nav(true);
    }

    function _nav(bool entry) private view returns (uint256 value) {
        value = idleAssets();
        for (uint256 i; i < _holdings.length; ++i) {
            (uint256 entryValue, uint256 exitValue) = _holdingValues(_holdings[i]);
            value += entry ? entryValue : exitValue;
        }
        return value - unvestedIncome();
    }

    function previewDeposit(uint256 assets) public view override returns (uint256) {
        return Math.mulDiv(assets, totalSupply() + 10 ** _decimalsOffset(), entryAssets() + 1);
    }

    function previewMint(uint256 shares) public view override returns (uint256) {
        return Math.mulDiv(shares, entryAssets() + 1, totalSupply() + 10 ** _decimalsOffset(), Math.Rounding.Ceil);
    }

    function _remainingLockedIncome() private view returns (uint256) {
        uint256 elapsed = Math.min(block.timestamp - incomeVestingStart, INCOME_VESTING_PERIOD);
        return Math.mulDiv(lockedIncome, INCOME_VESTING_PERIOD - elapsed, INCOME_VESTING_PERIOD, Math.Rounding.Ceil);
    }

    function _newIncome(address bond) private view returns (uint256) {
        uint256 realized = holdingRealizedValue(bond);
        uint256 profit = realized - Math.min(realized, costBasis[bond]);
        return profit - Math.min(profit, _profitAccounted[bond]);
    }

    /// @notice Includes uncheckpointed profit, which remains entirely locked until observed in a write.
    function unvestedIncome() public view returns (uint256 value) {
        value = _remainingLockedIncome();
        for (uint256 i; i < _holdings.length; ++i) {
            value += _newIncome(_holdings[i]);
        }
    }

    /// @notice Permissionless. New profit restarts seven days for the combined unvested remainder.
    /// No new profit means no reset. Collection/removal of a holding never unlocks its profit early.
    function checkpointIncome() external nonReentrant {
        _checkpointIncome();
    }

    function _checkpointIncome() private {
        uint256 income;
        for (uint256 i; i < _holdings.length; ++i) {
            address bond = _holdings[i];
            uint256 added = _newIncome(bond);
            _profitAccounted[bond] += added;
            income += added;
        }
        if (income == 0) return;
        lockedIncome = _remainingLockedIncome() + income;
        incomeVestingStart = block.timestamp;
        emit IncomeCheckpointed(income, lockedIncome);
    }

    function maxWithdraw(address holder) public view override returns (uint256) {
        return Math.min(convertToAssets(balanceOf(holder)), idleAssets());
    }

    function maxRedeem(address holder) public view override returns (uint256) {
        uint256 shares = balanceOf(holder);
        uint256 idle = idleAssets();
        if (convertToAssets(shares) > idle) shares = Math.min(shares, convertToShares(idle));
        return convertToAssets(shares) == 0 ? 0 : shares;
    }

    function allocate(address bond, uint256 amount) external onlyCurator nonReentrant {
        if (!factory.isBond(bond)) revert InvalidBond();
        BondrailBond b = BondrailBond(bond);
        if (address(b.asset()) != asset()) revert WrongAsset();
        if (b.phase() != BondrailTypes.Phase.Funding) revert InvalidState();
        if (!factory.depositAllowed(bond)) revert Unhealthy();
        if (amount == 0) revert InvalidAmount();
        _checkpointIncome();
        uint256 nav = totalAssets();
        if (holdingValue(bond) + amount > Math.mulDiv(nav, MAX_BOND_BPS, 10_000)) {
            revert ConcentrationLimit();
        }
        uint256 idle = idleAssets();
        if (amount > idle || idle - amount < Math.mulDiv(nav, MIN_IDLE_BPS, 10_000, Math.Rounding.Ceil)) {
            revert IdleBuffer();
        }
        if (_indexPlusOne[bond] == 0) {
            if (_holdings.length == MAX_BONDS) revert BondLimit();
            _holdings.push(bond);
            _indexPlusOne[bond] = _holdings.length;
        }
        IERC20(asset()).forceApprove(bond, amount);
        b.deposit(amount);
        costBasis[bond] += amount;
        IERC20(asset()).forceApprove(bond, 0);
        emit Allocated(bond, amount);
    }

    function withdrawFromRaise(address bond, uint256 amount) external onlyCurator nonReentrant {
        if (_indexPlusOne[bond] == 0) revert InvalidBond();
        BondrailBond b = BondrailBond(bond);
        if (b.phase() != BondrailTypes.Phase.Funding) revert InvalidState();
        _checkpointIncome();
        costBasis[bond] -= Math.mulDiv(costBasis[bond], amount, b.balanceOf(address(this)));
        b.withdraw(amount, address(this));
        if (b.balanceOf(address(this)) == 0) _remove(bond);
        emit RaiseWithdrawn(bond, amount);
    }

    /// @notice Never burn Active/Closing claims, including defaulted ones. Finalize settlement separately.
    function collect(address bond) external onlyCurator nonReentrant returns (uint256 assets) {
        if (_indexPlusOne[bond] == 0) revert InvalidBond();
        _checkpointIncome();
        BondrailBond b = BondrailBond(bond);
        uint256 claims = b.balanceOf(address(this));
        BondrailTypes.Phase p = b.phase();
        if (p == BondrailTypes.Phase.Cancelled) {
            assets = claims;
            b.refund(claims, address(this));
        } else if (p == BondrailTypes.Phase.Closed) {
            assets = b.redeem(claims, address(this));
        } else {
            revert InvalidState();
        }
        _remove(bond);
        emit Collected(bond, claims, assets);
    }

    function _remove(address bond) private {
        uint256 index = _indexPlusOne[bond] - 1;
        address last = _holdings[_holdings.length - 1];
        _holdings[index] = last;
        _indexPlusOne[last] = index + 1;
        _holdings.pop();
        delete _indexPlusOne[bond];
        delete costBasis[bond];
        delete _profitAccounted[bond];
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        if (assets == 0 || shares == 0) revert InvalidAmount();
        _checkpointIncome(); // Same NAV as the preview: newly seen income was already excluded.
        uint256 beforeBalance = idleAssets();
        super._deposit(caller, receiver, assets, shares);
        if (idleAssets() - beforeBalance != assets) revert InvalidAmount();
    }

    function _withdraw(address caller, address receiver, address holder, uint256 assets, uint256 shares)
        internal
        override
        nonReentrant
    {
        if (assets == 0 || shares == 0) revert InvalidAmount();
        _checkpointIncome();
        super._withdraw(caller, receiver, holder, assets, shares);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
