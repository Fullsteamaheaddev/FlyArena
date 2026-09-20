const fs = require('fs');
const path = require('path');
require("@nomicfoundation/hardhat-ethers");

for (const name of ['.env', '.env.local']) {
  const p = path.join(__dirname, name);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const k = m[1].trim();
    if (process.env[k]) continue;
    process.env[k] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const accounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: { sources: "./contracts", tests: "./contracts/test", cache: "./contracts/cache", artifacts: "./contracts/artifacts" },
  networks: {
    hardhat: { chainId: 31337 },
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
    robinhoodTestnet: {
      url: process.env.ROBINHOOD_TESTNET_RPC || "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts,
    },
  },
};
