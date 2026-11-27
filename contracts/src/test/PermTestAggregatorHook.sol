// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-core/src/types/Currency.sol";
import {BeforeSwapDelta, toBeforeSwapDelta} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

interface ITestExternalV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external
        returns (int256 amount0, int256 amount1);
}

/// @title PermTestAggregatorHook
/// @notice Chain-46630-only test hook that exposes one codehash-pinned V3 pool through v4 accounting.
/// @dev This is an ownerless, immutable test fixture. It is not an official Uniswap Labs Aggregator Hook,
///      must never be labelled as one, and is forbidden by construction from deployment outside chain 46630.
contract PermTestAggregatorHook {
    using CurrencyLibrary for Currency;
    using PoolIdLibrary for PoolKey;

    uint256 public constant TEST_CHAIN_ID = 46_630;
    address public constant CANONICAL_POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    bytes32 public constant CANONICAL_POOL_MANAGER_CODEHASH =
        0xbd3881180b547f5fe817545743cfb4343e96b1bc6640dcd70c106b0066e95626;
    uint160 public constant REQUIRED_HOOK_FLAGS = 0x2888;
    uint160 private constant ALL_HOOK_MASK = (1 << 14) - 1;
    uint256 private constant MAX_SWAP_DELTA = uint256(uint128(type(int128).max));
    string public constant TEST_ONLY_LABEL = "Perm test hook - not an official Aggregator Hook";

    IPoolManager public immutable poolManager;
    address public immutable externalPool;
    bytes32 public immutable externalPoolCodehash;
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable externalFee;
    int24 public immutable externalTickSpacing;
    bytes32 public registeredPoolId;

    // keccak256("PermTestAggregatorHook.transient.activePool") - 1
    bytes32 private constant ACTIVE_POOL_SLOT =
        0x000bbb11269437e241af0d35309798fc3531345089b946b821b296057294a470;
    // keccak256("PermTestAggregatorHook.transient.expectedInput") - 1
    bytes32 private constant EXPECTED_INPUT_SLOT =
        0xa34540d7beeb9debc1401cdf57d4d607682f13d1ea22e718c8bb081059baec5c;
    // keccak256("PermTestAggregatorHook.transient.paidInput") - 1
    bytes32 private constant PAID_INPUT_SLOT =
        0x19f07dc9e87b2e30c8c0f744efefe691b364b16ca1a0e22773eeb17bb83978b2;
    // keccak256("PermTestAggregatorHook.transient.expectedInputCurrency") - 1
    bytes32 private constant EXPECTED_INPUT_CURRENCY_SLOT =
        0x88afc77bc241fb90cb118b959dff8bf7560ee855b739c2e3648d71d80f016daf;

    event AggregatorPoolRegistered(bytes32 indexed poolId);
    event HookSwap(
        bytes32 indexed poolId,
        address indexed sender,
        int256 amount0,
        int256 amount1,
        uint24 swapFee
    );

    error DeltaTooLarge(uint256 amount);
    error ExactInputOnly();
    error ExternalPoolChanged(bytes32 expected, bytes32 actual);
    error HookDataUnsupported();
    error InputMismatch(uint256 expected, uint256 actual);
    error InvalidExternalPool();
    error InvalidHookAddress(uint160 actualFlags);
    error InvalidPoolKey();
    error InvalidPoolManager(address actual, bytes32 actualCodehash);
    error LiquidityNotAllowed();
    error NativeCurrencyUnsupported();
    error NotPoolManager();
    error OutputMismatch(uint256 expected, uint256 actual);
    error PoolAlreadyRegistered(bytes32 poolId);
    error Reentrancy();
    error TestnetOnly(uint256 chainId);
    error UnauthorizedCallback();
    error UnexpectedInputCurrency(address expected, address actual);
    error UnexpectedSwapDelta();

    constructor(IPoolManager manager, address pool, bytes32 expectedPoolCodehash) {
        if (block.chainid != TEST_CHAIN_ID) revert TestnetOnly(block.chainid);
        uint160 actualFlags = uint160(address(this)) & ALL_HOOK_MASK;
        if (actualFlags != REQUIRED_HOOK_FLAGS) revert InvalidHookAddress(actualFlags);
        bytes32 actualManagerCodehash = address(manager).codehash;
        if (
            address(manager) != CANONICAL_POOL_MANAGER
                || actualManagerCodehash != CANONICAL_POOL_MANAGER_CODEHASH
        ) revert InvalidPoolManager(address(manager), actualManagerCodehash);
        if (pool == address(0) || pool.code.length == 0) revert InvalidExternalPool();
        bytes32 actualCodehash = pool.codehash;
        if (expectedPoolCodehash == bytes32(0) || actualCodehash != expectedPoolCodehash) {
            revert ExternalPoolChanged(expectedPoolCodehash, actualCodehash);
        }

        ITestExternalV3Pool venue = ITestExternalV3Pool(pool);
        address poolToken0 = venue.token0();
        address poolToken1 = venue.token1();
        if (poolToken0 == address(0) || poolToken1 == address(0) || poolToken0 >= poolToken1) {
            revert InvalidExternalPool();
        }

        poolManager = manager;
        externalPool = pool;
        externalPoolCodehash = expectedPoolCodehash;
        token0 = poolToken0;
        token1 = poolToken1;
        externalFee = venue.fee();
        externalTickSpacing = venue.tickSpacing();
    }

    function isTestOnly() external pure returns (bool) {
        return true;
    }

    function beforeInitialize(address, PoolKey calldata key, uint160) external returns (bytes4) {
        _onlyPoolManager();
        if (registeredPoolId != bytes32(0)) revert PoolAlreadyRegistered(registeredPoolId);
        if (
            Currency.unwrap(key.currency0) != token0 || Currency.unwrap(key.currency1) != token1
                || key.fee != externalFee || key.tickSpacing != externalTickSpacing || address(key.hooks) != address(this)
        ) revert InvalidPoolKey();
        _checkExternalPool();
        registeredPoolId = PoolId.unwrap(key.toId());
        emit AggregatorPoolRegistered(registeredPoolId);
        return IHooks.beforeInitialize.selector;
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        view
        returns (bytes4)
    {
        _onlyPoolManager();
        revert LiquidityNotAllowed();
    }

    // This intentionally sequences authenticated PoolManager and immutable-venue calls in one exact-settlement path.
    // Transient active state is set before the venue call, and all deltas are verified before the final event.
    // slither-disable-next-line reentrancy-events,cyclomatic-complexity
    function beforeSwap(address sender, PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        _onlyPoolManager();
        if (hookData.length != 0) revert HookDataUnsupported();
        if (params.amountSpecified >= 0) revert ExactInputOnly();
        bytes32 poolId = PoolId.unwrap(key.toId());
        if (poolId == bytes32(0) || poolId != registeredPoolId) revert InvalidPoolKey();
        _checkExternalPool();
        if (_activePool() != address(0)) revert Reentrancy();

        uint256 amountIn = uint256(-params.amountSpecified);
        if (amountIn > MAX_SWAP_DELTA) revert DeltaTooLarge(amountIn);
        Currency inputCurrency = params.zeroForOne ? key.currency0 : key.currency1;
        Currency outputCurrency = params.zeroForOne ? key.currency1 : key.currency0;
        if (inputCurrency.isAddressZero() || outputCurrency.isAddressZero()) revert NativeCurrencyUnsupported();

        _setTransient(ACTIVE_POOL_SLOT, uint256(uint160(externalPool)));
        _setTransient(EXPECTED_INPUT_SLOT, amountIn);
        _setTransient(PAID_INPUT_SLOT, 0);
        _setTransient(EXPECTED_INPUT_CURRENCY_SLOT, uint256(uint160(Currency.unwrap(inputCurrency))));

        poolManager.sync(outputCurrency);
        (int256 amount0Delta, int256 amount1Delta) = ITestExternalV3Pool(externalPool).swap(
            address(poolManager), params.zeroForOne, int256(amountIn), params.sqrtPriceLimitX96, abi.encode(poolId)
        );

        uint256 amountOut;
        if (params.zeroForOne) {
            if (amount0Delta <= 0 || amount1Delta >= 0) revert UnexpectedSwapDelta();
            amountOut = uint256(-amount1Delta);
        } else {
            if (amount1Delta <= 0 || amount0Delta >= 0) revert UnexpectedSwapDelta();
            amountOut = uint256(-amount0Delta);
        }
        if (amountOut > MAX_SWAP_DELTA) revert DeltaTooLarge(amountOut);
        uint256 paidInput = _transient(PAID_INPUT_SLOT);
        if (paidInput != amountIn) revert InputMismatch(amountIn, paidInput);
        uint256 settledOutput = poolManager.settle();
        if (settledOutput != amountOut) revert OutputMismatch(amountOut, settledOutput);

        _setTransient(ACTIVE_POOL_SLOT, 0);
        _setTransient(EXPECTED_INPUT_SLOT, 0);
        _setTransient(PAID_INPUT_SLOT, 0);
        _setTransient(EXPECTED_INPUT_CURRENCY_SLOT, 0);

        int128 specifiedDelta = int128(uint128(amountIn));
        int128 unspecifiedDelta = -int128(uint128(amountOut));
        int256 eventAmount0 = params.zeroForOne ? int256(uint256(amountIn)) : -int256(uint256(amountOut));
        int256 eventAmount1 = params.zeroForOne ? -int256(uint256(amountOut)) : int256(uint256(amountIn));
        emit HookSwap(poolId, sender, eventAmount0, eventAmount1, 0);
        return (IHooks.beforeSwap.selector, toBeforeSwapDelta(specifiedDelta, unspecifiedDelta), 0);
    }

    function synthraV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
        _swapCallback(amount0Delta, amount1Delta, data);
    }

    function _swapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) private {
        if (msg.sender != externalPool || _activePool() != externalPool) revert UnauthorizedCallback();
        _checkExternalPool();
        if (abi.decode(data, (bytes32)) != registeredPoolId) revert UnauthorizedCallback();

        bool token0Owed = amount0Delta > 0 && amount1Delta < 0;
        bool token1Owed = amount1Delta > 0 && amount0Delta < 0;
        if (!token0Owed && !token1Owed) revert UnexpectedSwapDelta();
        Currency inputCurrency = Currency.wrap(token0Owed ? token0 : token1);
        uint256 amountOwed = token0Owed ? uint256(amount0Delta) : uint256(amount1Delta);
        address expectedInputCurrency = address(uint160(_transient(EXPECTED_INPUT_CURRENCY_SLOT)));
        address actualInputCurrency = Currency.unwrap(inputCurrency);
        if (actualInputCurrency != expectedInputCurrency) {
            revert UnexpectedInputCurrency(expectedInputCurrency, actualInputCurrency);
        }
        uint256 expectedInput = _transient(EXPECTED_INPUT_SLOT);
        if (amountOwed != expectedInput) revert InputMismatch(expectedInput, amountOwed);
        if (_transient(PAID_INPUT_SLOT) != 0) revert Reentrancy();
        poolManager.take(inputCurrency, externalPool, amountOwed);
        _setTransient(PAID_INPUT_SLOT, amountOwed);
    }

    function _onlyPoolManager() private view {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
    }

    function _checkExternalPool() private view {
        bytes32 actual = externalPool.codehash;
        if (actual != externalPoolCodehash) revert ExternalPoolChanged(externalPoolCodehash, actual);
    }

    // EIP-1153 transient storage has no high-level Solidity syntax in compiler 0.8.26.
    // The four fixed namespaced slots are cleared after every successful swap and roll back on failure.
    // slither-disable-next-line assembly
    function _setTransient(bytes32 slot, uint256 value) private {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }

    // EIP-1153 transient storage has no high-level Solidity syntax in compiler 0.8.26.
    // slither-disable-next-line assembly
    function _transient(bytes32 slot) private view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }

    function _activePool() private view returns (address) {
        return address(uint160(_transient(ACTIVE_POOL_SLOT)));
    }
}
