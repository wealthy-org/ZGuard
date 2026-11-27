// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Burns a fixed share on every non-mint, non-burn transfer.
contract MockFeeOnTransferERC20 is ERC20 {
    uint16 public immutable feeBps;

    constructor(string memory name_, string memory symbol_, uint16 feeBps_) ERC20(name_, symbol_) {
        require(feeBps_ <= 10_000, "FEE");
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = value * feeBps / 10_000;
        if (fee != 0) super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}
