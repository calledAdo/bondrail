// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Integration ABI for the protocol-bound, permissionless credit vault registry.
interface IBondrailVaultFactory {
    struct Strategy {
        string description;
        bytes32 metadataHash;
    }
    event VaultCreated(
        address indexed vault,
        address indexed asset,
        address indexed curator,
        address owner,
        string name,
        string symbol,
        Strategy strategy
    );
    function createVault(
        address asset,
        string calldata name,
        string calldata symbol,
        address curator,
        address owner,
        Strategy calldata strategy
    ) external returns (address vault);
    function registerExisting(address vault) external;
    function factory() external view returns (address);
    function owner() external view returns (address);
    function isVault(address vault) external view returns (bool);
    function existingRegistered() external view returns (bool);
    function vaults(uint256 offset, uint256 limit) external view returns (address[] memory);
    function vaultCount() external view returns (uint256);
    function strategy(address vault) external view returns (Strategy memory);
    function MAX_PAGE_SIZE() external view returns (uint256);
    function MAX_STRATEGY_BYTES() external view returns (uint256);
}
