// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice DEMO: the token a PumpLab launch sells. Minted once to the launchpad.
contract LaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address holder) ERC20(name_, symbol_) {
        _mint(holder, 1_000_000_000e18);
    }
}
