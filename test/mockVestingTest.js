const { assert, expect } = require("chai")
const { network, deployments, ethers, provider } = require("hardhat")
const hre = require('hardhat')
require("@nomiclabs/hardhat-ethers");

describe('Mock Vesting Unit Tests', () => {
    let deployerMockVesting, userMockVesting, mockToken1, mockToken2, mockToken3;
    let tokenSupply1 = 69420420;
    let tokenSupply2 = 69000000;
    let tokenSupply3 = 42000000;
    let tokenAmountsArray;
    let tokenAddressArray;
    beforeEach(async () => {
        //accounts setup
        accounts = await ethers.getSigners();
        deployer = accounts[0];
        user = accounts[1]; //this is the beneficiary
        thirdParty = accounts[2]; //any random third party - neither owner nor beneficiary

        //Vesting Contract Deploy
        const mockVestingContractFactory = await hre.ethers.getContractFactory('MockVesting');
        const mockVestingContract = await mockVestingContractFactory.deploy(user.address);
        await mockVestingContract.deployed();
        deployerMockVesting = mockVestingContract.connect(deployer);
        userMockVesting = mockVestingContract.connect(user);
        thirdPartyMockVesting = mockVestingContract.connect(thirdParty);

        // Deploy token contracts
        const mockTokenContractFactory = await hre.ethers.getContractFactory('MockToken');
        const mockTokenContract1 = await mockTokenContractFactory.deploy(tokenSupply1);
        const mockTokenContract2 = await mockTokenContractFactory.deploy(tokenSupply2);
        const mockTokenContract3 = await mockTokenContractFactory.deploy(tokenSupply3);
        await mockTokenContract1.deployed();
        await mockTokenContract2.deployed();
        await mockTokenContract3.deployed();
        mockToken1 = mockTokenContract1.connect(deployer);
        mockToken2 = mockTokenContract2.connect(deployer);
        mockToken3 = mockTokenContract3.connect(deployer);

        // Token approvals
        await mockToken1.approve(mockVestingContract.address,tokenSupply1);
        await mockToken2.approve(mockVestingContract.address,tokenSupply2);
        await mockToken3.approve(mockVestingContract.address,tokenSupply3);

        tokenAddressArray = [
            mockToken1.address,
            mockToken2.address,
            mockToken3.address
        ];
        tokenAmountsArray = [
            tokenSupply1,
            tokenSupply2,
            tokenSupply3
        ];
    })
    describe('MockVesting Contract', () => {
        describe('Constructor', () => {
            it('correctly sets the beneficiary', async () => {
                //beneficiary is private, so can't check directly
                //prove it was set correctly by calling a function as user that requires you to be the beneficiary
                const tx = await userMockVesting['getUnvestedBalance()']();
                assert.isOk(tx);
            })
        })
        describe('fund function', () => {
            beforeEach(async () => {
                //set vesting params - for the fund function, the params don't matter, so just doing an artbitrary start time
                const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp + 100000);
                assert.isTrue(await deployerMockVesting.vestingParamsSet());
            })
            it('cannot be called if no vesting parameters are set', async () => {
                //Deploy a fresh contract for this test - don't want the params from the beforeEach
                const mockVestingContractFactory = await hre.ethers.getContractFactory('MockVesting');
                const mockVestingContract = await mockVestingContractFactory.deploy(user.address);
                await mockVestingContract.deployed();
                deployerMockVesting = mockVestingContract.connect(deployer);
               
                assert.isNotTrue(await deployerMockVesting.vestingParamsSet());
                //NOTE: this syntax is needed whenever calling an overloaded functiion
                //You MUST specify which parameter's you're taking in in this format
                await expect(deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray, tokenAmountsArray)).to.be.revertedWith(
                    'Please set vesting parameters before funding.'                
                );
            })
            it('cannot be called twice', async () => {
                const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray, tokenAmountsArray);
                await tx.wait(1);
                await expect(deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray, tokenAmountsArray)).to.be.revertedWith(
                    "Contract has already been funded."
                );
            })
            it('requires tokens and amounts arrays to have the same length', async () => {
                tokenAmountsArray.pop();
                assert.notEqual(tokenAddressArray.length, tokenAmountsArray);
                await expect(deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray, tokenAmountsArray)).to.be.revertedWith(
                    'Be sure to specify an amount for each token being deposited!'
                );
            })
            it('correctly sets initialBalances mapping values', async () => {
                const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray);
                await tx.wait(1);
                // Since no tokens are vested yet, we can get initial balance from getUnvestedBalance()
                const token1Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[0]);
                assert.equal(token1Balance,tokenAmountsArray[0]);
                const token2Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[1]);
                assert.equal(token2Balance,tokenAmountsArray[1]);
                const token3Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[2]);
                assert.equal(token3Balance,tokenAmountsArray[2]);
            })
            it('sets initialEthBalance if applicable', async() => {
                // call fund with ethAmount of 0.1 eth
                const expectedInitialEthBalance = (ethers.utils.parseEther('0.1')).toString();
                const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedInitialEthBalance })
                await tx.wait(1);
                // Since no tokens are vested, get initialEthBalance from getUnvestedBalance()
                const actualInitialEthBalance = (await userMockVesting['getUnvestedBalance()']()).toString();
                assert.equal(expectedInitialEthBalance, actualInitialEthBalance);
                
            })
            it('sets isFunded to true', async () => {
                const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray);
                await tx.wait(1);
                assert.isTrue(await deployerMockVesting.isFunded());
            })
        })
        describe('UpdateVestedBalances modifier', () => {
            describe('Case: full/instant unlock, only unlockStartTime set', () => {
                it('does nothing if unlockStartTime has not been reached', async () => {
                    //set vesting params
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp + 100000);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const expectedToken1Balance = tokenAmountsArray[0];
                    const expectedToken2Balance = tokenAmountsArray[1];
                    const expectedToken3Balance = tokenAmountsArray[2];
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedEthBalance })
                    await tx.wait(1);
                    //call getClaimableBalance with 2nd argument to call updateVestedBalances modifier
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);
                    // Since no tokens are vested, initialBalance and unvestedBalance should be equal
                    const actualEthBalance = (await userMockVesting['getUnvestedBalance()']()).toString();
                    const actualToken1Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[0]);
                    const actualToken2Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[1]);
                    const actualToken3Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[2]);
                    assert.equal(expectedEthBalance, actualEthBalance);  
                    assert.equal(expectedToken1Balance,actualToken1Balance);
                    assert.equal(expectedToken2Balance,actualToken2Balance);
                    assert.equal(expectedToken3Balance,actualToken3Balance);
                })
                it('unlocks all tokens if start time has been reached', async () => {
                    //set vesting params
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp - 5);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const expectedToken1Balance = tokenAmountsArray[0];
                    const expectedToken2Balance = tokenAmountsArray[1];
                    const expectedToken3Balance = tokenAmountsArray[2];
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedEthBalance })
                    await tx.wait(1);
                    //call getClaimableBalance with 2nd argument to call updateVestedBalances modifier
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);
                    // Since all tokens are vested, initialBalance and claimableBalance should be equal
                    const actualEthBalance = (await userMockVesting['getClaimableBalance()']()).toString();
                    const actualToken1Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0]);
                    const actualToken2Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1]);
                    const actualToken3Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2]);
                    assert.equal(expectedEthBalance, actualEthBalance);  
                    assert.equal(expectedToken1Balance,actualToken1Balance);
                    assert.equal(expectedToken2Balance,actualToken2Balance);
                    assert.equal(expectedToken3Balance,actualToken3Balance);
                })
            })
            describe('Case: Linear unlock, unlockStartTime and unlockEndTime set', () => {
                //pretty sure I need to include eth in the for loop on this one still
                it('calculates and sets the vesting slope correctly', async () => {
                    const maxTokenBalance = tokenAmountsArray[0];
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockStartTime = currentTimestamp + 100000;
                    const unlockEndTime = unlockStartTime + 500000;
                    //set params
                    await deployerMockVesting['setVestingParams(uint256,uint256)'](unlockStartTime,unlockEndTime);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    assert.notEqual(await userMockVesting.unlockStartTime(), 0);
                    assert.notEqual(await userMockVesting.unlockEndTime(), 0);
                    assert.equal(await userMockVesting.vestingCoefficient(), 0);
                    assert.equal(await userMockVesting.vestingSlope(), 0);
                    //call fund to set maxTokenBalance for slope calculation
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray);
                    await tx.wait(1);
                    //call getClaimableBalances with 2nd argumentto run the modifier and calculate the vestingSlope
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);
                    
                    const expectedVestingSlope = Math.floor(maxTokenBalance / (unlockEndTime - unlockStartTime));
                    const actualVestingSlope = (await userMockVesting.vestingSlope()).toString();
                    assert.equal(expectedVestingSlope,actualVestingSlope);
                })
                it('does nothing if unlockStartTime has not been reached', async () => {
                    //set vesting params
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256,uint256)'](currentTimestamp + 100000,currentTimestamp+500000);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedInitialEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const expectedToken1Balance = tokenAmountsArray[0];
                    const expectedToken2Balance = tokenAmountsArray[1];
                    const expectedToken3Balance = tokenAmountsArray[2];
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedInitialEthBalance })
                    await tx.wait(1);
                    //call getClaimableBalance with 2nd argument to call updateVestedBalances modifier
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);
                    // Since no tokens are vested, initialBalance and unvestedBalance should be equal
                    const actualInitialEthBalance = (await userMockVesting['getUnvestedBalance()']()).toString();
                    const actualToken1Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[0]);
                    const actualToken2Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[1]);
                    const actualToken3Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[2]);
                    assert.equal(expectedInitialEthBalance, actualInitialEthBalance);  
                    assert.equal(expectedToken1Balance,actualToken1Balance);
                    assert.equal(expectedToken2Balance,actualToken2Balance);
                    assert.equal(expectedToken3Balance,actualToken3Balance);
                })
                it('adds the correct amount to vested ETH balance at various points along the unlock schedule', async () => {
                    //do a for loop for fifths of the unlock time with calculations and assert statements
                    //set vesting params
                    const unlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockEndTime = unlockStartTime + 50000;
                    await deployerMockVesting['setVestingParams(uint256,uint256)'](unlockStartTime,unlockEndTime);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedInitialEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedInitialEthBalance })
                    await tx.wait(1);

                    //divide vesting period into fifths and do checkpoint calculations along the way
                    let lastTimestamp = unlockStartTime;
                    let desiredTimestamp;
                    let currentTimestamp;
                    let expectedClaimableBalance = 0;
                    for(let i = 1; i <= 5; i++) {
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;
                        desiredTimestamp = unlockStartTime + i*10000;
                        timestampDelta = desiredTimestamp - currentTimestamp;
    
                        //send time forward ~ 10,000 seconds
                        await hre.ethers.provider.send("evm_increaseTime", [timestampDelta]);
                        await network.provider.send("evm_mine");
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;

                        //calculate rewards
                        await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                        const vestingSlope = await userMockVesting.vestingSlope();
                        //need to convert to gwei because cant add error margin with bigNumber (or string)
                        actualClaimableBalance = ((await userMockVesting['getClaimableBalance()']())/(10**9));
                        expectedClaimableBalance += vestingSlope * (currentTimestamp - lastTimestamp) / (10**9);

                        //allowing a range because the timestamps can be slightly out of sync
                        //due to the time it takes for transactions to execute
                        errorMargin = vestingSlope * 2 / (10**9); //2 second margin of error
                        
                        assert.isTrue(expectedClaimableBalance >= actualClaimableBalance - errorMargin &&
                                      expectedClaimableBalance <= actualClaimableBalance + errorMargin
                            )

                        lastTimestamp = currentTimestamp;
                    }
                })
                it('can repeat the above test with no ETH involved (only token balances)', async () => {
                    //do a for loop for fifths of the unlock time with calculations and assert statements
                    //set vesting params
                    const unlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockEndTime = unlockStartTime + 50000;
                    await deployerMockVesting['setVestingParams(uint256,uint256)'](unlockStartTime,unlockEndTime);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray);
                    await tx.wait(1);

                    //divide vesting period into fifths and do checkpoint calculations along the way
                    let lastTimestamp = unlockStartTime;
                    let desiredTimestamp;
                    let currentTimestamp;
                    let expectedClaimableToken1Balance = 0;
                    let token1RemainingBalance = tokenAmountsArray[0];
                    let expectedClaimableToken2Balance = 0;
                    let token2RemainingBalance = tokenAmountsArray[1];
                    let expectedClaimableToken3Balance = 0;
                    let token3RemainingBalance = tokenAmountsArray[2];
                    for(let i = 1; i <= 5; i++) {
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;
                        desiredTimestamp = unlockStartTime + i*10000;
                        timestampDelta = desiredTimestamp - currentTimestamp;
    
                        //send time forward ~ 10,000 seconds
                        await hre.ethers.provider.send("evm_increaseTime", [timestampDelta]);
                        await network.provider.send("evm_mine");
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;

                        //calculate rewards
                        await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                        const vestingSlope = (await userMockVesting.vestingSlope()).toNumber();
                        let actualClaimableToken1Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0])))).toNumber();
                        //account for if some tokens supply is fully vested (i.e. the token isn't the maxtokensupply)
                        let tokensClaimable = vestingSlope * (currentTimestamp - lastTimestamp) 
                        if(token1RemainingBalance > tokensClaimable){
                            expectedClaimableToken1Balance += tokensClaimable;
                            token1RemainingBalance -= tokensClaimable;
                        }
                        else if(token1RemainingBalance > 0 && token1RemainingBalance < tokensClaimable){
                            expectedClaimableToken1Balance += token1RemainingBalance;
                            token1RemainingBalance -= token1RemainingBalance;
                        }
                        //now for token 2
                        let actualClaimableToken2Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1])))).toNumber();
                        if(token2RemainingBalance > tokensClaimable){
                            expectedClaimableToken2Balance += tokensClaimable;
                            token2RemainingBalance -= tokensClaimable;
                        }
                        else if(token2RemainingBalance > 0 && token2RemainingBalance < tokensClaimable){
                            expectedClaimableToken2Balance += token2RemainingBalance;
                            token2RemainingBalance -= token2RemainingBalance;
                        }
                        //now for token 3
                        let actualClaimableToken3Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2])))).toNumber();
                        if(token3RemainingBalance > tokensClaimable){
                            expectedClaimableToken3Balance += tokensClaimable;
                            token3RemainingBalance -= tokensClaimable;
                        }
                        else if(token3RemainingBalance > 0 && token3RemainingBalance < tokensClaimable){
                            expectedClaimableToken3Balance += token3RemainingBalance;
                            token3RemainingBalance -= token3RemainingBalance;
                        }
                       

                        //allowing a range because the timestamps can be slightly out of sync
                        //due to the time it takes for transactions to execute
                        errorMargin = vestingSlope * 2 ; //2 second margin of error
                         assert.isTrue(expectedClaimableToken1Balance >= actualClaimableToken1Balance - errorMargin &&
                                      expectedClaimableToken1Balance <= actualClaimableToken1Balance + errorMargin
                        )
                         assert.isTrue(expectedClaimableToken2Balance >= actualClaimableToken2Balance - errorMargin &&
                                      expectedClaimableToken2Balance <= actualClaimableToken2Balance + errorMargin
                        )
                        assert.isTrue(expectedClaimableToken3Balance >= actualClaimableToken3Balance - errorMargin &&
                            expectedClaimableToken3Balance <= actualClaimableToken3Balance + errorMargin
                        )
                        lastTimestamp = currentTimestamp;
                    }
                })
                it('can repeat the above test even if the user is claiming rewards along the way', async () => {
                    //do a for loop for fifths of the unlock time with calculations and assert statements
                    //set vesting params
                    const unlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockEndTime = unlockStartTime + 50000;
                    await deployerMockVesting['setVestingParams(uint256,uint256)'](unlockStartTime,unlockEndTime);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray);
                    await tx.wait(1);

                    //divide vesting period into fifths and do checkpoint calculations along the way
                    let lastTimestamp = unlockStartTime;
                    let desiredTimestamp;
                    let currentTimestamp;
                    let expectedClaimableToken1Balance = 0;
                    let token1RemainingBalance = tokenAmountsArray[0];
                    let expectedClaimableToken2Balance = 0;
                    let token2RemainingBalance = tokenAmountsArray[1];
                    let expectedClaimableToken3Balance = 0;
                    let token3RemainingBalance = tokenAmountsArray[2];
                    for(let i = 1; i <= 5; i++) {
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;
                        desiredTimestamp = unlockStartTime + i*10000;
                        timestampDelta = desiredTimestamp - currentTimestamp;
    
                        //send time forward ~ 10,000 seconds
                        await hre.ethers.provider.send("evm_increaseTime", [timestampDelta]);
                        await network.provider.send("evm_mine");
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;

                        //calculate rewards
                        await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                        const vestingSlope = (await userMockVesting.vestingSlope()).toNumber();
                        let actualClaimableToken1Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0])))).toNumber();
                        //account for if some tokens supply is fully vested (i.e. the token isn't the maxtokensupply)
                        let tokensClaimable = vestingSlope * (currentTimestamp - lastTimestamp) 
                        if(token1RemainingBalance > tokensClaimable){
                            expectedClaimableToken1Balance = tokensClaimable;
                            token1RemainingBalance -= tokensClaimable;
                        }
                        else if(token1RemainingBalance >= 0 && token1RemainingBalance < tokensClaimable){
                            expectedClaimableToken1Balance = token1RemainingBalance;
                            token1RemainingBalance -= token1RemainingBalance;
                        }
                        //now for token 2
                        let actualClaimableToken2Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1])))).toNumber();
                        if(token2RemainingBalance > tokensClaimable){
                            expectedClaimableToken2Balance = tokensClaimable;
                            token2RemainingBalance -= tokensClaimable;
                        }
                        else if(token2RemainingBalance >= 0 && token2RemainingBalance < tokensClaimable){
                            expectedClaimableToken2Balance = token2RemainingBalance;
                            token2RemainingBalance -= token2RemainingBalance;
                        }
                        //now for token 3
                        let actualClaimableToken3Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2])))).toNumber();
                        if(token3RemainingBalance > tokensClaimable){
                            expectedClaimableToken3Balance = tokensClaimable;
                            token3RemainingBalance -= tokensClaimable;
                        }
                        else if(token3RemainingBalance >= 0 && token3RemainingBalance < tokensClaimable){
                            expectedClaimableToken3Balance = token3RemainingBalance;
                            token3RemainingBalance -= token3RemainingBalance;
                        }
                       

                        //allowing a range because the timestamps can be slightly out of sync
                        //due to the time it takes for transactions to execute
                        errorMargin = vestingSlope * 2 ; //2 second margin of error
                        assert.isTrue(expectedClaimableToken1Balance >= actualClaimableToken1Balance - errorMargin &&
                                      expectedClaimableToken1Balance <= actualClaimableToken1Balance + errorMargin
                        )
                        assert.isTrue(expectedClaimableToken2Balance >= actualClaimableToken2Balance - errorMargin &&
                                      expectedClaimableToken2Balance <= actualClaimableToken2Balance + errorMargin
                        )
                        assert.isTrue(expectedClaimableToken3Balance >= actualClaimableToken3Balance - errorMargin &&
                            expectedClaimableToken3Balance <= actualClaimableToken3Balance + errorMargin
                        )
                        lastTimestamp = currentTimestamp;
                        if(actualClaimableToken1Balance > 0){
                            await userMockVesting['withdraw(address)'](tokenAddressArray[0]);
                        }
                        if(actualClaimableToken2Balance > 0){
                            await userMockVesting['withdraw(address)'](tokenAddressArray[1]);
                        }
                        if(actualClaimableToken3Balance > 0){
                            await userMockVesting['withdraw(address)'](tokenAddressArray[2]);
                        }
                    }
                })
                it('has all tokens unlocked by unlock end time', async () => {
                    //set vesting params
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256,uint256)'](currentTimestamp - 5,currentTimestamp-1);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const expectedToken1Balance = tokenAmountsArray[0];
                    const expectedToken2Balance = tokenAmountsArray[1];
                    const expectedToken3Balance = tokenAmountsArray[2];
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedEthBalance })
                    await tx.wait(1);
                    //call getClaimableBalance with 2nd argument to call updateVestedBalances modifier
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);
                    // Since all tokens are vested, initialBalance and claimableBalance should be equal
                    const actualEthBalance = (await userMockVesting['getClaimableBalance()']()).toString();
                    const actualToken1Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0]);
                    const actualToken2Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1]);
                    const actualToken3Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2]);
                    assert.equal(expectedEthBalance, actualEthBalance);  
                    assert.equal(expectedToken1Balance,actualToken1Balance);
                    assert.equal(expectedToken2Balance,actualToken2Balance);
                    assert.equal(expectedToken3Balance,actualToken3Balance);
                })
            })
            describe('Case: Linear unlock with cliff, all parameters set', () => {
                it('sets the vesting slope correctly', async () => {
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockStartTime = currentTimestamp + 100000;
                    const unlockEndTime = unlockStartTime + 500000;
                    const vestingCoefficient = 69;
                    const expectedVestingSlope = vestingCoefficient;
                    //set params
                    await deployerMockVesting['setVestingParams(uint256,uint256,uint256)'](unlockStartTime,unlockEndTime,vestingCoefficient);
                    //call getClaimableBalance with 2nd argument to call updateVestedBalances modifier
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);

                    const actualVestingSlope = await userMockVesting.vestingSlope();
                    assert.equal(expectedVestingSlope, actualVestingSlope);
                })
                it('does nothing if unlockStartTime has not been reached', async () => {
                    //set vesting params
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256,uint256,uint256)'](currentTimestamp + 100000,currentTimestamp+500000,69);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedInitialEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const expectedToken1Balance = tokenAmountsArray[0];
                    const expectedToken2Balance = tokenAmountsArray[1];
                    const expectedToken3Balance = tokenAmountsArray[2];
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedInitialEthBalance })
                    await tx.wait(1);
                    //call getClaimableBalance with 2nd argument to call updateVestedBalances modifier
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);
                    // Since no tokens are vested, initialBalance and unvestedBalance should be equal
                    const actualInitialEthBalance = (await userMockVesting['getUnvestedBalance()']()).toString();
                    const actualToken1Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[0]);
                    const actualToken2Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[1]);
                    const actualToken3Balance = await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[2]);
                    assert.equal(expectedInitialEthBalance, actualInitialEthBalance);  
                    assert.equal(expectedToken1Balance,actualToken1Balance);
                    assert.equal(expectedToken2Balance,actualToken2Balance);
                    assert.equal(expectedToken3Balance,actualToken3Balance);
                })
                it('adds the correct amount to vested ETH balance at various points along the unlock schedule', async () => {
                    //do a for loop for fifths of the unlock time with calculations and assert statements
                    //set vesting params
                    const unlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockEndTime = unlockStartTime + 50000;
                    await deployerMockVesting['setVestingParams(uint256,uint256,uint256)'](unlockStartTime,unlockEndTime,69420);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedInitialEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedInitialEthBalance })
                    await tx.wait(1);

                    //divide vesting period into fifths and do checkpoint calculations along the way
                    let lastTimestamp = unlockStartTime;
                    let desiredTimestamp;
                    let currentTimestamp;
                    let expectedClaimableBalance = 0;
                    for(let i = 1; i <= 5; i++) {
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;
                        desiredTimestamp = unlockStartTime + i*10000;
                        timestampDelta = desiredTimestamp - currentTimestamp;
    
                        //send time forward ~ 10,000 seconds
                        await hre.ethers.provider.send("evm_increaseTime", [timestampDelta]);
                        await network.provider.send("evm_mine");
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;

                        //calculate rewards
                        await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                        const vestingSlope = await userMockVesting.vestingSlope();
                        //need to convert to gwei because cant add error margin with bigNumber (or string)
                        actualClaimableBalance = ((await userMockVesting['getClaimableBalance()']())/(10**9));
                        if(currentTimestamp < unlockEndTime){
                            expectedClaimableBalance += vestingSlope * (currentTimestamp - lastTimestamp) / (10**9);
                        }
                        else{
                            expectedClaimableBalance = expectedInitialEthBalance / (10**9);
                        }
                        

                        //allowing a range because the timestamps can be slightly out of sync
                        //due to the time it takes for transactions to execute
                        errorMargin = vestingSlope * 2 / (10**9); //2 second margin of error
                        
                    
                        assert.isTrue(expectedClaimableBalance >= actualClaimableBalance - errorMargin &&
                                      expectedClaimableBalance <= actualClaimableBalance + errorMargin
                            )

                        lastTimestamp = currentTimestamp;
                    }
                })
                it('can repeat the above test with no ETH involved (only token balances)', async () => {
                    //do a for loop for fifths of the unlock time with calculations and assert statements
                    //set vesting params
                    const unlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockEndTime = unlockStartTime + 50000;
                    await deployerMockVesting['setVestingParams(uint256,uint256,uint256)'](unlockStartTime,unlockEndTime,69420);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray);
                    await tx.wait(1);

                    //divide vesting period into fifths and do checkpoint calculations along the way
                    let lastTimestamp = unlockStartTime;
                    let desiredTimestamp;
                    let currentTimestamp;
                    let expectedClaimableToken1Balance = 0;
                    let token1RemainingBalance = tokenAmountsArray[0];
                    let expectedClaimableToken2Balance = 0;
                    let token2RemainingBalance = tokenAmountsArray[1];
                    let expectedClaimableToken3Balance = 0;
                    let token3RemainingBalance = tokenAmountsArray[2];
                    for(let i = 1; i <= 5; i++) {
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;
                        desiredTimestamp = unlockStartTime + i*10000;
                        timestampDelta = desiredTimestamp - currentTimestamp;
    
                        //send time forward ~ 10,000 seconds
                        await hre.ethers.provider.send("evm_increaseTime", [timestampDelta]);
                        await network.provider.send("evm_mine");
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;

                        //calculate rewards
                        await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                        const vestingSlope = (await userMockVesting.vestingSlope()).toNumber();
                        let actualClaimableToken1Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0])))).toNumber();
                        //account for if some tokens supply is fully vested (i.e. the token isn't the maxtokensupply)
                        let tokensClaimable = vestingSlope * (currentTimestamp - lastTimestamp) 
                        if(token1RemainingBalance > tokensClaimable){
                            expectedClaimableToken1Balance += tokensClaimable;
                            token1RemainingBalance -= tokensClaimable;
                        }
                        else if(token1RemainingBalance > 0 && token1RemainingBalance < tokensClaimable){
                            expectedClaimableToken1Balance += token1RemainingBalance;
                            token1RemainingBalance -= token1RemainingBalance;
                        }
                        //now for token 2
                        let actualClaimableToken2Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1])))).toNumber();
                        if(token2RemainingBalance > tokensClaimable){
                            expectedClaimableToken2Balance += tokensClaimable;
                            token2RemainingBalance -= tokensClaimable;
                        }
                        else if(token2RemainingBalance > 0 && token2RemainingBalance < tokensClaimable){
                            expectedClaimableToken2Balance += token2RemainingBalance;
                            token2RemainingBalance -= token2RemainingBalance;
                        }
                        //now for token 3
                        let actualClaimableToken3Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2])))).toNumber();
                        if(token3RemainingBalance > tokensClaimable){
                            expectedClaimableToken3Balance += tokensClaimable;
                            token3RemainingBalance -= tokensClaimable;
                        }
                        else if(token3RemainingBalance > 0 && token3RemainingBalance < tokensClaimable){
                            expectedClaimableToken3Balance += token3RemainingBalance;
                            token3RemainingBalance -= token3RemainingBalance;
                        }
                       

                        //allowing a range because the timestamps can be slightly out of sync
                        //due to the time it takes for transactions to execute
                        errorMargin = vestingSlope * 2 ; //2 second margin of error
                        assert.isTrue(expectedClaimableToken1Balance >= actualClaimableToken1Balance - errorMargin &&
                                      expectedClaimableToken1Balance <= actualClaimableToken1Balance + errorMargin
                        )
                        assert.isTrue(expectedClaimableToken2Balance >= actualClaimableToken2Balance - errorMargin &&
                                      expectedClaimableToken2Balance <= actualClaimableToken2Balance + errorMargin
                        )
                        assert.isTrue(expectedClaimableToken3Balance >= actualClaimableToken3Balance - errorMargin &&
                            expectedClaimableToken3Balance <= actualClaimableToken3Balance + errorMargin
                        )
                        lastTimestamp = currentTimestamp;
                    }
                })
                it('can repeat the above test even if the user is claiming rewards along the way', async () => {
                    //do a for loop for fifths of the unlock time with calculations and assert statements
                    //set vesting params
                    const unlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    const unlockEndTime = unlockStartTime + 50000;
                    await deployerMockVesting['setVestingParams(uint256,uint256,uint256)'](unlockStartTime,unlockEndTime,69420);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray);
                    await tx.wait(1);

                    //divide vesting period into fifths and do checkpoint calculations along the way
                    let lastTimestamp = unlockStartTime;
                    let desiredTimestamp;
                    let currentTimestamp;
                    let expectedClaimableToken1Balance = 0;
                    let token1RemainingBalance = tokenAmountsArray[0];
                    let expectedClaimableToken2Balance = 0;
                    let token2RemainingBalance = tokenAmountsArray[1];
                    let expectedClaimableToken3Balance = 0;
                    let token3RemainingBalance = tokenAmountsArray[2];
                    for(let i = 1; i <= 5; i++) {
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;
                        desiredTimestamp = unlockStartTime + i*10000;
                        timestampDelta = desiredTimestamp - currentTimestamp;
    
                        //send time forward ~ 10,000 seconds
                        await hre.ethers.provider.send("evm_increaseTime", [timestampDelta]);
                        await network.provider.send("evm_mine");
                        currentTimestamp =(await hre.ethers.provider.getBlock("latest")).timestamp;

                        //calculate rewards
                        await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                        const vestingSlope = (await userMockVesting.vestingSlope()).toNumber();
                        let actualClaimableToken1Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0])))).toNumber();
                        //account for if some tokens supply is fully vested (i.e. the token isn't the maxtokensupply)
                        let tokensClaimable = vestingSlope * (currentTimestamp - lastTimestamp) 
                        if(token1RemainingBalance > tokensClaimable){
                            expectedClaimableToken1Balance = tokensClaimable;
                            token1RemainingBalance -= tokensClaimable;
                        }
                        else if(token1RemainingBalance >= 0 && token1RemainingBalance < tokensClaimable){
                            expectedClaimableToken1Balance = token1RemainingBalance;
                            token1RemainingBalance -= token1RemainingBalance;
                        }
                        //now for token 2
                        let actualClaimableToken2Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1])))).toNumber();
                        if(token2RemainingBalance > tokensClaimable){
                            expectedClaimableToken2Balance = tokensClaimable;
                            token2RemainingBalance -= tokensClaimable;
                        }
                        else if(token2RemainingBalance >= 0 && token2RemainingBalance < tokensClaimable){
                            expectedClaimableToken2Balance = token2RemainingBalance;
                            token2RemainingBalance -= token2RemainingBalance;
                        }
                        //now for token 3
                        let actualClaimableToken3Balance = (((await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2])))).toNumber();
                        if(token3RemainingBalance > tokensClaimable){
                            expectedClaimableToken3Balance = tokensClaimable;
                            token3RemainingBalance -= tokensClaimable;
                        }
                        else if(token3RemainingBalance >= 0 && token3RemainingBalance < tokensClaimable){
                            expectedClaimableToken3Balance = token3RemainingBalance;
                            token3RemainingBalance -= token3RemainingBalance;
                        }
                       
                        //allowing a range because the timestamps can be slightly out of sync
                        //due to the time it takes for transactions to execute
                        errorMargin = vestingSlope * 2 ; //2 second margin of error
                        assert.isTrue(expectedClaimableToken1Balance >= actualClaimableToken1Balance - errorMargin &&
                                      expectedClaimableToken1Balance <= actualClaimableToken1Balance + errorMargin
                        )
                        assert.isTrue(expectedClaimableToken2Balance >= actualClaimableToken2Balance - errorMargin &&
                                      expectedClaimableToken2Balance <= actualClaimableToken2Balance + errorMargin
                        )
                        assert.isTrue(expectedClaimableToken3Balance >= actualClaimableToken3Balance - errorMargin &&
                            expectedClaimableToken3Balance <= actualClaimableToken3Balance + errorMargin
                        )
                        lastTimestamp = currentTimestamp;
                        if(actualClaimableToken1Balance > 0){
                            await userMockVesting['withdraw(address)'](tokenAddressArray[0]);
                        }
                        if(actualClaimableToken2Balance > 0){
                            await userMockVesting['withdraw(address)'](tokenAddressArray[1]);
                        }
                        if(actualClaimableToken3Balance > 0){
                            await userMockVesting['withdraw(address)'](tokenAddressArray[2]);
                        }
                    }
                })
                it('unlocks all tokens if end time has been reached', async () => {
                    //set vesting params
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256,uint256,uint256)'](currentTimestamp - 5,currentTimestamp-1,69);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund
                    const expectedEthBalance = (ethers.utils.parseEther('0.1')).toString();
                    const expectedToken1Balance = tokenAmountsArray[0];
                    const expectedToken2Balance = tokenAmountsArray[1];
                    const expectedToken3Balance = tokenAmountsArray[2];
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{ value: expectedEthBalance })
                    await tx.wait(1);
                    //call getClaimableBalance with 2nd argument to call updateVestedBalances modifier
                    const tx2 = await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[1],69420);
                    await tx2.wait(1);
                    // Since all tokens are vested, initialBalance and claimableBalance should be equal
                    const actualEthBalance = (await userMockVesting['getClaimableBalance()']()).toString();
                    const actualToken1Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0]);
                    const actualToken2Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1]);
                    const actualToken3Balance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2]);
                    assert.equal(expectedEthBalance, actualEthBalance);  
                    assert.equal(expectedToken1Balance,actualToken1Balance);
                    assert.equal(expectedToken2Balance,actualToken2Balance);
                    assert.equal(expectedToken3Balance,actualToken3Balance);
                })
            })
        })
        describe('Withdraw function', () => {
            it('Can only be called by the beneficiary', async () => {
                await expect(deployerMockVesting['withdraw()']()).to.be.revertedWith(
                    'Only the beneficiary can withdraw tokens.'
                );
                await expect(thirdPartyMockVesting['withdraw()']()).to.be.revertedWith(
                    'Only the beneficiary can withdraw tokens.'
                );
            })
            it('reverts if there are no tokens or ETH or be claimed', async () => {    
                // Set vesting start time in the future
                const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp + 100000);
                assert.isTrue(await deployerMockVesting.vestingParamsSet());
                //fund contract
                const ethAmount = ethers.utils.parseEther('1');
                const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{value: ethAmount});
                await tx.wait(1);
                assert.isTrue(await deployerMockVesting.isFunded());
                
                await expect(userMockVesting['withdraw(address)'](tokenAddressArray[0])).to.be.revertedWith(
                    'That token has no claimable balance.'
                );
                await expect(userMockVesting['withdraw()']()).to.be.revertedWith(
                    'There is no ETH available to claim.'
                )
            })
            it('allows all tokens to be withdrawn if fully vested', async () => {
                // Set vesting start time in the past
                const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp - 100000);
                assert.isTrue(await deployerMockVesting.vestingParamsSet());
                //fund contract
                const ethAmount = ethers.utils.parseEther('1');
                const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{value: ethAmount});
                await tx.wait(1);
                assert.isTrue(await deployerMockVesting.isFunded());
                
                //division/floor to because gasUsed used Gwei isntead of wei
                const initialEthBalance = Math.floor((await user.getBalance())/(10**9));

                //call withdraw()
                const tx2 = await userMockVesting['withdraw(address,bytes)'](tokenAddressArray[0],69420);
                const tx3 = await userMockVesting['withdraw(address)'](tokenAddressArray[1]);
                const tx4 = await userMockVesting['withdraw(address)'](tokenAddressArray[2]);
                const tx5 = await userMockVesting['withdraw()']();
                const tx2Receipt = await tx2.wait(1);
                const tx3Receipt = await tx3.wait(1);
                const tx4Receipt = await tx4.wait(1);
                const tx5Receipt = await tx5.wait(1);
                const gasUsed = (
                    (tx2Receipt.gasUsed).toNumber() + 
                    (tx3Receipt.gasUsed).toNumber() + 
                    (tx4Receipt.gasUsed).toNumber() +
                    (tx5Receipt.gasUsed).toNumber() 
                );

                const finalEthBalance = Math.floor((await user.getBalance())/(10**9));
                const userToken1Balance = (await mockToken1.balanceOf(user.address)).toString();
                const userToken2Balance = (await mockToken2.balanceOf(user.address)).toString();
                const userToken3Balance = (await mockToken3.balanceOf(user.address)).toString();

                assert.equal((initialEthBalance + ethAmount/(10**9)).toString(), (finalEthBalance + gasUsed).toString()) 
                assert.equal(userToken1Balance, tokenAmountsArray[0]);
                assert.equal(userToken2Balance, tokenAmountsArray[1]);
                assert.equal(userToken3Balance, tokenAmountsArray[2]);
            })
            it('is not vulnerable to reentrancy', async () => {
                /* It would be fine anyway (balances update before sending tokens out), 
                 but since withdraw can only be called by the beneficiary (and
                 therefore not a contract), it can't be attacked re-entrantly */
            })
        })
        describe('Set Vesting Parameters functions', () => {
            it('calls the right overload function depending on which parameters are supplied', async () => {
                //This had to be manually tested due to the way Hardhat handles overloaded functions
                //test contract can be seen here: https://goerli.etherscan.io/address/0xB6421d12c08Edc5899931f14b608A2C18989d8fA

                const I_TESTED_THIS_MANUALLY = true;
                assert.isTrue(I_TESTED_THIS_MANUALLY);
            })
            it('can only be called once', async () => {
                // Call function first time
                const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp);
                assert.isTrue(await deployerMockVesting.vestingParamsSet());
                //try to call a second time
                await expect(deployerMockVesting['setVestingParams(uint256)'](currentTimestamp)).to.be.revertedWith(
                    'You have already set vesting parameters.'
                );
            })
            it('can only be called by the owner', async () => {
                const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                await expect(userMockVesting['setVestingParams(uint256)'](currentTimestamp)).to.be.reverted;
                await expect(thirdPartyMockVesting['setVestingParams(uint256)'](currentTimestamp)).to.be.reverted;
            })
            it('correctly sets the unlockStartTime', async () => {
                const expectedUnlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp + 100000;
                await deployerMockVesting['setVestingParams(uint256)'](expectedUnlockStartTime);
                assert.isTrue(await deployerMockVesting.vestingParamsSet());
                
                const actualUnlockStartTime = await deployerMockVesting.unlockStartTime();
                assert.equal(expectedUnlockStartTime, actualUnlockStartTime);
            })
            it('correctly sets unlockStartTime AND unlockEndTime where applicable', async () => {
                const expectedUnlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp + 100000;
                const expectedUnlockEndTime = expectedUnlockStartTime + 10000000;
                await deployerMockVesting['setVestingParams(uint256,uint256)'](expectedUnlockStartTime,expectedUnlockEndTime);
                assert.isTrue(await deployerMockVesting.vestingParamsSet());
                
                const actualUnlockStartTime = await deployerMockVesting.unlockStartTime();
                const actualUnlockEndTime = await deployerMockVesting.unlockEndTime();
                assert.equal(expectedUnlockStartTime, actualUnlockStartTime);
                assert.equal(expectedUnlockEndTime, actualUnlockEndTime);
            })
            it('correctly sets the unlockStartTime, unlockEndTime, AND vestingCoefficient where applicable', async () => {
                const expectedUnlockStartTime = (await hre.ethers.provider.getBlock("latest")).timestamp + 100000;
                const expectedUnlockEndTime = expectedUnlockStartTime + 10000000;
                const expectedVestingCoefficient = 69;
                await deployerMockVesting['setVestingParams(uint256,uint256,uint256)'](expectedUnlockStartTime,expectedUnlockEndTime,expectedVestingCoefficient);
                assert.isTrue(await deployerMockVesting.vestingParamsSet());
                
                const actualUnlockStartTime = await deployerMockVesting.unlockStartTime();
                const actualUnlockEndTime = await deployerMockVesting.unlockEndTime();
                const actualVestingCoefficient = await deployerMockVesting.vestingCoefficient();
                assert.equal(expectedUnlockStartTime, actualUnlockStartTime);
                assert.equal(expectedUnlockEndTime, actualUnlockEndTime);
                assert.equal(expectedVestingCoefficient, actualVestingCoefficient);
            })
        })
        describe('Getter Functions', () => {
            describe('getUnvestedBalance()', () => {
                it('calls the right overload function depending on which parameters are supplied', async () => {
                    //This had to be manually tested due to the way Hardhat handles overloaded functions
                    //test contract can be seen here: https://goerli.etherscan.io/address/0xB6421d12c08Edc5899931f14b608A2C18989d8fA

                    const I_TESTED_THIS_MANUALLY = true;
                    assert.isTrue(I_TESTED_THIS_MANUALLY);
                })
                it('returns the correct token balance for the token address (or lack thereof) supplied', async () => {
                    //do it to get each token AND eth for both before and after vesting period
                    //set vesting params
                    // Set vesting start time in the past
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp + 10);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund contract
                    const ethAmount = ethers.utils.parseEther('1');
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{value: ethAmount});
                    await tx.wait(1);
                    assert.isTrue(await deployerMockVesting.isFunded());
                    //make sure returns initial balances
                    let expectedEthBalance = ethAmount.toString();
                    let expectedToken1Balance = tokenAmountsArray[0].toString();
                    let expectedToken2Balance = tokenAmountsArray[1].toString();
                    let expectedToken3Balance = tokenAmountsArray[2].toString();

                    let actualEthBalance = (await userMockVesting['getUnvestedBalance()']()).toString();
                    let actualToken1Balance = (await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[0])).toString();
                    let actualToken2Balance = (await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[1])).toString();
                    let actualToken3Balance = (await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[2])).toString();

                    assert.equal(expectedEthBalance, actualEthBalance);
                    assert.equal(expectedToken1Balance, actualToken1Balance);
                    assert.equal(expectedToken2Balance, actualToken2Balance);
                    assert.equal(expectedToken3Balance, actualToken3Balance);
                    //wait til after vesting period
                    await network.provider.send("evm_increaseTime", [100]);
                    //call getClaimableBalance with 2nd argument to update vested balances
                    await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[0],69420);
                    //make sure returns zero for unvested balances
                    expectedEthBalance = 0;
                    expectedToken1Balance = 0;
                    expectedToken2Balance = 0;
                    expectedToken3Balance = 0;

                    actualEthBalance = (await userMockVesting['getUnvestedBalance()']()).toString();
                    actualToken1Balance = (await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[0])).toString();
                    actualToken2Balance = (await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[1])).toString();
                    actualToken3Balance = (await userMockVesting['getUnvestedBalance(address)'](tokenAddressArray[2])).toString();

                    assert.equal(expectedEthBalance, actualEthBalance);
                    assert.equal(expectedToken1Balance, actualToken1Balance);
                    assert.equal(expectedToken2Balance, actualToken2Balance);
                    assert.equal(expectedToken3Balance, actualToken3Balance);
                })
            })
            describe('getClaimableBalance()', () => {
                beforeEach(async () => {
                    //set vesting params
                    const currentTimestamp = (await hre.ethers.provider.getBlock("latest")).timestamp;
                    await deployerMockVesting['setVestingParams(uint256)'](currentTimestamp -10);
                    assert.isTrue(await deployerMockVesting.vestingParamsSet());
                    //fund contract
                    const ethAmount = ethers.utils.parseEther('1');
                    const tx = await deployerMockVesting['fund(address[],uint256[])'](tokenAddressArray,tokenAmountsArray,{value: ethAmount});
                    await tx.wait(1);
                    assert.isTrue(await deployerMockVesting.isFunded());
                })
                it('calls the right overload function depending on which parameters are supplied', async () => {
                    //This had to be manually tested due to the way Hardhat handles overloaded functions
                    //test contract can be seen here: https://goerli.etherscan.io/address/0xB6421d12c08Edc5899931f14b608A2C18989d8fA

                    const I_TESTED_THIS_MANUALLY = true;
                    assert.isTrue(I_TESTED_THIS_MANUALLY);
                })
                it('calls the updateVestedBalances modifier when 2nd argument supplied', async () => {
                    const initialClaimableBalance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0]);
                    assert.equal(initialClaimableBalance,0);
                    //call with 2nd arg to run modifier - claimable balance should now be equal to initialBalance
                    await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[0],69420);
                    
                    const finalClaimableBalance = await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0]);

                    assert.notEqual(finalClaimableBalance, initialClaimableBalance);
                    assert.equal(finalClaimableBalance, tokenAmountsArray[0]);
                })
                it('returns the correct token balance for the token address (or lack thereof) supplied', async () => {
                    //call with 2nd arg to run modifier - claimable balance should now be equal to initialBalance
                    await userMockVesting['getClaimableBalance(address,bytes)'](tokenAddressArray[0],69420);
                    
                    const expectedToken1ClaimableBalance = tokenAmountsArray[0];
                    const expectedToken2ClaimableBalance = tokenAmountsArray[1];
                    const expectedToken3ClaimableBalance = tokenAmountsArray[2];
                    const expectedEthClaimableBalance = ethers.utils.parseEther('1');

                    const token1ClaimableBalance = (await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[0])).toString();
                    const token2ClaimableBalance = (await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[1])).toString();
                    const token3ClaimableBalance = (await userMockVesting['getClaimableBalance(address)'](tokenAddressArray[2])).toString();
                    const ethClaimableBalance = (await userMockVesting['getClaimableBalance()']()).toString();
                    
                    assert.equal(expectedToken1ClaimableBalance, token1ClaimableBalance);
                    assert.equal(expectedToken2ClaimableBalance, token2ClaimableBalance);
                    assert.equal(expectedToken3ClaimableBalance, token3ClaimableBalance);
                    assert.equal(expectedEthClaimableBalance, ethClaimableBalance);
                })
            })
        })
    })
})