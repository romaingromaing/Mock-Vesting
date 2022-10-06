"# Mock-Vesting" 

Mock token vesting contract

Allows for vesting a basket of tokens i.e. if recipient was to be paid in
wBTC, ETH/WETH, GMX, etc

Steps for use:
1. Deploy contract and specify beneficiary (party who will be claiming vested tokens)
2. Set vesting style with setVestingParams()
3. Deposit token(s) and/or ETH with fund()
4. Beneficiary can claim tokens when some or all are vested using withdraw() 


Many of the overload function options are probably unnecessary but I wanted to include them for practice.  

Cutting down on some of the options and making the contract less general would
make it more gas/storage efficient.

