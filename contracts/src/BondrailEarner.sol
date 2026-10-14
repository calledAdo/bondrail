// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBondrailAccount, IBondrailEarner} from "./BondrailTypes.sol";

/// @notice Base for a Native project: inherit it and charge every fee through the account, in the
/// account's asset: `_collect` for money coming in (the fee comes off what the payer sends) and
/// `_settleOut` for money going out (the fee comes off what the payer receives).
///
/// The BondrailAccount is fixed at deploy and cannot be changed, so the project has no way to route fees
/// anywhere else. From the first fee, the account records every payment with its proven payer, building
/// the credit history the project can later raise against. Until a bond is active the account credits
/// 100% of revenue to the business; nothing changes for the project when it starts or ends a raise.
///
/// Users approve (or permit) the account, not the project, for the payment asset.
abstract contract BondrailEarner is IBondrailEarner {
    using SafeERC20 for IERC20;

    error BondrailAccountRequired();

    IBondrailAccount private immutable _bondrailAccount;

    constructor(address bondrailAccount_) {
        if (bondrailAccount_ == address(0)) revert BondrailAccountRequired();
        _bondrailAccount = IBondrailAccount(bondrailAccount_);
    }

    function bondrailAccount() public view returns (address) {
        return address(_bondrailAccount);
    }

    /// @dev Pulls `gross` from `payer`; the account keeps `fee` as revenue and sends `gross - fee` here.
    function _collect(address payer, uint256 gross, uint256 fee) internal returns (uint256 net) {
        return _bondrailAccount.collect(payer, gross, fee);
    }

    /// @dev Pays `gross - fee` of the account's asset from this contract to `payer` through the account,
    /// which keeps `fee` as revenue. The payer approves nothing (works for sellers and non-permit tokens).
    function _settleOut(address payer, uint256 gross, uint256 fee) internal returns (uint256 net) {
        IERC20(_bondrailAccount.asset()).forceApprove(address(_bondrailAccount), gross);
        return _bondrailAccount.settleOut(payer, gross, fee);
    }

    /// @dev Same as `_collect`, using the payer's EIP-2612 permit for the account (no standing approval).
    function _collectWithPermit(
        address payer,
        uint256 gross,
        uint256 fee,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) internal returns (uint256 net) {
        return _bondrailAccount.collectWithPermit(payer, gross, fee, deadline, v, r, s);
    }
}
