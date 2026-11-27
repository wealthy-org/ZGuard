// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract MockV2Pair {
    using SafeERC20 for IERC20;

    address public factory;
    address public token0;
    address public token1;
    uint112 private reserve0;
    uint112 private reserve1;
    bool private initialized;

    constructor() {
        factory = msg.sender;
    }

    function initialize(address token0_, address token1_) external {
        require(msg.sender == factory && !initialized && token0_ < token1_, "INIT");
        initialized = true;
        token0 = token0_;
        token1 = token1_;
    }

    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, uint32(block.timestamp));
    }

    function seed(uint256 amount0, uint256 amount1) external {
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);
        _sync();
    }

    function sync() external {
        _sync();
    }

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external {
        require(data.length == 0 && to != address(0), "CALLBACK");
        require((amount0Out == 0) != (amount1Out == 0), "OUTPUT");
        require(amount0Out < reserve0 && amount1Out < reserve1, "LIQUIDITY");
        if (amount0Out > 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out > 0) IERC20(token1).safeTransfer(to, amount1Out);
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        uint256 amount0In = balance0 > uint256(reserve0) - amount0Out ? balance0 - (uint256(reserve0) - amount0Out) : 0;
        uint256 amount1In = balance1 > uint256(reserve1) - amount1Out ? balance1 - (uint256(reserve1) - amount1Out) : 0;
        require(amount0In > 0 || amount1In > 0, "INPUT");
        uint256 adjusted0 = balance0 * 1_000 - amount0In * 3;
        uint256 adjusted1 = balance1 * 1_000 - amount1In * 3;
        require(adjusted0 * adjusted1 >= uint256(reserve0) * uint256(reserve1) * 1_000_000, "K");
        _sync();
    }

    function _sync() private {
        uint256 balance0 = IERC20(token0).balanceOf(address(this));
        uint256 balance1 = IERC20(token1).balanceOf(address(this));
        require(balance0 <= type(uint112).max && balance1 <= type(uint112).max, "OVERFLOW");
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
    }
}

contract MockV2Factory {
    mapping(address => mapping(address => address)) public getPair;
    address[] public allPairs;

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB && tokenA != address(0) && tokenB != address(0), "PAIR");
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(getPair[token0][token1] == address(0), "EXISTS");
        MockV2Pair deployed = new MockV2Pair();
        deployed.initialize(token0, token1);
        pair = address(deployed);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
    }

    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }
}
