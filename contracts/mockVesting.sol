//SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

/* TO DO:
 * - implement vesting parameters - probably an updateVestedBalances() function or modifier
 * 
 * - Clean up comments
 */

contract MockVesting is Ownable {
    //Address of recipient of vested tokens
    address private immutable beneficiary;
    //Token Balances
    //token address => token balance
    mapping(address => uint256) private initialBalances;
    mapping(address => uint256) private claimableBalances;
    mapping(address => uint256) private claimedBalances;
    // list of token addresses
    address[] public tokens;
    //Non-ERC20 ETH balances
    uint256 private initialEthBalance;
    uint256 private claimableEthBalance;
    uint256 private claimedEthBalance;

    
    //Variable to track whether fund function has been called
    bool public isFunded;
    //variable to track whether setVestingParams has been called
    bool public vestingParamsSet;
    uint256 public unlockStartTime;
    uint256 public unlockEndTime; 
    uint8 public vestingCoefficient;


    constructor(address _beneficiary) {
        beneficiary = _beneficiary;
    }


    //////////
    // Fund //
    //////////

    //ethAmount optional - see overload function below
    function fund(address[] calldata _tokens, uint256[] calldata _amounts, uint256 ethAmount) public payable onlyOwner {
        require(!isFunded, 'Contract has already been funded.');
        require(vestingParamsSet, 'Please set vesting parameters before funding');
        require(msg.value == ethAmount, 'Please send exact amount of eth specified.'); 
        require(_tokens.length == _amounts.length, 'Be sure to specify an amount for each token being deposited!');
        tokens = _tokens;
        initialEthBalance = ethAmount;
        //loop through tokens, check balances, check approvals, transfer tokens to this contract, record balances in mapping
        for(uint8 i = 0; i < _tokens.length; i++){
            require(
                IERC20(_tokens[i]).balanceOf(msg.sender) >= _amounts[i],
                'You must have enough tokens on hand to deposit the specified amount.'
            );
            require( //I guess this isn't really necessary since it'll be rejected anyway
                IERC20(_tokens[i]).allowance(msg.sender,address(this)) >= _amounts[i],
                'You must approve spending for tokens being deposited'
            );
            bool depositTx = IERC20(_tokens[i]).transferFrom(msg.sender,address(this),_amounts[i]);
            require(depositTx == true, 'Token deposit transaction failed');

            initialBalances[_tokens[i]] += _amounts[i];
            //using += instead of = to account for idiotic scenerio where somebody
            //uses the same token address twice in the _tokens array. As long as they have
            //tokens available, we'll accept that. And since default value for mapping is zero,
            //+= is essentially the same as = for new token deposits.
        }
        isFunded = true;
    }

    //This overload function is called if no ethAmount specified
    function fund(address[] calldata _tokens, uint256[] calldata _amounts) public payable onlyOwner {
        require(isFunded == false, 'Contract has already been funded.');
        require(vestingParamsSet, 'Please set vesting parameters before funding');
        require(msg.value == 0, 'Specify an ethAmount argument if you wish to vest ETH.');
        require(_tokens.length == _amounts.length, 'Be sure to specify an amount for each token being deposited!');
        tokens = _tokens;
        //loop through tokens, check balances, check approvals, transfer tokens to this contract, record balances in mapping
        for(uint8 i = 0; i < _tokens.length; i++){
            require(
                IERC20(_tokens[i]).balanceOf(msg.sender) >= _amounts[i],
                'You must have enough tokens on hand to deposit the specified amount.'
            );
            require(
                IERC20(_tokens[i]).allowance(msg.sender,address(this)) >= _amounts[i],
                'You must approve spending for tokens being deposited'
            );
            bool depositTx = IERC20(_tokens[i]).transferFrom(msg.sender,address(this),_amounts[i]);
            require(depositTx == true, 'Token deposit transaction failed');

            initialBalances[_tokens[i]] += _amounts[i];
        }
        isFunded = true;
    }


    //////////////
    // Withdraw //
    //////////////

    //withdraw all available vested tokens
    function withdraw() public updateVestedBalances {
        require(msg.sender == beneficiary, 'Only the beneficiary can withdraw tokens.');
        for(uint8 i = 0; i < tokens.length; i++) {
            IERC20(tokens[i]).transfer(msg.sender,claimableBalances[tokens[i]]);
            claimableBalances[tokens[i]] = 0;
        }
        //also need to account for vested eth if there is any.
        if(claimableEthBalance > 0) {
            //send eth to beneficiary
            payable(msg.sender).transfer(claimableEthBalance);
            claimableEthBalance = 0;
        }
    }

    ////////////////////////////
    // Update Vested Balances //
    ////////////////////////////

    modifier updateVestedBalances {
        ///code

        _;
    }


    ////////////////////////////
    // Set Vesting Parameters //
    ////////////////////////////

    /* - If calling with only unlockStartTime - full unlock instantly at that time
     * - If calling with unlockStartTime and unlockEndTime - linear unlock calculated so that remaining vested
     *                                                       tokens is zero at end time
     * - If calling with unlockStartTime, unlockEndTime, and vestingCoefficient -
     *   Tokens will unlock linearly from start time with cliff to full unlock at end time if any tokens remaining
     */
    function setVestingParams(uint256 _unlockStartTime) public onlyOwner {
        require(!vestingParamsSet, 'You have already set vesting parameters.');
        unlockStartTime = _unlockStartTime;
    }

    function setVestingParams(uint256 _unlockStartTime, uint256 _unlockEndTime) public onlyOwner {
        require(!vestingParamsSet, 'You have already set vesting parameters.');
        unlockStartTime = _unlockStartTime;
        unlockEndTime = _unlockEndTime;
    }

    function setVestingParams(uint256 _unlockStartTime, uint256 _unlockEndTime, uint8 _vestingCoefficient) public onlyOwner {
        require(!vestingParamsSet, 'You have already set vesting parameters.');
        unlockStartTime = _unlockStartTime;
        unlockEndTime = _unlockEndTime;
        vestingCoefficient = _vestingCoefficient;
    }


    /////////////////
    // Get Balance // Returns total remaining balance
    /////////////////

    //need to change to specify vested or unvested.
    //balance must be checked one token at a time
    function getBalance(address tokenAddress) public view returns (uint256){
        require(
            msg.sender == beneficiary || msg.sender == owner(),
            'Only the owner and beneficiary are allowed to access this information.'
        );
        return initialBalances[tokenAddress] - claimedBalances[tokenAddress];
    }
    //if params are left empty, return ETH balance
    function getBalance() public view returns (uint256){
        require(
            msg.sender == beneficiary || msg.sender == owner(),
            'Only the owner and beneficiary are allowed to access this information.'
        );
        return initialEthBalance - claimedEthBalance;
    }

    ///////////////////////////
    // Get Claimable Balance // returns vested, claimable token balance
    ///////////////////////////

    // put anything into the updateBalances slot to have it run the updateBalance modifier
    // ignore completely to run the below overload function which is view-only/gas-free
    function getClaimableBalance(address tokenAddress, bytes calldata /*updateBalances*/) public updateVestedBalances returns (uint256){
        return claimableBalances[tokenAddress];
    }

    function getClaimableBalance(address tokenAddress) public view returns (uint256) {
        return claimableBalances[tokenAddress];
    }

}