'use strict';

const {
  config,
  CHAIN_IN,
  CHAIN_OUT,
  BRIDGE_AMOUNT,
  TOKEN,
  MODE,
} = require('./config');

const RHINO_API_BASE = 'https://api.rhino.fi';

function pick(obj, paths) {
  for (const path of paths) {
    let cur = obj;
    let ok = true;
    for (const key of path.split('.')) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, key)) cur = cur[key];
      else { ok = false; break; }
    }
    if (ok && cur !== undefined && cur !== null) return cur;
  }
  return undefined;
}

function authHeaders(jwt) {
  // Rhino examples use raw JWT in Authorization; docs also accept Bearer on some pages.
  // Raw JWT is kept here because it matches the official bridge-examples repo.
  return { Authorization: jwt };
}

async function readJsonOrText(res) {
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

async function authenticate() {
  const res = await fetch(`${RHINO_API_BASE}/authentication/auth/apiKey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: config.RHINO_API_KEY }),
  });

  const data = await readJsonOrText(res);
  if (!res.ok) throw new Error(`Authentication failed (${res.status}): ${JSON.stringify(data)}`);

  const jwt = pick(data, ['jwt', 'token', 'accessToken', 'data.jwt', 'data.token', 'data.accessToken']);
  if (!jwt) throw new Error(`Authentication succeeded but no JWT found in response: ${JSON.stringify(data)}`);
  return jwt;
}

function normalizeQuote(raw, sourceEndpoint) {
  const quoteId = pick(raw, ['quoteId', 'id', '_id', 'data.quoteId', 'data.id', 'data._id']);
  if (!quoteId) throw new Error(`Quote response missing quoteId: ${JSON.stringify(raw)}`);

  return {
    raw,
    sourceEndpoint,
    quoteId: String(quoteId),
    payAmount: pick(raw, ['payAmount', 'amountIn', 'data.payAmount', 'data.amountIn']),
    receiveAmount: pick(raw, ['receiveAmount', 'amountOut', 'data.receiveAmount', 'data.amountOut']),
    fees: pick(raw, ['fees', 'data.fees']),
    expiresAt: pick(raw, ['expiresAt', 'data.expiresAt']),
  };
}

async function postQuote(jwt, endpoint, body) {
  const res = await fetch(`${RHINO_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      ...authHeaders(jwt),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await readJsonOrText(res);
  if (!res.ok) {
    const err = new Error(`quote failed on ${endpoint} (${res.status}): ${JSON.stringify(data)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function getQuote(jwt, { sender, recipient }) {
  // For a plain USDC -> USDC bridge, use the standard user quote endpoint.
  // The bridge-swap endpoint returned a quoteId that the legacy commit endpoint did not find.
  const standardBody = {
    chainIn: CHAIN_IN,
    chainOut: CHAIN_OUT,
    amount: BRIDGE_AMOUNT,
    mode: MODE,
    token: TOKEN,
    depositor: sender,
    recipient,
    amountNative: '0',
    refundAddress: sender,
  };

  try {
    const raw = await postQuote(jwt, '/bridge/quote/user', standardBody);
    return normalizeQuote(raw, '/bridge/quote/user');
  } catch (standardError) {
    console.warn(`Warning: /bridge/quote/user failed. Trying /bridge/quote/bridge-swap/user. Reason: ${standardError.message}`);

    const bridgeSwapBody = {
      chainIn: CHAIN_IN,
      chainOut: CHAIN_OUT,
      amount: BRIDGE_AMOUNT,
      mode: MODE,
      tokenIn: TOKEN,
      tokenOut: TOKEN,
      depositor: sender,
      recipient,
      amountNative: '0',
      refundAddress: sender,
    };

    const raw = await postQuote(jwt, '/bridge/quote/bridge-swap/user', bridgeSwapBody);
    return normalizeQuote(raw, '/bridge/quote/bridge-swap/user');
  }
}

async function commitQuote(jwt, quoteId) {
  const res = await fetch(`${RHINO_API_BASE}/bridge/quote/commit/${quoteId}`, {
    method: 'POST',
    headers: {
      ...authHeaders(jwt),
      'Content-Type': 'application/json',
    },
  });

  const data = await readJsonOrText(res);
  if (!res.ok) {
    const err = new Error(`commitQuote failed (${res.status}): ${JSON.stringify(data)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }

  const committedQuoteId = pick(data, ['quoteId', 'id', '_id', 'data.quoteId', 'data.id', 'data._id']) || quoteId;
  return { raw: data, quoteId: String(committedQuoteId) };
}

async function getStatus(jwt, bridgeId) {
  try {
    const res = await fetch(`${RHINO_API_BASE}/bridge/history/bridge/${bridgeId}`, {
      method: 'GET',
      headers: {
        ...authHeaders(jwt),
        'Content-Type': 'application/json',
      },
    });
    if (res.status === 404 || res.status === 501 || res.status === 405) return null;
    if (!res.ok) return null;
    return await readJsonOrText(res);
  } catch {
    return null;
  }
}

module.exports = { authenticate, getQuote, commitQuote, getStatus };
