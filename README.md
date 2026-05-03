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
  api/analyze.js      Serverless AI oracle endpoint
  assets/
  components/
  blockchain.ts       Wallet, chain config, ABIs, campaign reads
  index.css
  index.html
  main.tsx
  package.json
  tsconfig.json
  vite.config.ts
```

`blockchain.ts` has the deployed factory address, Sepolia RPC fallback, contract
ABIs, RainbowKit wallet setup, and campaign read hooks. Active Campaigns are
read from the factory contract through the Sepolia RPC. The default RPC is:

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

That lets Vercel install the frontend dependencies, run the Vite build, and
deploy `frontend/api/analyze.js` as `/api/analyze`.

The frontend includes `frontend/vercel.json` with these settings:

```txt
Framework Preset: Vite
Install Command: npm install
Build Command: npm run build
Output Directory: dist
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
