// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPermAdapter} from "../interfaces/IPermAdapter.sol";

interface IWETH9 is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title PermV3Adapter
/// @notice Immutable SwapRouter02 adapter for reviewed Uniswap-v3-compatible venues.
contract PermV3Adapter is IPermAdapter, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 internal constant V3_ROUTE_DOMAIN = keccak256("PERM_V3_SINGLE_V1");

    address public immutable permRouter;
    ISwapRouter02 public immutable swapRouter;
    IWETH9 public immutable weth;
    bytes32 public immutable swapRouterCodehash;
    bytes32 public immutable wethCodehash;

    event V3StepExecuted(
        bytes32 indexed routeId,
        address indexed recipient,
        uint24 fee,
        uint256 amountIn,
        uint256 amountOut
    );
    event ExcessRescued(address indexed token, address indexed recipient, uint256 amount);

    error ExternalCodeChanged(address target, bytes32 expected, bytes32 actual);
    error InvalidCaller();
    error InvalidFee();
    error InvalidNativeValue();
    error InvalidPair();
    error InvalidRouteData();
    error TransferFailed();

    constructor(address initialOwner, address router, ISwapRouter02 swapRouter_, IWETH9 weth_) Ownable(initialOwner) {
        if (
            router == address(0) || address(swapRouter_) == address(0) || address(weth_) == address(0)
                || address(swapRouter_).code.length == 0 || address(weth_).code.length == 0
        ) revert InvalidPair();
        permRouter = router;
        swapRouter = swapRouter_;
        weth = weth_;
        swapRouterCodehash = address(swapRouter_).codehash;
        wethCodehash = address(weth_).codehash;
    }

    receive() external payable {
        if (msg.sender != address(weth)) revert InvalidCaller();
    }

    // Native wrapping, ERC-20 settlement, codehash checks, and fee validation are kept atomic.
    // slither-disable-next-line cyclomatic-complexity
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        bytes calldata routeData
    ) external payable nonReentrant returns (uint256 amountOut, address hook, bytes32 routeId) {
        if (msg.sender != permRouter) revert InvalidCaller();
        if (recipient == address(0)) revert InvalidPair();
        _checkCode(address(swapRouter), swapRouterCodehash);
        _checkCode(address(weth), wethCodehash);
        if (routeData.length != 64) revert InvalidRouteData();
        (uint24 fee, uint160 sqrtPriceLimitX96) = abi.decode(routeData, (uint24, uint160));
        if (fee != 100 && fee != 500 && fee != 3_000 && fee != 10_000) revert InvalidFee();
        if (sqrtPriceLimitX96 != 0) revert InvalidRouteData();

        address actualIn = tokenIn == address(0) ? address(weth) : tokenIn;
        address actualOut = tokenOut == address(0) ? address(weth) : tokenOut;
        if (actualIn == actualOut) revert InvalidPair();

        if (tokenIn == address(0)) {
            if (msg.value != amountIn) revert InvalidNativeValue();
            weth.deposit{value: amountIn}();
        } else {
            if (msg.value != 0) revert InvalidNativeValue();
            IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        }

        IERC20(actualIn).forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: actualIn,
                tokenOut: actualOut,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(actualIn).forceApprove(address(swapRouter), 0);

        if (tokenOut == address(0)) {
            weth.withdraw(amountOut);
            // Only the immutable Perm router can call this function and supplies its own address here.
            // slither-disable-next-line low-level-calls
            (bool ok,) = recipient.call{value: amountOut}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(tokenOut).safeTransfer(recipient, amountOut);
        }

        routeId = keccak256(abi.encode(V3_ROUTE_DOMAIN, actualIn, actualOut, fee));
        emit V3StepExecuted(routeId, recipient, fee, amountIn, amountOut);
        return (amountOut, address(0), routeId);
    }

    function rescueExcess(address token, address recipient, uint256 amount) external onlyOwner nonReentrant {
        if (recipient == address(0)) revert InvalidPair();
        if (token == address(0)) {
            // Owner-authorized rescue to a validated nonzero recipient.
            // slither-disable-next-line low-level-calls
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
        emit ExcessRescued(token, recipient, amount);
    }

    function _checkCode(address target, bytes32 expected) internal view {
        bytes32 actual = target.codehash;
        if (actual != expected) revert ExternalCodeChanged(target, expected, actual);
    }
}
