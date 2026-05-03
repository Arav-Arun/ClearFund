# ClearFund

A simple, transparent milestone-based donation platform on Ethereum (Sepolia testnet).

Donors fund campaigns and vote on milestone evidence with their donation weight. No backend, no AI — everything runs on-chain.

---

## How It Works

1. **NGO creates a campaign** via the factory contract, defining a goal, a bootstrap grant (%), and up to 4 milestones.
2. **Donors send ETH** — once the bootstrap tranche is funded, funds release automatically to the NGO.
3. **NGO submits evidence** (a URL) for each milestone on-chain.
4. **Donors vote** — each donor's vote is weighted by how much they donated. If >50% of donated ETH approves, funds release. If >50% rejects, the milestone reverts to Pending for resubmission.
5. **Refunds** — if fundraising fails (deadline passes without hitting goal), donors can claim a proportional refund.

---

## Project Structure

```
ClearFund/
├── contracts/
│   ├── ImpactFundCampaign.sol   # Per-campaign escrow + voting logic
│   └── ImpactFundFactory.sol    # Deploys and registers campaigns
└── frontend/
    └── src/
        ├── pages/               # Home, CampaignDetail, CreateCampaign
        ├── hooks/               # useCampaign, useWallet
        ├── components/          # Navbar, Footer
        ├── constants.ts         # ABIs, addresses
        └── types/               # Shared TypeScript types
```

---

## Getting Started

### 1. Install dependencies

```bash
# Root (Hardhat)
npm install

# Frontend (Vite + React)
cd frontend && npm install
```

### 2. Configure environment

Copy `.env.example` to `.env` and fill in:
- `SEPOLIA_RPC_URL` — your Infura/Alchemy endpoint
- `PRIVATE_KEY` — deployer wallet private key
- `VITE_FACTORY_ADDRESS` — deployed factory address
- `VITE_WALLETCONNECT_PROJECT_ID` — from cloud.walletconnect.com

### 3. Deploy contracts

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network sepolia
```

### 4. Run the frontend

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

---

## Tech Stack

- **Smart Contracts** — Solidity 0.8.27, Hardhat, OpenZeppelin ReentrancyGuard
- **Frontend** — React 19, TypeScript, Vite, ethers.js v6
- **Wallet** — RainbowKit + wagmi
- **Network** — Ethereum Sepolia testnet
