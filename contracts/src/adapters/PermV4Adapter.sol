// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IPermAdapter} from "../interfaces/IPermAdapter.sol";

/// @title PermV4Adapter
/// @notice Restricted single-pool Uniswap v4 step adapter with codehash-pinned hooks.
contract PermV4Adapter is IPermAdapter, IUnlockCallback, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using CurrencyLibrary for Currency;
    using BalanceDeltaLibrary for BalanceDelta;
    using PoolIdLibrary for PoolKey;

    struct CallbackData {
        PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        address recipient;
        bytes hookData;
    }

    IPoolManager public immutable poolManager;
    address public immutable permRouter;
    mapping(address hook => bytes32 codehash) public verifiedHookCodehashes;

    event HookVerificationChanged(address indexed hook, bytes32 indexed codehash, bool verified);
    event ExcessRescued(address indexed token, address indexed recipient, uint256 amount);
    event V4StepExecuted(
        bytes32 indexed poolId,
        address indexed hook,
        address indexed recipient,
        uint256 amountIn,
        uint256 amountOut,
        bytes32 routeHash
    );

    error HookCodeChanged(address hook, bytes32 expected, bytes32 actual);
    error HookDataUnsupported();
    error HookNotVerified(address hook);
    error InvalidCaller();
    error InvalidNativeValue();
    error InvalidPair();
    error PartialFillUnsupported(uint256 spent, uint256 expected);
    error TransferFailed();
    error UnexpectedDelta();

    constructor(address initialOwner, address router, IPoolManager manager) Ownable(initialOwner) {
        if (router == address(0) || address(manager) == address(0)) revert InvalidPair();
        permRouter = router;
        poolManager = manager;
    }

    receive() external payable {
        if (msg.sender != address(poolManager)) revert InvalidCaller();
    }

    function verifiedHooks(address hook) external view returns (bool) {
        bytes32 expected = verifiedHookCodehashes[hook];
        return expected != bytes32(0) && hook.codehash == expected;
    }

    function setVerifiedHook(address hook, bool verified) external onlyOwner {
        if (hook == address(0)) revert InvalidPair();
        if (!verified) {
            delete verifiedHookCodehashes[hook];
            emit HookVerificationChanged(hook, bytes32(0), false);
            return;
        }
        bytes32 codehash = hook.codehash;
        if (hook.code.length == 0 || codehash == bytes32(0)) revert HookNotVerified(hook);
        verifiedHookCodehashes[hook] = codehash;
        emit HookVerificationChanged(hook, codehash, true);
    }

    // Pair, hook codehash, native value, and settlement checks intentionally remain atomic.
    // slither-disable-next-line cyclomatic-complexity
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        bytes calldata routeData
    ) external payable nonReentrant returns (uint256 amountOut, address hook, bytes32 routeId) {
        if (msg.sender != permRouter) revert InvalidCaller();
        (PoolKey memory key, bytes memory hookData) = abi.decode(routeData, (PoolKey, bytes));

        address currency0 = Currency.unwrap(key.currency0);
        address currency1 = Currency.unwrap(key.currency1);
        bool zeroForOne = false;
        if (tokenIn == currency0 && tokenOut == currency1) zeroForOne = true;
        else if (tokenIn == currency1 && tokenOut == currency0) zeroForOne = false;
        else revert InvalidPair();

        hook = address(key.hooks);
        if (hook == address(0)) {
            if (hookData.length != 0) revert HookDataUnsupported();
        } else {
            bytes32 expected = verifiedHookCodehashes[hook];
            if (expected == bytes32(0)) revert HookNotVerified(hook);
            bytes32 actual = hook.codehash;
            if (actual != expected) revert HookCodeChanged(hook, expected, actual);
            if (hookData.length > 1_024) revert HookDataUnsupported();
        }

        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert InvalidNativeValue();
        } else {
            if (msg.value != 0) revert InvalidNativeValue();
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        bytes memory result = poolManager.unlock(
            abi.encode(CallbackData(key, zeroForOne, amountIn, recipient, hookData))
        );
        amountOut = abi.decode(result, (uint256));
        routeId = PoolId.unwrap(key.toId());
        emit V4StepExecuted(routeId, hook, recipient, amountIn, amountOut, keccak256(routeData));
    }

    /// @notice Recovers only balances stranded outside an active, non-reentrant swap.
    function rescueExcess(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidPair();
        if (token == address(0)) {
            // Owner-authorized recovery to a validated recipient.
            // slither-disable-next-line low-level-calls
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit ExcessRescued(token, recipient, amount);
    }

    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert InvalidCaller();
        CallbackData memory data = abi.decode(rawData, (CallbackData));
        SwapParams memory params = SwapParams({
            zeroForOne: data.zeroForOne,
            amountSpecified: -int256(data.amountIn),
            sqrtPriceLimitX96: data.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        BalanceDelta delta = poolManager.swap(data.key, params, data.hookData);
        int128 inputDelta = data.zeroForOne ? delta.amount0() : delta.amount1();
        int128 outputDelta = data.zeroForOne ? delta.amount1() : delta.amount0();
        if (inputDelta >= 0 || outputDelta <= 0) revert UnexpectedDelta();

        uint256 spent = uint256(uint128(-inputDelta));
        if (spent != data.amountIn) revert PartialFillUnsupported(spent, data.amountIn);
        uint256 amountOut = uint256(uint128(outputDelta));

        Currency inputCurrency = data.zeroForOne ? data.key.currency0 : data.key.currency1;
        Currency outputCurrency = data.zeroForOne ? data.key.currency1 : data.key.currency0;
        uint256 paid;
        if (inputCurrency.isAddressZero()) {
            paid = poolManager.settle{value: spent}();
        } else {
            poolManager.sync(inputCurrency);
            inputCurrency.transfer(address(poolManager), spent);
            paid = poolManager.settle();
        }
        if (paid != spent) revert UnexpectedDelta();
        poolManager.take(outputCurrency, data.recipient, amountOut);
        return abi.encode(amountOut);
    }
}
