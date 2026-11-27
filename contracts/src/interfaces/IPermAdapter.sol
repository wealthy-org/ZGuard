// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IPermAdapter {
    /// @notice Executes one exact-input route step selected and signed before execution.
    /// @dev The adapter must send all output to `recipient`, spend exactly `amountIn`,
    ///      and reject every target or route field it cannot validate itself.
    /// @return amountOut Amount the adapter reports sending to `recipient`.
    /// @return hook Hook used by this step, or address(0) when none applies.
    /// @return routeId Venue-specific pool/path identity.
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        address recipient,
        bytes calldata routeData
    ) external payable returns (uint256 amountOut, address hook, bytes32 routeId);
}
