// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPermAdapter} from "../interfaces/IPermAdapter.sol";

contract MockMutableAdapter is IPermAdapter {
    address public immutable router;

    constructor(address router_) {
        router = router_;
    }

    function swapExactInput(address, address, uint256, address, bytes calldata)
        external
        payable
        returns (uint256 amountOut, address hook, bytes32 routeId)
    {
        require(msg.sender == router, "ONLY_ROUTER");
        return (1, address(0), keccak256("MUTABLE"));
    }

}
