# ClearFund

ClearFund is a small Ethereum Sepolia app for milestone-based NGO fundraising.
Donations stay in a campaign contract, and funds are released milestone by
milestone after evidence is submitted.

## Folder Structure

```txt
ClearFund/
  frontend/    React + Vite app and Vercel API route
  contracts/   Solidity contracts
```

The repo intentionally does not include build output, test files, private keys,
or generated folders.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Main frontend files:

```txt
frontend/
  api/analyze.js
  assets/
  components/
  campaigns.ts
  chain.ts
  wallet.ts
  types.ts
  main.tsx
```

`chain.ts` has the deployed factory address, Sepolia RPC fallback, and contract
ABIs. Active Campaigns are read from the factory contract through the Sepolia
RPC. The default RPC is:

```txt
https://ethereum-sepolia-rpc.publicnode.com
```

## Wallets

Wallet connection uses RainbowKit in dark mode. For WalletConnect support on
Safari and mobile, set this in Vercel or `.env`:

```txt
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
```

Do not commit `.env`.

## Oracle API

The Vercel API route lives at `frontend/api/analyze.js`.

Required server environment variables:

```txt
OPENAI_API_KEY=your_openai_key
PRIVATE_KEY=oracle_wallet_private_key
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
```

Keep the oracle wallet funded only with enough Sepolia ETH for gas. Never commit
real keys or `.env` files.

## Deployment

On Vercel, set the project root directory to:

```txt
frontend
```

Then add the environment variables above.

## Contracts

Deployed factory:

```txt
0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470
```

Sepolia Etherscan:

```txt
https://sepolia.etherscan.io/address/0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470
```
