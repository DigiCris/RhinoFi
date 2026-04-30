'use strict';

const { ethers } = require('ethers');
const {
  config,
  USDC_BASE,
  RHINO_BRIDGE_CONTRACT,
  USDC_DECIMALS,
  CHAIN_IN,
  CHAIN_OUT,
  TOKEN_IN,
  TOKEN_OUT,
} = require('./config');
const {
  checkBaseChain,
  readBalances,
  getWallet,
  parseUsdc,
  approveIfNeeded,
  depositWithId,
  commitmentIdFromQuoteId,
} = require('./evm');
const { authenticate, getQuote, commitQuote, getStatus } = require('./rhino');
const { confirmStep } = require('./prompt');

const MAX_ALLOWED_AMOUNT = 1010000n; // 1.01 USDC
const ONE_USDC = 1000000n;

function parsePayAmountToRaw(payAmount) {
  if (payAmount === undefined || payAmount === null) return ONE_USDC;
  const payStr = String(payAmount).trim();

  if (/^\d+\.\d+$/.test(payStr)) return ethers.parseUnits(payStr, USDC_DECIMALS);

  if (/^\d+$/.test(payStr)) {
    // Rhino examples pass quote.payAmount directly as human units into contract helper,
    // so "1" means 1 USDC, not 1 raw unit. Large integer strings are treated as raw.
    const asBigInt = BigInt(payStr);
    if (asBigInt > 100000n) return asBigInt;
    return ethers.parseUnits(payStr, USDC_DECIMALS);
  }

  throw new Error(`Could not parse payAmount: ${payAmount}`);
}

async function main() {
  console.log('=== rhino-base-to-gnosis-usdc: BRIDGE ===\n');

  const wallet = getWallet();
  const sender = wallet.address;
  const recipient = config.GNOSIS_RECIPIENT_ADDRESS;

  await checkBaseChain(wallet.provider);

  console.log('Bridge plan:');
  console.log(`  Sender (Base):       ${sender}`);
  console.log(`  Recipient (Gnosis):  ${recipient}`);
  console.log('  Amount:              1 USDC');
  console.log(`  chainIn:             ${CHAIN_IN}`);
  console.log(`  chainOut:            ${CHAIN_OUT}`);
  console.log(`  Token:               ${TOKEN_IN} → ${TOKEN_OUT}`);
  console.log(`  Bridge contract:     ${RHINO_BRIDGE_CONTRACT}`);
  console.log(`  USDC contract:       ${USDC_BASE}`);

  console.log('\nReading balances...');
  const { ethBalance, usdcBalance, allowance } = await readBalances();
  console.log(`  ETH balance:         ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`  USDC balance:        ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)} USDC`);
  console.log(`  Current allowance:   ${ethers.formatUnits(allowance, USDC_DECIMALS)} USDC`);

  const usdcRequired = parseUsdc('1');
  if (usdcBalance < usdcRequired) {
    console.error(`\nError: Insufficient USDC. Have ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)} USDC, need at least 1 USDC.`);
    process.exit(1);
  }

  await confirmStep('Ready to authenticate with rhino.fi and fetch a bridge quote. No blockchain transaction will be sent yet.');

  console.log('\nAuthenticating with rhino.fi...');
  const jwt = await authenticate();
  console.log('  Authentication successful.');

  console.log('\nFetching bridge quote...');
  const quote = await getQuote(jwt, { sender, recipient });

  console.log('\nQuote received:');
  console.log(`  sourceEndpoint: ${quote.sourceEndpoint}`);
  console.log(`  quoteId:        ${quote.quoteId}`);
  console.log(`  payAmount:      ${quote.payAmount}`);
  console.log(`  receiveAmount:  ${quote.receiveAmount}`);
  console.log(`  fees:           ${JSON.stringify(quote.fees)}`);
  if (quote.expiresAt) console.log(`  expiresAt:      ${quote.expiresAt}`);
  console.log('\nRaw quote JSON, sanitized:');
  console.log(JSON.stringify(quote.raw, null, 2));

  await confirmStep('Ready to commit the quote. This still does not send a blockchain transaction, but it locks in the Rhino quote terms.');

  console.log('\nCommitting quote...');
  let commitResponse;
  try {
    commitResponse = await commitQuote(jwt, quote.quoteId);
  } catch (err) {
    console.error('\nCommit failed. No approve/deposit transaction was sent.');
    console.error(err.message || err);
    process.exit(1);
  }

  console.log('  Quote committed.');
  console.log(`  committed quoteId: ${commitResponse.quoteId}`);
  console.log('  raw commit JSON:');
  console.log(JSON.stringify(commitResponse.raw, null, 2));

  let commitmentId;
  try {
    commitmentId = commitmentIdFromQuoteId(commitResponse.quoteId);
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    console.error('Cannot call depositWithId. Aborting before any blockchain transaction.');
    process.exit(1);
  }

  let requiredAmount;
  try {
    requiredAmount = parsePayAmountToRaw(quote.payAmount);
  } catch (err) {
    console.warn(`Warning: ${err.message}. Falling back to exactly 1 USDC.`);
    requiredAmount = ONE_USDC;
  }

  if (requiredAmount > MAX_ALLOWED_AMOUNT) {
    console.error(`\nError: requiredAmount ${requiredAmount} raw exceeds max ${MAX_ALLOWED_AMOUNT} raw (1.01 USDC). Aborting.`);
    process.exit(1);
  }

  console.log(`\nCommitmentId for depositWithId: ${commitmentId}`);
  console.log(`Required approval/deposit amount: ${requiredAmount} raw (${ethers.formatUnits(requiredAmount, USDC_DECIMALS)} USDC)`);

  if (allowance < requiredAmount) {
    await confirmStep(
      `⚠️ REAL MAINNET TRANSACTION: approve ${ethers.formatUnits(requiredAmount, USDC_DECIMALS)} USDC ` +
      `to Rhino bridge (${RHINO_BRIDGE_CONTRACT}) on Base.`
    );
  }

  await approveIfNeeded(requiredAmount);

  await confirmStep(
    `⚠️ REAL MAINNET TRANSACTION: deposit ${ethers.formatUnits(requiredAmount, USDC_DECIMALS)} USDC ` +
    `to Rhino bridge on Base, recipient on Gnosis: ${recipient}.`
  );

  const depositReceipt = await depositWithId(commitmentId, requiredAmount);
  console.log(`\nDeposit tx hash: ${depositReceipt.hash}`);

  console.log('\nPolling bridge status (every 15s, up to 20 attempts)...');
  const MAX_ATTEMPTS = 20;
  const POLL_INTERVAL_MS = 15000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const status = await getStatus(jwt, commitResponse.quoteId);
    if (status === null) {
      if (attempt === 1) {
        console.log('\nBridge status endpoint unavailable for this id. Deposit transaction succeeded. Monitor https://app.rhino.fi or the recipient wallet on Gnosis.');
      }
      break;
    }

    const state = status.status || status.state || status._tag || JSON.stringify(status);
    console.log(`  [${attempt}/${MAX_ATTEMPTS}] Status: ${state}`);

    const normalized = String(state).toLowerCase();
    if (normalized.includes('complete') || normalized.includes('success') || normalized.includes('done') || normalized.includes('filled')) {
      console.log('\n✅ Bridge transfer completed successfully!');
      break;
    }

    if (attempt < MAX_ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    else console.log('\nMax polling attempts reached. The bridge transfer may still be in progress.');
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message || err);
  process.exit(1);
});
