// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice TEST ONLY: an 18-decimal quote asset without permit (like WETH or WMON).
contract MockToken18 is ERC20 {
    constructor() ERC20("LOCAL TEST WRAPPED", "testWETH") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @dev Simulates a downward rebase on one holder.
    function rebaseDown(address holder, uint256 amount) external {
        _burn(holder, amount);
    }
}
