// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceAccount} from "./SliceTypes.sol";

/// @notice Locked tier: holds ownership of an existing owner-administered fee contract while its
/// business has a bond, so fees keep flowing to the SliceAccount.
///
/// Configured once, per target, by the factory:
///   - recipientGetter: view that returns the fee recipient; it must return the account
///   - feeGetter / minFee: optional view that returns the fee rate; it must stay >= minFee
///   - allowed: the only admin selectors the issuer may still call through the guard
/// Everything else (recipient, rate, ownership, upgrades, unknown calls) is refused. After every
/// allowed call the lock is re-checked, so a selector with hidden side effects cannot break it.
/// When no bond is attached, the issuer can take ownership back with `release`.
contract FeeGuard is ReentrancyGuard {
    error Unauthorized();
    error NotLocked();
    error UnsupportedCall();

    bytes4 private constant OWNER = bytes4(keccak256("owner()"));
    bytes4 private constant TRANSFER_OWNERSHIP = bytes4(keccak256("transferOwnership(address)"));
    bytes4 private constant ACCEPT_OWNERSHIP = bytes4(keccak256("acceptOwnership()"));

    address public immutable target;
    address public immutable issuer;
    address public immutable account;
    bytes4 public immutable recipientGetter;
    bytes4 public immutable feeGetter; // zero when the target has no readable fee rate
    uint256 public immutable minFee;
    mapping(bytes4 selector => bool) public allowed;
    bool public released;

    event Executed(bytes4 indexed selector);
    event Released(address indexed issuer);

    constructor(
        address target_,
        address issuer_,
        address account_,
        bytes4 recipientGetter_,
        bytes4 feeGetter_,
        uint256 minFee_,
        bytes4[] memory allowed_
    ) {
        if (target_.code.length == 0 || issuer_ == address(0) || account_ == address(0) || recipientGetter_ == 0) {
            revert Unauthorized();
        }
        target = target_;
        issuer = issuer_;
        account = account_;
        recipientGetter = recipientGetter_;
        feeGetter = feeGetter_;
        minFee = minFee_;
        for (uint256 i; i < allowed_.length; i++) {
            bytes4 s = allowed_[i];
            // Ownership moves are never delegable through the guard.
            if (s == TRANSFER_OWNERSHIP || s == ACCEPT_OWNERSHIP || s == bytes4(0)) revert UnsupportedCall();
            allowed[s] = true;
        }
    }

    /// @notice True while the guard owns the target, fees go to the account and the rate is at least minFee.
    function isLocked() public view returns (bool) {
        if (released) return false;
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSelector(OWNER));
        if (!ok || ret.length < 32 || abi.decode(ret, (address)) != address(this)) return false;
        (ok, ret) = target.staticcall(abi.encodeWithSelector(recipientGetter));
        if (!ok || ret.length < 32 || abi.decode(ret, (address)) != account) return false;
        if (feeGetter != bytes4(0)) {
            (ok, ret) = target.staticcall(abi.encodeWithSelector(feeGetter));
            if (!ok || ret.length < 32 || abi.decode(ret, (uint256)) < minFee) return false;
        }
        return true;
    }

    /// @notice Issuer-only passthrough for allowlisted admin calls.
    function execute(bytes calldata data) external nonReentrant returns (bytes memory) {
        if (msg.sender != issuer) revert Unauthorized();
        if (data.length < 4 || !allowed[bytes4(data[:4])]) revert UnsupportedCall();
        if (!isLocked()) revert NotLocked();
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        if (!isLocked()) revert NotLocked();
        emit Executed(bytes4(data[:4]));
        return ret;
    }

    /// @notice For two-step ownership targets: complete the handover to this guard.
    function acceptTargetOwnership() external nonReentrant {
        (bool ok,) = target.call(abi.encodeWithSelector(ACCEPT_OWNERSHIP));
        if (!ok) revert UnsupportedCall();
    }

    /// @notice Hand ownership back to the issuer once no bond is attached to the account.
    function release() external nonReentrant {
        if (msg.sender != issuer || ISliceAccount(account).activeBond() != address(0) || !isLocked()) {
            revert Unauthorized();
        }
        released = true;
        (bool ok,) = target.call(abi.encodeWithSelector(TRANSFER_OWNERSHIP, issuer));
        if (!ok) revert UnsupportedCall();
        emit Released(issuer);
    }
}
