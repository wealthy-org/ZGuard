// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPermAdapter} from "../interfaces/IPermAdapter.sol";

interface IWETH9V2 is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2Pair {
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @title PermV2Adapter
/// @notice Restricted direct-pair adapter for a source-reviewed Uniswap-v2-compatible factory.
contract PermV2Adapter is IPermAdapter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 internal constant V2_ROUTE_DOMAIN = keccak256("PERM_V2_SINGLE_V1");

    address public immutable permRouter;
    IUniswapV2Factory public immutable factory;
    IWETH9V2 public immutable weth;
    bytes32 public immutable factoryCodehash;
    bytes32 public immutable wethCodehash;
    bytes32 public immutable pairCodehash;

    event V2StepExecuted(
        bytes32 indexed routeId,
        address indexed pair,
        address indexed recipient,
        uint256 amountIn,
        uint256 amountOut,
        uint32 reserveTimestamp
    );
    event ExcessRescued(address indexed token, address indexed recipient, uint256 amount);

    error ExternalCodeChanged(address target, bytes32 expected, bytes32 actual);
    error InsufficientLiquidity();
    error InvalidCaller();
    error InvalidNativeValue();
    error InvalidPair();
    error InvalidRouteData();
    error TransferFailed();
    error UnexpectedBalance(uint256 expected, uint256 actual);

    constructor(
        address initialOwner,
        address router,
        IUniswapV2Factory factory_,
        IWETH9V2 weth_,
        bytes32 pairCodehash_
    ) Ownable(initialOwner) {
        if (
            router == address(0) || address(factory_) == address(0) || address(weth_) == address(0)
                || address(factory_).code.length == 0 || address(weth_).code.length == 0
                || pairCodehash_ == bytes32(0)
        ) revert InvalidPair();
        permRouter = router;
        factory = factory_;
        weth = weth_;
        factoryCodehash = address(factory_).codehash;
        wethCodehash = address(weth_).codehash;
        pairCodehash = pairCodehash_;
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert InvalidCaller();
    }

    struct PairState {
        address actualIn;
        address actualOut;
        address pair;
        address token0;
        uint256 reserveIn;
        uint256 reserveOut;
        uint32 reserveTimestamp;
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        bytes calldata routeData
    ) external payable nonReentrant returns (uint256 amountOut, address hook, bytes32 routeId) {
        if (msg.sender != permRouter) revert InvalidCaller();
        if (recipient != permRouter || amountIn == 0 || routeData.length != 32) revert InvalidRouteData();

        PairState memory state = _loadPairState(tokenIn, tokenOut, routeData);
        uint256 pairInputBefore = _validatedPairInputBalance(state);
        _collectInput(tokenIn, state.actualIn, amountIn);
        _transferExactInput(state.actualIn, state.pair, amountIn, pairInputBefore);
        amountOut = _executeSwap(state, amountIn);
        _deliverOutput(tokenOut, state.actualOut, amountOut);

        routeId = keccak256(abi.encode(V2_ROUTE_DOMAIN, address(factory), state.pair, state.actualIn, state.actualOut));
        emit V2StepExecuted(routeId, state.pair, recipient, amountIn, amountOut, state.reserveTimestamp);
        return (amountOut, address(0), routeId);
    }

    function rescueExcess(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidPair();
        if (token == address(0)) {
            // slither-disable-next-line low-level-calls
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit ExcessRescued(token, recipient, amount);
    }

    function _loadPairState(address tokenIn, address tokenOut, bytes calldata routeData)
        internal
        view
        returns (PairState memory state)
    {
        _checkCode(address(factory), factoryCodehash);
        _checkCode(address(weth), wethCodehash);
        state.actualIn = tokenIn == address(0) ? address(weth) : tokenIn;
        state.actualOut = tokenOut == address(0) ? address(weth) : tokenOut;
        if (state.actualIn == state.actualOut) revert InvalidPair();

        state.pair = abi.decode(routeData, (address));
        if (state.pair == address(0) || factory.getPair(state.actualIn, state.actualOut) != state.pair) {
            revert InvalidPair();
        }
        _checkCode(state.pair, pairCodehash);

        IUniswapV2Pair venuePair = IUniswapV2Pair(state.pair);
        state.token0 = venuePair.token0();
        address token1 = venuePair.token1();
        bool forward = state.token0 == state.actualIn && token1 == state.actualOut;
        bool reverse = state.token0 == state.actualOut && token1 == state.actualIn;
        if (venuePair.factory() != address(factory) || (!forward && !reverse)) revert InvalidPair();

        (uint112 reserve0, uint112 reserve1, uint32 reserveTimestamp) = venuePair.getReserves();
        state.reserveIn = forward ? uint256(reserve0) : uint256(reserve1);
        state.reserveOut = forward ? uint256(reserve1) : uint256(reserve0);
        state.reserveTimestamp = reserveTimestamp;
        if (state.reserveIn == 0 || state.reserveOut == 0) revert InsufficientLiquidity();
    }

    function _validatedPairInputBalance(PairState memory state) internal view returns (uint256 pairInputBefore) {
        pairInputBefore = IERC20(state.actualIn).balanceOf(state.pair);
        uint256 pairOutputBefore = IERC20(state.actualOut).balanceOf(state.pair);
        if (pairInputBefore != state.reserveIn) revert UnexpectedBalance(state.reserveIn, pairInputBefore);
        if (pairOutputBefore != state.reserveOut) revert UnexpectedBalance(state.reserveOut, pairOutputBefore);
    }

    function _collectInput(address tokenIn, address actualIn, uint256 amountIn) internal {
        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert InvalidNativeValue();
            weth.deposit{value: amountIn}();
            return;
        }
        if (msg.value != 0) revert InvalidNativeValue();
        uint256 adapterInputBefore = IERC20(actualIn).balanceOf(address(this));
        IERC20(actualIn).safeTransferFrom(msg.sender, address(this), amountIn);
        uint256 received = IERC20(actualIn).balanceOf(address(this)) - adapterInputBefore;
        if (received != amountIn) revert UnexpectedBalance(amountIn, received);
    }

    function _transferExactInput(address actualIn, address pair, uint256 amountIn, uint256 pairInputBefore) internal {
        IERC20(actualIn).safeTransfer(pair, amountIn);
        uint256 received = IERC20(actualIn).balanceOf(pair) - pairInputBefore;
        if (received != amountIn) revert UnexpectedBalance(amountIn, received);
    }

    function _executeSwap(PairState memory state, uint256 amountIn) internal returns (uint256 amountOut) {
        uint256 amountInWithFee = amountIn * 997;
        amountOut = amountInWithFee * state.reserveOut / (state.reserveIn * 1_000 + amountInWithFee);
        if (amountOut == 0 || amountOut >= state.reserveOut) revert InsufficientLiquidity();
        uint256 outputBefore = IERC20(state.actualOut).balanceOf(address(this));
        (uint256 amount0Out, uint256 amount1Out) = state.token0 == state.actualIn
            ? (uint256(0), amountOut)
            : (amountOut, uint256(0));
        IUniswapV2Pair(state.pair).swap(amount0Out, amount1Out, address(this), "");
        uint256 received = IERC20(state.actualOut).balanceOf(address(this)) - outputBefore;
        if (received != amountOut) revert UnexpectedBalance(amountOut, received);
    }

    function _deliverOutput(address tokenOut, address actualOut, uint256 amountOut) internal {
        if (tokenOut != address(0)) {
            IERC20(actualOut).safeTransfer(permRouter, amountOut);
            return;
        }
        weth.withdraw(amountOut);
        // The immutable Perm router is the sole caller and the sole settlement recipient.
        // slither-disable-next-line low-level-calls
        (bool ok,) = permRouter.call{value: amountOut}("");
        if (!ok) revert TransferFailed();
    }

    function _checkCode(address target, bytes32 expected) internal view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert ExternalCodeChanged(target, expected, actual);
    }
}
