// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceAccount} from "./SliceTypes.sol";
import {PumpLabClassic} from "./PumpLabClassic.sol";

contract FeeGuard is ReentrancyGuard {
    error Unauthorized();
    error NotLocked();
    error UnsupportedCall();
    address public immutable target;
    address public immutable issuer;
    address public immutable account;
    bool public released;
    event Executed(bytes4 indexed selector);
    event Released(address indexed issuer);

    constructor(address target_, address issuer_, address account_) {
        target = target_;
        issuer = issuer_;
        account = account_;
    }

    function isLocked() public view returns (bool) {
        return !released && PumpLabClassic(target).owner() == address(this)
            && PumpLabClassic(target).feeRecipient() == account && PumpLabClassic(target).feeBps() == 100;
    }

    function execute(bytes calldata data) external nonReentrant returns (bytes memory result) {
        if (msg.sender != issuer) revert Unauthorized();
        if (!isLocked()) revert NotLocked();
        if (data.length != 36 || bytes4(data[:4]) != PumpLabClassic.setMaxNameLength.selector) {
            revert UnsupportedCall();
        }
        uint16 value = abi.decode(data[4:], (uint16));
        if (value < 8 || value > 128) revert UnsupportedCall();
        (bool ok, bytes memory ret) = target.call(data);
        if (!ok) {
            assembly { revert(add(ret, 32), mload(ret)) }
        }
        if (!isLocked()) revert NotLocked();
        emit Executed(bytes4(data[:4]));
        return ret;
    }

    function release() external nonReentrant {
        if (msg.sender != issuer || ISliceAccount(account).activeBond() != address(0) || !isLocked()) {
            revert Unauthorized();
        }
        released = true;
        PumpLabClassic(target).transferOwnership(issuer);
        emit Released(issuer);
    }
}
