"# Mock-Vesting" 

Mock token vesting contract

Allows for vesting a basket of tokens i.e. if recipient was to be paid in
wBTC, ETH/WETH, GMX, etc

Many of the overload function options are probably unnecessary but I wanted to include them for practice. 

For example, in a real scenerio I'd probably split fund into fundTokens and 
fundTokensAndEth, and then have fundTokens internally call fundTokensAndEth with an ethAmount of 0. 

Cutting down on some of the options and making the contract less general would
make it much more gas/storage efficient.