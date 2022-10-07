require("@nomiclabs/hardhat-ethers");
const hre = require('hardhat');
const { verify } = require("../utils/verify");

const main = async () => {
  //for hardhat local fork testing:
  accounts = await ethers.getSigners();
  deployer = accounts[0];
  user = deployer; //this is the beneficiary
  const beneficiary = user.address;
  
  const vestingContractFactory = await hre.ethers.getContractFactory('ManualTesting');
  const vestingContract = await vestingContractFactory.deploy(beneficiary); //pass in constructor args as deploy params
  await vestingContract.deployed();
  console.log("Token contract deployed to:", vestingContract.address);

  // explorer verification
    vestingContract.deployTransaction.wait(50); //Allow etherscan to register the deployment
    args = [beneficiary]; //constructor args
    console.log("Verifying...");
    await verify(vestingContract.address, args);

}

const runMain = async () => {
    try {
      await main();
      process.exit(0);
    } catch (error) {
      console.log(error);
      process.exit(1);
    }
  };
  
  runMain();
