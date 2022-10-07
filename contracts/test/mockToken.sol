// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {

    uint256 private immutable INITIAL_SUPPLY; 

    constructor(uint256 _initialSupply) ERC20("MockToken", "MOCK") {
        INITIAL_SUPPLY = _initialSupply;
        
        _mint(msg.sender, INITIAL_SUPPLY); //mints initial supply to deployer
    }


}