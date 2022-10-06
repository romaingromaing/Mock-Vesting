//SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';


contract MockVesting is Ownable {
    /////////////////////
    // State Variables //
    /////////////////////

    //Address of recipient of vested tokens
    address private immutable beneficiary;

    //Token Balances
    //token address => token balance
    //initially funded token amounts (tracked by token)
    mapping(address => uint256) private initialBalances;
    //vested tokens available for claiming (tracked by token)
    mapping(address => uint256) private claimableBalances;
    //Total vested tokens (including those already claimed) (tracked by token)
    mapping(address => uint256) private vestedBalances;

    // list of token addresses
    address[] public tokens;

    //Non-ERC20 ETH balances
    //Initially funded ETH amount
    uint256 private initialEthBalance;
    //Vested ETH available for claiming
    uint256 private claimableEthBalance;
    //Total vested ETH (including those already claimed)
    uint256 private vestedEthBalance;
    
    //Variable to track whether fund function has been called
    bool public isFunded;
    //variable to track whether setVestingParams has been called
    bool public vestingParamsSet;
    // Start of unlock period (seconds since unix epoch)
    uint256 public unlockStartTime;
    // End of unlock period (seconds since unix epoch)
    uint256 public unlockEndTime; 
    // token emissions per second
    uint256 public vestingCoefficient;
    // token emissions per second - same as vestingCoefficient if there is one
    uint256 public vestingSlope;
    // Highest token balance - calculated during fund(), used to calculate vestingSlope in updateVestedBalances modifier
    uint256 private maxTokenBalance;
    //last timestamp of updateVestedBalances call
    uint256 private lastUpdated; 


    /////////////////
    // Constructor //
    /////////////////

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
            require(depositTx, 'Token deposit transaction failed');
            if(_amounts[i] > maxTokenBalance){ //this is used to calculate vestingSlope later
                maxTokenBalance = _amounts[i];
            }
            initialBalances[_tokens[i]] += _amounts[i];
            //using += instead of = to account for scenerio where somebody
            //uses the same token address twice in the _tokens array. As long as they have
            //tokens available, we'll accept that. And since default value for mapping is zero,
            //+= is essentially the same as = for new token deposits.
        }
        // toggle isFunded so fund() can't be called again
        isFunded = true;
    }

    //This overload function is called if no ethAmount specified
    //Same as above but leaves out ETH balances accounting
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
            require(depositTx, 'Token deposit transaction failed');
            if(_amounts[i] > maxTokenBalance){ //this is used to calculate vestingSlope later
                maxTokenBalance = _amounts[i];
            }
            initialBalances[_tokens[i]] += _amounts[i];
        }
        // toggle isFunded so fund() can't be called again
        isFunded = true;
    }

    //////////////
    // Withdraw //
    //////////////

    //withdraw all available vested tokens
    function withdraw() public updateVestedBalances {
        require(msg.sender == beneficiary, 'Only the beneficiary can withdraw tokens.');
        uint256 amount;
        for(uint8 i = 0; i < tokens.length; i++) {
            amount = claimableBalances[tokens[i]];
            claimableBalances[tokens[i]] = 0;
            IERC20(tokens[i]).transfer(msg.sender, amount);
        }
        //also need to account for vested eth if there is any.
        if(claimableEthBalance > 0) {
            //send eth to beneficiary
            amount = claimableEthBalance; 
            claimableEthBalance = 0;
            payable(msg.sender).transfer(amount);
        }
    }

    ////////////////////////////
    // Update Vested Balances //
    ////////////////////////////

    modifier updateVestedBalances {
        //check if end time and coefficient were set => they'll be zero if not.
        //if both are unset, do a full, instant unlock at unlockStartTime
        if(unlockEndTime == 0 && vestingCoefficient == 0){
            if(block.timestamp >= unlockStartTime) {
                for(uint8 i = 0; i < tokens.length; i++) {
                    claimableBalances[tokens[i]] = initialBalances[tokens[i]];
                    vestedBalances[tokens[i]] = claimableBalances[tokens[i]];
                }
                claimableEthBalance = initialEthBalance;
                vestedEthBalance = claimableEthBalance;
            }
        }
        // if unlockEndTime is nonzero but vestingCoefficient is zero, 
        // linear unlock without cliff
        else if(vestingCoefficient == 0){
            if(vestingSlope == 0) { //calculate vestingSlope the first time modifier is called
                vestingSlope = maxTokenBalance / (unlockEndTime - unlockStartTime); // dt/ds, tokens/second
                lastUpdated = unlockStartTime; //we want the initial value of lastUpdated to be unlockStartTime for calculations
            }
            if(block.timestamp >= unlockStartTime) {
                uint256 tokensClaimable = vestingSlope * (block.timestamp - lastUpdated); // tokens/second * time elapsed
                uint256 remainingBalance; //balance of unvested tokens
                for(uint8 i = 0; i < tokens.length; i++) {
                    //need to check if each individual token has enough tokens left! 
                    //Tokens with starting balances below the max will run out before the unlockEndTime
                    remainingBalance = initialBalances[tokens[i]] - vestedBalances[tokens[i]];
                    // if remaining balance > tokensClaimable, add full amount to claimableBalances
                    if(remainingBalance >= tokensClaimable) {
                        claimableBalances[tokens[i]] += tokensClaimable;
                        vestedBalances[tokens[i]] += tokensClaimable;
                    }
                    // if there are remaining tokens but less than tokensClaimable, only add the remaining tokens to claimableBalances
                    else if (remainingBalance > 0 && remainingBalance < tokensClaimable){
                        claimableBalances[tokens[i]] += remainingBalance;
                        vestedBalances[tokens[i]] += remainingBalance;
                    }               
                    // if remaining balance is zero, do nothing
                }
                //now handle eth
                remainingBalance = initialEthBalance - vestedEthBalance;
                // if remaining balance > tokensClaimable, add full amount to claimableBalances
                if(remainingBalance >= tokensClaimable) {
                    claimableEthBalance += tokensClaimable;
                    vestedEthBalance += tokensClaimable;
                }
                // if there are remaining tokens but less than tokensClaimable, only add the remaining tokens to claimableBalances
                else if (remainingBalance > 0 && remainingBalance < tokensClaimable){
                    claimableEthBalance += remainingBalance;
                    vestedEthBalance += remainingBalance;
                }               
                // if remaining balance is zero, do nothing

            }
        }
        else { //Linear unlock with cliff
            if(vestingSlope == 0) { //calculate vestingSlope the first time modifier is called
                vestingSlope = vestingCoefficient; // dt/ds, tokens/second
                lastUpdated = unlockStartTime; //we want the initial value of lastUpdated to be unlockStartTime for calculations
            }
            if(block.timestamp >= unlockStartTime && block.timestamp < unlockEndTime) {
                uint256 tokensClaimable = vestingSlope * (block.timestamp - lastUpdated); // tokens/second * time elapsed
                uint256 remainingBalance;
                for(uint8 i = 0; i < tokens.length; i++) {
                    //need to check if each individual token has enough tokens left! 
                    //Tokens with starting balances below the max will run out before the unlockEndTime
                    remainingBalance = initialBalances[tokens[i]] - vestedBalances[tokens[i]];
                    // if remaining balance > tokensClaimable, add full amount to claimableBalances
                    if(remainingBalance >= tokensClaimable) {
                        claimableBalances[tokens[i]] += tokensClaimable;
                        vestedBalances[tokens[i]] += tokensClaimable;
                    }
                    // if there are remaining tokens but less than tokensClaimable, only add the remaining tokens to claimableBalances
                    else if (remainingBalance > 0 && remainingBalance < tokensClaimable){
                        claimableBalances[tokens[i]] += remainingBalance;
                        vestedBalances[tokens[i]] += remainingBalance;
                    }               
                    // if remaining balance is zero, do nothing
                }
            }
            else if(block.timestamp >= unlockEndTime) {
                // all tokens unlocked
                uint256 remainingBalance;
                for(uint8 i = 0; i < tokens.length; i++) {
                    remainingBalance = initialBalances[tokens[i]] - vestedBalances[tokens[i]];
                    claimableBalances[tokens[i]] += remainingBalance;
                    vestedBalances[tokens[i]] += remainingBalance;
                }
                claimableEthBalance += initialEthBalance - vestedEthBalance;
                vestedEthBalance = initialEthBalance; //difference between initial and vested should now be zero
            }
        }
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
     *
     * - note that all times are calculated as # of seconds since unix epoch (00:00:00 UTC on 1 January 1970)
     */

    function setVestingParams(uint256 _unlockStartTime) public onlyOwner {
        require(!vestingParamsSet, 'You have already set vesting parameters.');
        unlockStartTime = _unlockStartTime;
        vestingParamsSet = true;
    }

    function setVestingParams(uint256 _unlockStartTime, uint256 _unlockEndTime) public onlyOwner {
        require(!vestingParamsSet, 'You have already set vesting parameters.');
        unlockStartTime = _unlockStartTime;
        unlockEndTime = _unlockEndTime;
        //in this case, vesting slope will be calculated so that whichever token has the highest initial balance
        //will be fully vested at unlockEndTime. Calculation will be done during first call of updateVestedBalances modifier
        vestingParamsSet = true;
    }

    function setVestingParams(uint256 _unlockStartTime, uint256 _unlockEndTime, uint256 _vestingCoefficient) public onlyOwner {
        require(!vestingParamsSet, 'You have already set vesting parameters.');
        unlockStartTime = _unlockStartTime;
        unlockEndTime = _unlockEndTime;
        vestingCoefficient = _vestingCoefficient;
        vestingParamsSet = true;
    }


    //////////////////////////
    // Get Unvested Balance // Returns unvested balance
    //////////////////////////

    //balance must be checked one token at a time
    function getUnvestedBalance(address tokenAddress) public view returns (uint256){
        require( //let's keep payment details private!
            msg.sender == beneficiary || msg.sender == owner(),
            'Only the owner and beneficiary are allowed to access this information.'
        );
        return initialBalances[tokenAddress] - vestedBalances[tokenAddress];
    }
    //Call function with no params to get ETH balance
    function getUnvestedBalance() public view returns (uint256){
        require( //let's keep payment details private!
            msg.sender == beneficiary || msg.sender == owner(),
            'Only the owner and beneficiary are allowed to access this information.'
        );
        return initialEthBalance - vestedEthBalance;
    }

    ///////////////////////////
    // Get Claimable Balance // returns vested, claimable token balance
    ///////////////////////////

    // put anything into the updateBalances slot to have it run the updateBalance modifier
    // ignore completely to run the below overload function which is view-only/gas-free
    function getClaimableBalance(address tokenAddress, bytes calldata /*updateBalances*/) public updateVestedBalances returns (uint256){
         require( //let's keep payment details private!
            msg.sender == beneficiary || msg.sender == owner(),
            'Only the owner and beneficiary are allowed to access this information.'
        );
        return claimableBalances[tokenAddress];
    }

    function getClaimableBalance(address tokenAddress) public view returns (uint256) {
         require( //let's keep payment details private!
            msg.sender == beneficiary || msg.sender == owner(),
            'Only the owner and beneficiary are allowed to access this information.'
        );
        return claimableBalances[tokenAddress];
    }

}