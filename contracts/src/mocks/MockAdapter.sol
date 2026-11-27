// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPermAdapter} from "../interfaces/IPermAdapter.sol";

contract MockAdapter is IPermAdapter {
    using SafeERC20 for IERC20;

    address public immutable router;
    uint256 public immutable numerator;
    uint256 public immutable denominator;
    bytes32 public immutable mockRouteId;

    constructor(address router_, uint256 numerator_, uint256 denominator_) {
        router = router_;
        numerator = numerator_;
        denominator = denominator_;
        mockRouteId = keccak256(abi.encode("MOCK", numerator_, denominator_));
    }

    receive() external payable {}

    function swapExactInput(address tokenIn, address tokenOut, uint256 amountIn, address recipient, bytes calldata routeData)
        external
        payable
        returns (uint256 amountOut, address hook, bytes32 routeId)
    {
        require(msg.sender == router, "ONLY_ROUTER");
        if (tokenIn == address(0)) require(msg.value == amountIn, "VALUE");
        else IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        amountOut = amountIn * numerator / denominator;
        if (tokenOut == address(0)) {
            (bool ok,) = recipient.call{value: amountOut}("");
            require(ok, "NATIVE_OUT");
        } else {
            IERC20(tokenOut).safeTransfer(recipient, amountOut);
        }
        hook = routeData.length == 32 ? abi.decode(routeData, (address)) : address(0);
        return (amountOut, hook, mockRouteId);
    }
}
