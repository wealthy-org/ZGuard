// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMintableToken {
    function mint(address to, uint256 amount) external;
}

contract MockSwapRouter02 {
    using SafeERC20 for IERC20;

    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    uint256 public numerator = 2;
    uint256 public denominator = 1;

    function setRate(uint256 numerator_, uint256 denominator_) external {
        numerator = numerator_;
        denominator = denominator_;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external returns (uint256 amountOut) {
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountIn * numerator / denominator;
        require(amountOut >= params.amountOutMinimum, "MIN");
        IMintableToken(params.tokenOut).mint(params.recipient, amountOut);
    }
}
