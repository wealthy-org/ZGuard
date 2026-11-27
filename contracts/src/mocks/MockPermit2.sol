// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPermit2} from "../interfaces/IPermit2.sol";

/// @dev Test-only Permit2 shape. Signature validity is deliberately reduced to a non-empty check.
contract MockPermit2 is IPermit2 {
    using SafeERC20 for IERC20;

    mapping(address owner => mapping(uint256 nonce => bool)) public used;

    function permitTransferFrom(
        PermitTransferFrom calldata permit,
        SignatureTransferDetails calldata transferDetails,
        address owner,
        bytes calldata signature
    ) external {
        require(signature.length != 0, "SIGNATURE");
        require(block.timestamp <= permit.deadline, "DEADLINE");
        require(!used[owner][permit.nonce], "NONCE");
        require(transferDetails.requestedAmount <= permit.permitted.amount, "AMOUNT");
        used[owner][permit.nonce] = true;
        IERC20(permit.permitted.token).safeTransferFrom(owner, transferDetails.to, transferDetails.requestedAmount);
    }
}
