// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISliceRouter} from "./SliceTypes.sol";
import {PumpLab} from "./PumpLab.sol";

contract FeeGuard is ReentrancyGuard {
    error Unauthorized();
    error NotLocked();
    error UnsupportedCall();
    address public immutable target;
    address public immutable issuer;
    address public immutable router;
    bool public released;
    event Executed(bytes4 indexed selector);
    event Released(address indexed issuer);

    constructor(address target_, address issuer_, address router_) {
        target = target_;
        issuer = issuer_;
        router = router_;
    }

    function isLocked() public view returns (bool) {
        return !released && PumpLab(target).owner() == address(this) && PumpLab(target).feeRecipient() == router
            && PumpLab(target).feeBps() == 100;
    }

    function execute(bytes calldata data) external nonReentrant returns (bytes memory result) {
        if (msg.sender != issuer) revert Unauthorized();
        if (!isLocked()) revert NotLocked();
        if (data.length != 36 || bytes4(data[:4]) != PumpLab.setMaxNameLength.selector) revert UnsupportedCall();
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
        if (msg.sender != issuer || ISliceRouter(router).activeBond() != address(0) || !isLocked()) {
            revert Unauthorized();
        }
        released = true;
        PumpLab(target).transferOwnership(issuer);
        emit Released(issuer);
    }
}
