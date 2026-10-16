// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {BondrailFactory} from "./BondrailFactory.sol";
import {BondrailVault} from "./BondrailVault.sol";
import {IBondrailVaultFactory} from "./IBondrailVaultFactory.sol";

/// @dev Only display metadata changes. Allocation, custody, pricing, and delays are inherited unchanged.
contract BondrailNamedVault is BondrailVault {
    string private _vaultName;
    string private _vaultSymbol;

    constructor(
        IERC20 asset_,
        BondrailFactory factory_,
        address owner_,
        address curator_,
        string memory name_,
        string memory symbol_
    ) BondrailVault(asset_, factory_, owner_, curator_) {
        _vaultName = name_;
        _vaultSymbol = symbol_;
    }

    function name() public view override(ERC20, IERC20Metadata) returns (string memory) {
        return _vaultName;
    }

    function symbol() public view override(ERC20, IERC20Metadata) returns (string memory) {
        return _vaultSymbol;
    }
}

/// @dev Separate runtime keeps the factory below EIP-170. Only used for one-time legacy registration.
/// A fresh reference includes the exact asset, cached decimals, factory and owner immutables, plus
/// compiler metadata. A proxy or a contract with matching getters cannot pass this comparison.
contract BondrailLegacyVaultVerifier {
    function matches(BondrailVault candidate, IERC20 asset_, BondrailFactory factory_, address owner_, address curator_)
        external
        returns (bool)
    {
        BondrailVault referenceVault = new BondrailVault(asset_, factory_, owner_, curator_);
        return address(candidate).codehash == address(referenceVault).codehash;
    }
}

/// @notice Permissionless vault creation with immutable protocol binding and bounded registry reads.
/// @dev No initializer/proxy or adjustable caps: all vaults retain the original hard allocation limits.
contract BondrailVaultFactory is IBondrailVaultFactory, ReentrancyGuard {
    error Unauthorized();
    error InvalidConfiguration();
    error InvalidVault();
    error AlreadyRegistered();
    error InvalidPage();

    uint256 public constant MAX_PAGE_SIZE = 100;
    uint256 public constant MAX_STRATEGY_BYTES = 280;
    address public immutable factory;
    address public immutable owner;
    BondrailLegacyVaultVerifier private immutable _verifier;
    bool public existingRegistered;
    mapping(address => bool) public isVault;
    mapping(address => Strategy) private _strategies;
    address[] private _vaults;

    constructor(BondrailFactory factory_, address owner_) {
        if (address(factory_).code.length == 0 || owner_ == address(0)) revert InvalidConfiguration();
        factory = address(factory_);
        owner = owner_;
        _verifier = new BondrailLegacyVaultVerifier();
    }

    function createVault(
        address asset_,
        string calldata name_,
        string calldata symbol_,
        address curator_,
        address owner_,
        Strategy calldata strategy_
    ) external nonReentrant returns (address vault) {
        _checkAsset(asset_);
        if (
            bytes(name_).length == 0 || bytes(name_).length > 64 || bytes(symbol_).length == 0
                || bytes(symbol_).length > 16 || bytes(strategy_.description).length == 0
                || bytes(strategy_.description).length > MAX_STRATEGY_BYTES
        ) revert InvalidConfiguration();
        vault =
            address(new BondrailNamedVault(IERC20(asset_), BondrailFactory(factory), owner_, curator_, name_, symbol_));
        _register(vault, asset_, curator_, owner_, name_, symbol_, strategy_);
    }

    /// @notice Owner may register exactly one original BondrailVault. Failed attempts do not consume it.
    function registerExisting(address vault) external nonReentrant {
        if (msg.sender != owner) revert Unauthorized();
        if (existingRegistered || isVault[vault]) revert AlreadyRegistered();
        if (vault.code.length == 0) revert InvalidVault();
        BondrailVault v = BondrailVault(vault);
        address asset_ = v.asset();
        _checkAsset(asset_);
        if (
            address(v.factory()) != address(factory)
                || !_verifier.matches(v, IERC20(asset_), BondrailFactory(factory), v.owner(), v.curator())
        ) revert InvalidVault();
        existingRegistered = true;
        _register(
            vault,
            asset_,
            v.curator(),
            v.owner(),
            v.name(),
            v.symbol(),
            Strategy("Diversified revenue bonds under fixed allocation limits", bytes32(0))
        );
    }

    function vaultCount() external view returns (uint256) {
        return _vaults.length;
    }

    /// @notice Page size 1..100. An offset at/past the end returns an empty page.
    function vaults(uint256 offset, uint256 limit) external view returns (address[] memory page) {
        if (limit == 0 || limit > MAX_PAGE_SIZE) revert InvalidPage();
        uint256 count = offset < _vaults.length ? _vaults.length - offset : 0;
        if (count > limit) count = limit;
        page = new address[](count);
        for (uint256 i; i < count; ++i) {
            page[i] = _vaults[offset + i];
        }
    }

    function strategy(address vault) external view returns (Strategy memory) {
        return _strategies[vault];
    }

    function _checkAsset(address asset_) private view {
        // Same admission as accounts (code + decimals), plus the existing vault's six-decimal offset bound.
        if (asset_.code.length == 0 || IERC20Metadata(asset_).decimals() > 249) revert InvalidConfiguration();
    }

    function _register(
        address vault,
        address asset_,
        address curator_,
        address owner_,
        string memory name_,
        string memory symbol_,
        Strategy memory strategy_
    ) private {
        isVault[vault] = true;
        _vaults.push(vault);
        _strategies[vault] = strategy_;
        emit VaultCreated(vault, asset_, curator_, owner_, name_, symbol_, strategy_);
    }
}
