// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SliceBond} from "./SliceBond.sol";
import {SliceFactory} from "./SliceFactory.sol";
import {SliceTypes} from "./SliceTypes.sol";

/// @notice Realized-backing credit vault. Withdrawals use idle cash; claims are held to settlement.
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

    SliceFactory public immutable factory;
    address public immutable owner;
    address public curator;
    address public pendingCurator;
    uint256 public curatorChangeAfter;
    address[] private _holdings;
    mapping(address => uint256) private _indexPlusOne;

    event Allocated(address indexed bond, uint256 assets);
    event Collected(address indexed bond, uint256 claims, uint256 assets);
    event RaiseWithdrawn(address indexed bond, uint256 assets);
    event CuratorProposed(address indexed curator, uint256 executableAt);
    event CuratorChanged(address indexed previousCurator, address indexed curator);

    constructor(IERC20 asset_, SliceFactory factory_, address owner_, address curator_)
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
    function holdingValue(address bond) public view returns (uint256) {
        if (_indexPlusOne[bond] == 0) return 0;
        SliceBond b = SliceBond(bond);
        uint256 claims = b.balanceOf(address(this));
        if (claims == 0) return 0;
        SliceTypes.Phase p = b.phase();
        if (p == SliceTypes.Phase.Funding || p == SliceTypes.Phase.Cancelled) return claims;
        return Math.mulDiv(claims, b.pool(), b.totalSupply());
    }

    function totalAssets() public view override returns (uint256 value) {
        value = idleAssets();
        for (uint256 i; i < _holdings.length; ++i) {
            value += holdingValue(_holdings[i]);
        }
    }

    /// @notice Entry windows exclude all holdings with unsettled future revenue rights, even at zero NAV.
    function depositsOpen() public view returns (bool) {
        for (uint256 i; i < _holdings.length; ++i) {
            SliceBond b = SliceBond(_holdings[i]);
            SliceTypes.Phase p = b.phase();
            if ((p == SliceTypes.Phase.Active || p == SliceTypes.Phase.Closing) && b.balanceOf(address(this)) != 0) {
                return false;
            }
        }
        return true;
    }

    function maxDeposit(address) public view override returns (uint256) {
        return depositsOpen() ? type(uint256).max : 0;
    }

    function maxMint(address) public view override returns (uint256) {
        return depositsOpen() ? type(uint256).max : 0;
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
        SliceBond b = SliceBond(bond);
        if (address(b.asset()) != asset()) revert WrongAsset();
        if (b.phase() != SliceTypes.Phase.Funding) revert InvalidState();
        if (!factory.depositAllowed(bond)) revert Unhealthy();
        if (amount == 0) revert InvalidAmount();
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
        IERC20(asset()).forceApprove(bond, 0);
        emit Allocated(bond, amount);
    }

    function withdrawFromRaise(address bond, uint256 amount) external onlyCurator nonReentrant {
        if (_indexPlusOne[bond] == 0) revert InvalidBond();
        SliceBond b = SliceBond(bond);
        if (b.phase() != SliceTypes.Phase.Funding) revert InvalidState();
        b.withdraw(amount, address(this));
        if (b.balanceOf(address(this)) == 0) _remove(bond);
        emit RaiseWithdrawn(bond, amount);
    }

    /// @notice Never burn Active/Closing claims, including defaulted ones. Finalize settlement separately.
    function collect(address bond) external onlyCurator nonReentrant returns (uint256 assets) {
        if (_indexPlusOne[bond] == 0) revert InvalidBond();
        SliceBond b = SliceBond(bond);
        uint256 claims = b.balanceOf(address(this));
        SliceTypes.Phase p = b.phase();
        if (p == SliceTypes.Phase.Cancelled) {
            assets = claims;
            b.refund(claims, address(this));
        } else if (p == SliceTypes.Phase.Closed) {
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
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override nonReentrant {
        if (assets == 0 || shares == 0) revert InvalidAmount();
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
        super._withdraw(caller, receiver, holder, assets, shares);
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
}
