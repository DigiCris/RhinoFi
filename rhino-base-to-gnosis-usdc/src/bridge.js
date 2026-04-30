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
const { checkBaseChain, readBalances, getWallet, parseUsdc, approveIfNeeded, depositWithId } = require('./evm');
const { authenticate, getQuote, commitQuote, getStatus } = require('./rhino');
const { confirmStep } = require('./prompt');

// Maximum allowed payAmount: 1.01 USDC in raw units
const MAX_ALLOWED_AMOUNT = 1010000n; // 1.01 USDC
const ONE_USDC = 1000000n;           // 1 USDC

async function main() {
  console.log('=== rhino-base-to-gnosis-usdc: BRIDGE ===\n');

  // ── Step 1-3: Load config and check chain ───────────────────────────────
  const wallet = getWallet();
  const sender = wallet.address;
  const recipient = config.GNOSIS_RECIPIENT_ADDRESS;

  await checkBaseChain(wallet.provider);

  // ── Step 4: Print full plan ──────────────────────────────────────────────
  console.log('Bridge plan:');
  console.log(`  Sender (Base):       ${sender}`);
  console.log(`  Recipient (Gnosis):  ${recipient}`);
  console.log(`  Amount:              1 USDC`);
  console.log(`  chainIn:             ${CHAIN_IN}`);
  console.log(`  chainOut:            ${CHAIN_OUT}`);
  console.log(`  Token:               ${TOKEN_IN} → ${TOKEN_OUT}`);
  console.log(`  Bridge contract:     ${RHINO_BRIDGE_CONTRACT}`);
  console.log(`  USDC contract:       ${USDC_BASE}`);

  // ── Step 5: Read balances and allowance ──────────────────────────────────
  console.log('\nReading balances...');
  const { ethBalance, usdcBalance, allowance } = await readBalances();

  console.log(`  ETH balance:         ${ethers.formatEther(ethBalance)} ETH`);
  console.log(`  USDC balance:        ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)} USDC`);
  console.log(`  Current allowance:   ${ethers.formatUnits(allowance, USDC_DECIMALS)} USDC`);

  // ── Step 6: Check USDC balance ───────────────────────────────────────────
  const usdcRequired = parseUsdc('1');
  if (usdcBalance < usdcRequired) {
    console.error(
      `\nError: Insufficient USDC balance. ` +
      `Have ${ethers.formatUnits(usdcBalance, USDC_DECIMALS)} USDC, need at least 1 USDC.`
    );
    process.exit(1);
  }

  // ── Step 7: Confirm before API calls ────────────────────────────────────
  await confirmStep('Ready to authenticate with rhino.fi and fetch a bridge quote.');

  // ── Step 8: Authenticate ────────────────────────────────────────────────
  console.log('\nAuthenticating with rhino.fi...');
  const jwt = await authenticate();
  console.log('  Authentication successful.');

  // ── Step 9: Get quote ────────────────────────────────────────────────────
  console.log('\nFetching bridge quote...');
  const quote = await getQuote(jwt, { sender, recipient });

  // ── Step 10: Print normalized quote ─────────────────────────────────────
  console.log('\nQuote received:');
  console.log(`  quoteId:       ${quote.quoteId}`);
  console.log(`  payAmount:     ${quote.payAmount}`);
  console.log(`  receiveAmount: ${quote.receiveAmount}`);
  console.log(`  fees:          ${JSON.stringify(quote.fees)}`);
  if (quote.expiresAt) {
    console.log(`  expiresAt:     ${quote.expiresAt}`);
  }

  // ── Step 11: Confirm before commit ──────────────────────────────────────
  await confirmStep('Ready to commit the quote. This will lock in the bridge terms.');

  // ── Step 12: Commit quote ────────────────────────────────────────────────
  console.log('\nCommitting quote...');
  const commitResponse = await commitQuote(jwt, quote.quoteId);
  console.log('  Quote committed.');

  // ── Step 13: Derive commitmentId ────────────────────────────────────────
  let commitmentId;
  try {
    commitmentId = BigInt(quote.quoteId);
  } catch {
    console.error(
      `\nError: quoteId "${quote.quoteId}" cannot be converted to BigInt. ` +
      'Cannot call depositWithId. Aborting.'
    );
    process.exit(1);
  }

  // ── Step 14: Determine requiredAmount ────────────────────────────────────
  let requiredAmount;

  if (quote.payAmount !== undefined && quote.payAmount !== null) {
    try {
      // payAmount may be a decimal string like "1.0" or a raw integer string like "1000000"
      let parsed;
      const payStr = String(quote.payAmount);
      if (payStr.includes('.')) {
        // Treat as human-readable USDC amount
        parsed = ethers.parseUnits(payStr, USDC_DECIMALS);
      } else {
        // Treat as raw units
        parsed = BigInt(payStr);
      }

      if (parsed > MAX_ALLOWED_AMOUNT) {
        console.error(
          `\nError: payAmount ${parsed} exceeds maximum allowed amount of ${MAX_ALLOWED_AMOUNT} (1.01 USDC). ` +
          'Aborting to protect funds.'
        );
        process.exit(1);
      }

      requiredAmount = parsed;
    } catch {
      console.warn(`  Warning: Could not parse payAmount "${quote.payAmount}". Falling back to exactly 1 USDC.`);
      requiredAmount = ONE_USDC;
    }
  } else {
    console.log('  payAmount not available in quote. Using exactly 1 USDC.');
    requiredAmount = ONE_USDC;
  }

  console.log(`  Required approval amount: ${requiredAmount} raw units (${ethers.formatUnits(requiredAmount, USDC_DECIMALS)} USDC)`);

  // ── Step 15: Confirm before approval (if needed) ─────────────────────────
  const currentAllowance = allowance;
  if (currentAllowance < requiredAmount) {
    await confirmStep(
      `⚠️  REAL MAINNET TRANSACTION: About to approve ${ethers.formatUnits(requiredAmount, USDC_DECIMALS)} USDC ` +
      `to the Rhino bridge contract (${RHINO_BRIDGE_CONTRACT}) on Base mainnet.`
    );
  }

  // ── Step 16: Approve ─────────────────────────────────────────────────────
  await approveIfNeeded(requiredAmount);

  // ── Step 17: Confirm before deposit ──────────────────────────────────────
  await confirmStep(
    `⚠️  REAL MAINNET TRANSACTION: About to deposit ${ethers.formatUnits(requiredAmount, USDC_DECIMALS)} USDC ` +
    `to the Rhino bridge contract on Base mainnet.\n` +
    `  This will initiate the bridge transfer to Gnosis for recipient ${recipient}.`
  );

  // ── Step 18: Deposit ──────────────────────────────────────────────────────
  const depositReceipt = await depositWithId(commitmentId, requiredAmount);
  console.log(`\nDeposit tx hash: ${depositReceipt.hash}`);

  // ── Steps 20-21: Poll status ──────────────────────────────────────────────
  console.log('\nPolling bridge status (every 15s, up to 20 attempts)...');
  const MAX_ATTEMPTS = 20;
  const POLL_INTERVAL_MS = 15000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const status = await getStatus(jwt, quote.quoteId);

    if (status === null) {
      if (attempt === 1) {
        console.log(
          '\nBridge status endpoint is unavailable. ' +
          'Your deposit transaction succeeded. ' +
          'Please monitor your progress at https://app.rhino.fi or check your destination wallet on Gnosis.'
        );
      }
      break;
    }

    const state = status.status || status.state || JSON.stringify(status);
    console.log(`  [${attempt}/${MAX_ATTEMPTS}] Status: ${state}`);

    const done = (typeof state === 'string') && (
      state.toLowerCase().includes('complete') ||
      state.toLowerCase().includes('success') ||
      state.toLowerCase().includes('done') ||
      state.toLowerCase().includes('filled')
    );

    if (done) {
      console.log('\n✅ Bridge transfer completed successfully!');
      break;
    }

    if (attempt < MAX_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    } else {
      console.log(
        '\nMax polling attempts reached. ' +
        'The bridge transfer may still be in progress. ' +
        'Please monitor at https://app.rhino.fi or check your destination wallet on Gnosis.'
      );
    }
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error('\nFatal error:', err.message || err);
  process.exit(1);
});
