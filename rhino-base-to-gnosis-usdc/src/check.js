'use strict';

const { ethers } = require('ethers');
const { config, USDC_BASE, RHINO_BRIDGE_CONTRACT, USDC_DECIMALS } = require('./config');
const { checkBaseChain, readBalances, getWallet, parseUsdc } = require('./evm');

async function main() {
  console.log('=== rhino-base-to-gnosis-usdc: CHECK ===\n');

  const wallet = getWallet();
  const sender = wallet.address;
  const recipient = config.GNOSIS_RECIPIENT_ADDRESS;

  // Verify chain
  await checkBaseChain(wallet.provider);

  // Read balances
  const { ethBalance, usdcBalance, allowance } = await readBalances();

  const usdcAmount = parseUsdc('1');

  console.log('Configuration:');
  console.log(`  Sender (Base):           ${sender}`);
  console.log(`  Recipient (Gnosis):      ${recipient}`);
  console.log(`  Base ETH balance:        ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`  Base USDC balance:       ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)} USDC (raw: ${usdcBalance})`);
  console.log(`  USDC allowance to Rhino: ${ethers.formatUnits(allowance, USDC_DECIMALS)} USDC (raw: ${allowance})`);
  console.log(`  Amount to bridge:        1 USDC (raw: ${usdcAmount})`);
  console.log(`  USDC contract (Base):    ${USDC_BASE}`);
  console.log(`  Bridge contract (Base):  ${RHINO_BRIDGE_CONTRACT}`);

  console.log('\nCheck complete. No transactions were sent.');
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
