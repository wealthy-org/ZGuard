// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

interface IMockSynthraV3SwapCallback {
    function synthraV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

interface IMockTestAggregatorHook {
    function poolManager() external view returns (IPoolManager);
}

/// @notice Adversarial test fixture for PermTestAggregatorHook. Never deploy outside tests.
contract MockTestAggregatorV3Pool {
    using SafeERC20 for IERC20;

    enum Behavior {
        Normal,
        DoubleCallback,
        PartialInput,
        ShortOutput,
        ReenterSwap,
        WrongInputCurrency
    }

    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    Behavior public behavior;

    error InvalidAmount();
    error InvalidPair();

    constructor(address tokenA, address tokenB, uint24 fee_, int24 tickSpacing_) {
        if (tokenA == address(0) || tokenB == address(0) || tokenA == tokenB) revert InvalidPair();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        fee = fee_;
        tickSpacing = tickSpacing_;
    }

    function setBehavior(Behavior next) external {
        behavior = next;
    }

    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1)
    {
        if (amountSpecified <= 1) revert InvalidAmount();
        uint256 amountIn = uint256(amountSpecified);
        uint256 amountOut = amountIn;
        uint256 callbackAmount = behavior == Behavior.PartialInput ? amountIn - 1 : amountIn;
        uint256 transferredOutput = behavior == Behavior.ShortOutput ? amountOut - 1 : amountOut;

        if (behavior == Behavior.ReenterSwap) {
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(token0),
                currency1: Currency.wrap(token1),
                fee: fee,
                tickSpacing: tickSpacing,
                hooks: IHooks(msg.sender)
            });
            IMockTestAggregatorHook(msg.sender).poolManager().swap(
                key,
                SwapParams({zeroForOne: zeroForOne, amountSpecified: -amountSpecified, sqrtPriceLimitX96: 0}),
                ""
            );
        }
        if (behavior == Behavior.WrongInputCurrency) {
            if (zeroForOne) {
                IMockSynthraV3SwapCallback(msg.sender).synthraV3SwapCallback(
                    -int256(amountOut), int256(callbackAmount), data
                );
            } else {
                IMockSynthraV3SwapCallback(msg.sender).synthraV3SwapCallback(
                    int256(callbackAmount), -int256(amountOut), data
                );
            }
            revert InvalidAmount();
        }

        if (zeroForOne) {
            IERC20(token1).safeTransfer(recipient, transferredOutput);
            amount0 = int256(amountIn);
            amount1 = -int256(amountOut);
            IMockSynthraV3SwapCallback(msg.sender).synthraV3SwapCallback(
                int256(callbackAmount), -int256(amountOut), data
            );
        } else {
            IERC20(token0).safeTransfer(recipient, transferredOutput);
            amount0 = -int256(amountOut);
            amount1 = int256(amountIn);
            IMockSynthraV3SwapCallback(msg.sender).synthraV3SwapCallback(
                -int256(amountOut), int256(callbackAmount), data
            );
        }

        if (behavior == Behavior.DoubleCallback) {
            IMockSynthraV3SwapCallback(msg.sender).synthraV3SwapCallback(amount0, amount1, data);
        }
    }
}
