// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISliceAccount, ISliceEarner} from "./SliceTypes.sol";

/// @notice Base for a Native project: inherit it and charge every fee through `_collect`.
///
/// The SliceAccount is fixed at deploy and cannot be changed, so the project has no way to route fees
/// anywhere else. From the first fee, the account records every payment with its proven payer, building
/// the credit history the project can later raise against. Until a bond is active the account credits
/// 100% of revenue to the business; nothing changes for the project when it starts or ends a raise.
///
/// Users approve (or permit) the account, not the project, for the payment asset.
abstract contract SliceEarner is ISliceEarner {
    error SliceAccountRequired();

    ISliceAccount private immutable _sliceAccount;

    constructor(address sliceAccount_) {
        if (sliceAccount_ == address(0)) revert SliceAccountRequired();
        _sliceAccount = ISliceAccount(sliceAccount_);
    }

    function sliceAccount() public view returns (address) {
        return address(_sliceAccount);
    }

    /// @dev Pulls `gross` from `payer`; the account keeps `fee` as revenue and sends `gross - fee` here.
    function _collect(address payer, uint256 gross, uint256 fee) internal returns (uint256 net) {
        return _sliceAccount.collect(payer, gross, fee);
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
        return _sliceAccount.collectWithPermit(payer, gross, fee, deadline, v, r, s);
    }
}
