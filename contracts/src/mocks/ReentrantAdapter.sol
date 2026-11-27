// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermAdapter} from "../interfaces/IPermAdapter.sol";

/// @dev Attempts a caller-supplied reentrant router call and bubbles its result.
contract ReentrantAdapter is IPermAdapter {
    address public immutable router;
    bytes public reentryCall;

    constructor(address router_) {
        router = router_;
    }

    function setReentryCall(bytes calldata payload) external {
        reentryCall = payload;
    }

    function swapExactInput(address, address, uint256, address, bytes calldata)
        external
        payable
        returns (uint256, address, bytes32)
    {
        require(msg.sender == router, "ONLY_ROUTER");
        (bool ok, bytes memory reason) = router.call(reentryCall);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(reason, 32), mload(reason))
            }
        }
        revert("REENTRY_UNEXPECTEDLY_SUCCEEDED");
    }
}
