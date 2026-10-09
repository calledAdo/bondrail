// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice LOCAL TEST ASSET ONLY. Not a substitute for the facilitator's EIP-3009 testnet asset.
contract MockUSDC is ERC20 {
    mapping(address => bool) public blocked;
    address public immutable owner;

    constructor() ERC20("LOCAL TEST USDC", "testUSDC") {
        owner = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == owner, "owner");
        _mint(to, amount);
    }

    function setBlocked(address account, bool value) external {
        require(msg.sender == owner, "owner");
        blocked[account] = value;
    }

    function _update(address from, address to, uint256 amount) internal override {
        require(!blocked[from] && !blocked[to], "blocked");
        super._update(from, to, amount);
    }
}
