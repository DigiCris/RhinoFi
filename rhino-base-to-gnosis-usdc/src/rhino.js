'use strict';

const { config, CHAIN_IN, CHAIN_OUT, BRIDGE_AMOUNT, TOKEN_IN, TOKEN_OUT, MODE } = require('./config');

const RHINO_API_BASE = 'https://api.rhino.fi';

/**
 * Authenticate with rhino.fi using the API key.
 * Returns a JWT string.
 */
async function authenticate() {
  const res = await fetch(`${RHINO_API_BASE}/authentication/auth/apiKey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: config.RHINO_API_KEY }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Authentication failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  const jwt =
    data.token ||
    data.jwt ||
    data.accessToken ||
    (data.data && (data.data.token || data.data.jwt || data.data.accessToken));

  if (!jwt) {
    throw new Error(`Authentication succeeded but no JWT found in response: ${JSON.stringify(data)}`);
  }

  return jwt;
}

/**
 * Request a bridge quote from rhino.fi.
 * Returns the normalized quote object.
 */
async function getQuote(jwt, { sender, recipient }) {
  const body = {
    chainIn: CHAIN_IN,
    chainOut: CHAIN_OUT,
    amount: BRIDGE_AMOUNT,
    mode: MODE,
    tokenIn: TOKEN_IN,
    tokenOut: TOKEN_OUT,
    depositor: sender,
    recipient: recipient,
    amountNative: '0',
    refundAddress: sender,
  };

  const res = await fetch(`${RHINO_API_BASE}/bridge/quote/bridge-swap/user`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`getQuote failed (${res.status}): ${text}`);
  }

  const quote = await res.json();

  // Normalize quote fields
  const quoteId =
    quote.quoteId ||
    quote.id ||
    (quote.data && (quote.data.quoteId || quote.data.id));

  if (!quoteId) {
    throw new Error(`Quote response missing quoteId: ${JSON.stringify(quote)}`);
  }

  const payAmount =
    quote.payAmount ||
    quote.amountIn ||
    (quote.data && (quote.data.payAmount || quote.data.amountIn));

  const receiveAmount =
    quote.receiveAmount ||
    quote.amountOut ||
    (quote.data && (quote.data.receiveAmount || quote.data.amountOut));

  const fees =
    quote.fees ||
    (quote.data && quote.data.fees);

  const expiresAt =
    quote.expiresAt ||
    (quote.data && quote.data.expiresAt);

  return {
    raw: quote,
    quoteId,
    payAmount,
    receiveAmount,
    fees,
    expiresAt,
  };
}

/**
 * Commit a bridge quote.
 * Returns the full JSON response.
 */
async function commitQuote(jwt, quoteId) {
  const res = await fetch(`${RHINO_API_BASE}/bridge/quote/commit/${quoteId}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`commitQuote failed (${res.status}): ${text}`);
  }

  return res.json();
}

/**
 * Get bridge transfer status.
 * Returns null if the endpoint is unavailable (404) or unsupported.
 */
async function getStatus(jwt, quoteId) {
  try {
    const res = await fetch(`${RHINO_API_BASE}/bridge/quote/status/${quoteId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${jwt}` },
    });

    if (res.status === 404 || res.status === 501 || res.status === 405) {
      return null;
    }

    if (!res.ok) {
      return null;
    }

    return res.json();
  } catch {
    return null;
  }
}

module.exports = { authenticate, getQuote, commitQuote, getStatus };
