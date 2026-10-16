// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";

/// @notice Integration ABI for BondrailVault, including ERC-4626 and ERC-20 entry points.
/// @dev previewDeposit/previewMint use entry NAV; conversions and exits use exit NAV.
/// Exits are limited to idle cash. Testnet prototype, not audited.
interface IBondrailVault is IERC4626 {
    function factory() external view returns (address);
    function owner() external view returns (address);
    function curator() external view returns (address);
    function pendingCurator() external view returns (address);
    function curatorChangeAfter() external view returns (uint256);
    function MAX_BOND_BPS() external view returns (uint256);
    function MAX_BONDS() external view returns (uint256);
    function MIN_IDLE_BPS() external view returns (uint256);
    function CURATOR_DELAY() external view returns (uint256);
    function WRITEDOWN_PERIOD() external view returns (uint256);
    function INCOME_VESTING_PERIOD() external view returns (uint256);
    function costBasis(address bond) external view returns (uint256);
    function lockedIncome() external view returns (uint256);
    function incomeVestingStart() external view returns (uint256);
    function holdings() external view returns (address[] memory);
    function idleAssets() external view returns (uint256);
    function holdingRealizedValue(address bond) external view returns (uint256);
    function holdingValue(address bond) external view returns (uint256);
    function holdingEntryValue(address bond) external view returns (uint256);
    function holdingRecovered(address bond) external view returns (uint256);
    function entryAssets() external view returns (uint256);
    function unvestedIncome() external view returns (uint256);
    function checkpointIncome() external;
    function allocate(address bond, uint256 amount) external;
    function withdrawFromRaise(address bond, uint256 amount) external;
    function collect(address bond) external returns (uint256 assets);
    function proposeCurator(address next) external;
    function acceptCurator() external;
}
