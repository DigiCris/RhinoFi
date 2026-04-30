'use strict';

const { ethers } = require('ethers');
const { config, USDC_BASE, RHINO_BRIDGE_CONTRACT, BASE_CHAIN_ID, USDC_DECIMALS } = require('./config');

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
];

const RHINO_BRIDGE_ABI = [
  'function depositWithId(address token, uint256 amount, uint256 commitmentId)',
];

function getProvider() {
  return new ethers.JsonRpcProvider(config.BASE_RPC_URL);
}

function getWallet() {
  return new ethers.Wallet(config.BASE_SIGNER_PRIVATE_KEY, getProvider());
}

function getUsdcContract(walletOrProvider) {
  return new ethers.Contract(USDC_BASE, ERC20_ABI, walletOrProvider);
}

function getBridgeContract(wallet) {
  return new ethers.Contract(RHINO_BRIDGE_CONTRACT, RHINO_BRIDGE_ABI, wallet);
}

function parseUsdc(amount) {
  return ethers.parseUnits(amount, USDC_DECIMALS);
}

async function checkBaseChain(provider) {
  const network = await provider.getNetwork();
  if (network.chainId !== BASE_CHAIN_ID) {
    throw new Error(`Wrong chain! Expected Base chainId ${BASE_CHAIN_ID}, got ${network.chainId}. Check BASE_RPC_URL.`);
  }
}

async function readBalances() {
  const wallet = getWallet();
  const provider = wallet.provider;
  const sender = wallet.address;
  const usdc = getUsdcContract(provider);
  const [ethBalance, usdcBalance, allowance] = await Promise.all([
    provider.getBalance(sender),
    usdc.balanceOf(sender),
    usdc.allowance(sender, RHINO_BRIDGE_CONTRACT),
  ]);
  return { ethBalance, usdcBalance, allowance };
}

async function approveIfNeeded(requiredAmount) {
  const wallet = getWallet();
  const usdc = getUsdcContract(wallet);
  const sender = wallet.address;
  const currentAllowance = await usdc.allowance(sender, RHINO_BRIDGE_CONTRACT);

  if (currentAllowance >= requiredAmount) {
    console.log(`Allowance already sufficient (${currentAllowance} raw units). Skipping approval.`);
    return null;
  }

  console.log('\nSending APPROVAL transaction on Base mainnet...');
  console.log(` Approving ${requiredAmount} raw USDC units to Rhino bridge ${RHINO_BRIDGE_CONTRACT}`);
  const tx = await usdc.approve(RHINO_BRIDGE_CONTRACT, requiredAmount);
  console.log(` Approval tx hash: ${tx.hash}`);
  console.log(' Waiting for confirmation...');
  const receipt = await tx.wait();
  console.log(` Approval confirmed in block ${receipt.blockNumber}`);
  return receipt;
}

function commitmentIdFromQuoteId(quoteId) {
  const id = String(quoteId).trim();
  if (/^0x[0-9a-fA-F]+$/.test(id)) return BigInt(id);
  if (/^[0-9a-fA-F]+$/.test(id)) return BigInt(`0x${id}`);
  throw new Error(`quoteId/commitmentId is not hex-compatible: ${id}`);
}

async function depositWithId(commitmentId, amount) {
  const wallet = getWallet();
  const bridge = getBridgeContract(wallet);

  console.log('\nSending DEPOSIT transaction on Base mainnet...');
  console.log(` Token: ${USDC_BASE}`);
  console.log(` Amount: ${amount} raw units`);
  console.log(` CommitmentId: ${commitmentId}`);
  console.log(` Bridge: ${RHINO_BRIDGE_CONTRACT}`);

  const tx = await bridge.depositWithId(USDC_BASE, amount, commitmentId);
  console.log(` Deposit tx hash: ${tx.hash}`);
  console.log(' Waiting for confirmation...');
  const receipt = await tx.wait();
  console.log(` Deposit confirmed in block ${receipt.blockNumber}`);
  console.log(` Tx hash: ${receipt.hash}`);
  return receipt;
}

module.exports = {
  getProvider,
  getWallet,
  getUsdcContract,
  getBridgeContract,
  parseUsdc,
  checkBaseChain,
  readBalances,
  approveIfNeeded,
  depositWithId,
  commitmentIdFromQuoteId,
};
