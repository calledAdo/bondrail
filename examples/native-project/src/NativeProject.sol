// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BondrailEarner} from "@bondrail/contracts/src/BondrailEarner.sol";

/// @notice Minimal fee route, not a reviewed fundraising template.
contract NativeProject is BondrailEarner {
    constructor(address account) BondrailEarner(account) {}

    // The caller approves the account. Never accept an arbitrary payer from untrusted input.
    function pay(uint256 gross) external returns (uint256 net) {
        return _collect(msg.sender, gross, gross / 100); // 1% fee, in asset base units
    }
}
