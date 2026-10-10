// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {SliceEarner} from "../../src/SliceEarner.sol";

/// @notice TEST ONLY: a Native project whose fee is whatever the caller asks for (to test the fee floor).
contract MockEarner is SliceEarner {
    constructor(address account_) SliceEarner(account_) {}

    function payIn(uint256 gross, uint256 fee) external returns (uint256) {
        return _collect(msg.sender, gross, fee);
    }

    function payOut(address to, uint256 gross, uint256 fee) external returns (uint256) {
        return _settleOut(to, gross, fee);
    }
}
