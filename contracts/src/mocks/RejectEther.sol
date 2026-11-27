// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

contract RejectEther {
    receive() external payable {
        revert("NO_ETH");
    }
}
