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

    //native ETH vesting optional - simply include a msg.value when calling fund()
    function fund(address[] calldata _tokens, uint256[] calldata _amounts) public payable onlyOwner {
        require(!isFunded, 'Contract has already been funded.');
        require(vestingParamsSet, 'Please set vesting parameters before funding.');
        require(_tokens.length == _amounts.length, 'Be sure to specify an amount for each token being deposited!');
        
        tokens = _tokens;
        initialEthBalance = msg.value;
        maxTokenBalance = initialEthBalance;

        //loop through tokens, check balances, check approvals, transfer tokens to this contract, record balances in mapping
        for(uint256 i = 0; i < _tokens.length; i++){
            IERC20(_tokens[i]).transferFrom(msg.sender,address(this),_amounts[i]);
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

    

    //////////////
    // Withdraw //
    //////////////

    //withdraw all claimable balance of a selected token
    //include 2nd param to run updateBalance modifier (typically for the first token you're withdrawing)
    //include only token address to skip updateBalances
    //leave params blank to claim ETH
    function withdraw(address token, bytes calldata /*updateBalance*/) public updateVestedBalances {
        require(msg.sender == beneficiary, 'Only the beneficiary can withdraw tokens.');
        require(claimableBalances[token] > 0, 'That token has no claimable balance.');
        uint256 amount = claimableBalances[token];
        claimableBalances[token] = 0;
        IERC20(token).transfer(msg.sender, amount);
    }

    function withdraw(address token) public {
        require(msg.sender == beneficiary, 'Only the beneficiary can withdraw tokens.');
        require(claimableBalances[token] > 0, 'That token has no claimable balance.');
        uint256 amount = claimableBalances[token];
        claimableBalances[token] = 0;
        IERC20(token).transfer(msg.sender, amount);
    }

    function withdraw() public {
        require(msg.sender == beneficiary, 'Only the beneficiary can withdraw tokens.');
        require(claimableEthBalance > 0, 'There is no ETH available to claim.');
        uint256 amount = claimableEthBalance; 
        claimableEthBalance = 0;
        payable(msg.sender).transfer(amount);
    }

    ////////////////////////////
    // Update Vested Balances //
    ////////////////////////////

    //Handles 3 vesting scenerios laid out in setVestingParams()
    //Is called before withdraw() or optionally when calling getClaimableBalance()

    modifier updateVestedBalances {
        //check if end time and coefficient were set => they'll be zero if not.
        //if both are unset, do a full, instant unlock at unlockStartTime
        if(unlockEndTime == 0 && vestingCoefficient == 0){
            if(block.timestamp >= unlockStartTime) {
                handleFullyVested();
            }
        }
        // if unlockEndTime is nonzero but vestingCoefficient is zero, 
        // linear unlock without cliff
        else if(vestingCoefficient == 0){/*vestingSlope and vestingCoefficient are separated out so that this 
                                          *if statement will still trigger (i.e. vestingCoefficient will remain zero)
                                          *after the slope is calculated below*/
            if(vestingSlope == 0) { //calculate vestingSlope the first time modifier is called
                vestingSlope = maxTokenBalance / (unlockEndTime - unlockStartTime); // dt/ds, tokens/second
                lastUpdated = unlockStartTime; //we want the initial value of lastUpdated to be unlockStartTime for calculations
            }
            uint256 currentTime = block.timestamp;
            if(currentTime >= unlockStartTime) {
                uint256 tokensClaimable = vestingSlope * (currentTime - lastUpdated); // tokens/second * time elapsed
                //update lastUpdated
                lastUpdated = currentTime;

                handleTokenAccrual(tokensClaimable);
                handleEthAccrual(tokensClaimable);
            }
        }
        else { //Linear unlock with cliff
            if(vestingSlope == 0) { //calculate vestingSlope the first time modifier is called
                vestingSlope = vestingCoefficient; // dt/ds, tokens/second
                lastUpdated = unlockStartTime; //we want the initial value of lastUpdated to be unlockStartTime for calculations
            }
            uint256 currentTime = block.timestamp;
            if(currentTime >= unlockStartTime && currentTime < unlockEndTime) {
                uint256 tokensClaimable = vestingSlope * (currentTime - lastUpdated); // tokens/second * time elapsed
                //update lastUpdated
                lastUpdated = currentTime;

                handleTokenAccrual(tokensClaimable);
                handleEthAccrual(tokensClaimable);
            }
            else if(currentTime >= unlockEndTime) {
                handleFullyVested();
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

    //////////////////////
    // Getter Functions //
    //////////////////////

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
    // leave parameters totally empty for eth balance
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

    function getClaimableBalance() public view returns (uint256) {
        require( //let's keep payment details private!
            msg.sender == beneficiary || msg.sender == owner(),
            'Only the owner and beneficiary are allowed to access this information.'
        );
        return claimableEthBalance;
    }

    //////////////////////
    // Helper Functions // functions to modularize parts of the updateVestingBalances modifier
    //////////////////////

    //loops through tokens and adds to balances where necessary
    //called within the updateBalances modifier
    function handleTokenAccrual(uint256 tokensClaimable) internal {
        for(uint256 i = 0; i < tokens.length; i++) {
            //need to check if each individual token has enough tokens left! 
            //Tokens with starting balances below the max will run out before the unlockEndTime
            uint256 remainingBalance = initialBalances[tokens[i]] - vestedBalances[tokens[i]];
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

    //same as above but for ETH
    function handleEthAccrual(uint256 tokensClaimable) internal {
        uint256 remainingBalance = initialEthBalance - vestedEthBalance;
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

    //unlocks all remaining tokens
    //called when unlockEndTime has passed
    function handleFullyVested() internal {
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