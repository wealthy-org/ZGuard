// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPermAdapter} from "../interfaces/IPermAdapter.sol";

interface IWETH9Wrap is IERC20 {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @title PermWethAdapter
/// @notice Ownerless 1:1 ETH <-> WETH9 route step. It lets a signed route reach WETH-denominated
///         venues (for example v4 pools whose currency is WETH rather than native ETH) without
///         changing any venue adapter. It never prices anything, keeps no balance between calls
///         and has no privileged functions.
contract PermWethAdapter is IPermAdapter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant WRAP_ROUTE_ID = keccak256("PERM_WETH_WRAP_V1");
    bytes32 public constant UNWRAP_ROUTE_ID = keccak256("PERM_WETH_UNWRAP_V1");

    address public immutable permRouter;
    IWETH9Wrap public immutable weth;
    bytes32 public immutable wethCodehash;

    event WethStepExecuted(bytes32 indexed routeId, address indexed recipient, uint256 amount);

    error ExternalCodeChanged(address target, bytes32 expected, bytes32 actual);
    error InvalidAmount();
    error InvalidCaller();
    error InvalidNativeValue();
    error InvalidPair();
    error InvalidRouteData();
    error TransferFailed();
    error UnexpectedBalance(uint256 expected, uint256 actual);

    constructor(address router, IWETH9Wrap weth_) {
        if (router == address(0) || address(weth_) == address(0) || address(weth_).code.length == 0) revert InvalidPair();
        permRouter = router;
        weth = weth_;
        wethCodehash = address(weth_).codehash;
    }

    /// @dev Only WETH9.withdraw may send ETH here, and it is forwarded within the same call.
    receive() external payable {
        if (msg.sender != address(weth)) revert InvalidCaller();
    }

    // slither-disable-next-line cyclomatic-complexity
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        bytes calldata routeData
    ) external payable nonReentrant returns (uint256 amountOut, address hook, bytes32 routeId) {
        if (msg.sender != permRouter) revert InvalidCaller();
        if (routeData.length != 0) revert InvalidRouteData();
        if (amountIn == 0 || recipient == address(0)) revert InvalidAmount();
        bytes32 actualCodehash = address(weth).codehash;
        if (actualCodehash != wethCodehash) revert ExternalCodeChanged(address(weth), wethCodehash, actualCodehash);

        if (tokenIn == address(0) && tokenOut == address(weth)) {
            if (msg.value != amountIn) revert InvalidNativeValue();
            uint256 before = weth.balanceOf(address(this));
            weth.deposit{value: amountIn}();
            uint256 minted = weth.balanceOf(address(this)) - before;
            if (minted != amountIn) revert UnexpectedBalance(amountIn, minted);
            IERC20(address(weth)).safeTransfer(recipient, amountIn);
            routeId = WRAP_ROUTE_ID;
        } else if (tokenIn == address(weth) && tokenOut == address(0)) {
            if (msg.value != 0) revert InvalidNativeValue();
            IERC20(address(weth)).safeTransferFrom(msg.sender, address(this), amountIn);
            uint256 before = address(this).balance;
            weth.withdraw(amountIn);
            uint256 received = address(this).balance - before;
            if (received != amountIn) revert UnexpectedBalance(amountIn, received);
            // Recipient is the PermRouter (enforced by the caller check above routing all output to it).
            // slither-disable-next-line low-level-calls,arbitrary-send-eth
            (bool ok,) = recipient.call{value: amountIn}("");
            if (!ok) revert TransferFailed();
            routeId = UNWRAP_ROUTE_ID;
        } else {
            revert InvalidPair();
        }

        amountOut = amountIn;
        hook = address(0);
        emit WethStepExecuted(routeId, recipient, amountIn);
    }
}
