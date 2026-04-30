'use strict';

require('dotenv').config();
const { ethers } = require('ethers');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Error: environment variable ${name} is required but not set.`);
    process.exit(1);
  }
  return value;
}

const RHINO_API_KEY = requireEnv('RHINO_API_KEY');
const BASE_SIGNER_PRIVATE_KEY = requireEnv('BASE_SIGNER_PRIVATE_KEY');
const GNOSIS_RECIPIENT_ADDRESS = requireEnv('GNOSIS_RECIPIENT_ADDRESS');
const BASE_RPC_URL = requireEnv('BASE_RPC_URL');

if (!BASE_SIGNER_PRIVATE_KEY.startsWith('0x')) {
  console.error('Error: BASE_SIGNER_PRIVATE_KEY must start with 0x');
  process.exit(1);
}

if (!ethers.isAddress(GNOSIS_RECIPIENT_ADDRESS)) {
  console.error(`Error: GNOSIS_RECIPIENT_ADDRESS is not a valid Ethereum address: ${GNOSIS_RECIPIENT_ADDRESS}`);
  process.exit(1);
}

// Constants
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const RHINO_BRIDGE_CONTRACT = '0x2f59e9086ec8130e21bd052065a9e6b2497bb102';
const BASE_CHAIN_ID = 8453n;
const USDC_DECIMALS = 6;
const BRIDGE_AMOUNT = '1';
const CHAIN_IN = 'BASE';
const CHAIN_OUT = 'GNOSIS';
const TOKEN_IN = 'USDC';
const TOKEN_OUT = 'USDC';
const MODE = 'pay';

const config = {
  RHINO_API_KEY,
  BASE_SIGNER_PRIVATE_KEY,
  GNOSIS_RECIPIENT_ADDRESS,
  BASE_RPC_URL,
};

module.exports = {
  config,
  USDC_BASE,
  RHINO_BRIDGE_CONTRACT,
  BASE_CHAIN_ID,
  USDC_DECIMALS,
  BRIDGE_AMOUNT,
  CHAIN_IN,
  CHAIN_OUT,
  TOKEN_IN,
  TOKEN_OUT,
  MODE,
};
