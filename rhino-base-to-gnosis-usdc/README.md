# rhino-base-to-gnosis-usdc

A Node.js CLI tool to bridge exactly **1 USDC** from **Base** to **Gnosis** using [rhino.fi](https://rhino.fi).

## Requirements

- Node.js >= 20
- A funded Base wallet (ETH for gas, at least 1 USDC)
- A rhino.fi API key

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and fill in all required values:

| Variable | Description |
|---|---|
| `RHINO_API_KEY` | Your rhino.fi API key |
| `BASE_SIGNER_PRIVATE_KEY` | Private key of the Base wallet (must start with `0x`) |
| `GNOSIS_RECIPIENT_ADDRESS` | Recipient address on Gnosis chain |
| `BASE_RPC_URL` | Base RPC URL (default: `https://mainnet.base.org`) |

## Usage

### Check balances and configuration (no transactions)

```bash
npm run check
```

This prints your sender address, recipient, ETH balance, USDC balance, and current allowance — without touching the network beyond read calls.

### Run the bridge

```bash
npm run bridge
```

The script will:

1. Verify your chain, balances, and configuration.
2. Pause before every irreversible action and ask for confirmation.
3. Authenticate with the rhino.fi API and fetch a bridge quote.
4. Commit the quote.
5. Approve exactly 1 USDC (or the quoted `payAmount`) to the Rhino bridge contract on Base.
6. Call `depositWithId` on the Rhino bridge contract.
7. Poll the bridge status until the transfer completes or times out.

## Safety

- The script **never** approves more than 1.01 USDC.
- The script **never** proceeds if the chain ID is not Base (8453).
- The script **always** pauses before approvals and deposits.
- Private keys and API keys are **never** printed.

## Constants

| Name | Value |
|---|---|
| USDC on Base | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Rhino bridge contract | `0x2f59e9086ec8130e21bd052065a9e6b2497bb102` |
| Base chain ID | `8453` |
| Amount | `1 USDC` |
