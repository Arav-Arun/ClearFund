# ClearFund

**Author:** [Arav Arun](https://aravarun.xyz)

> A decentralized, AI-verified fundraising platform for NGOs. Donors escrow ETH in smart contracts. Milestone payouts are triggered only after a live photo is captured on-site, reviewed by GPT-4o Vision, and passes a 24-hour public veto window.

[![Live Demo](https://img.shields.io/badge/Live-Demo-blue)](https://clearfund.aravarun.xyz)
[![Sepolia Contract](https://img.shields.io/badge/Sepolia-Contract-green)](https://sepolia.etherscan.io/address/0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470)
[![GitHub](https://img.shields.io/badge/GitHub-Repo-black)](https://github.com/Arav-Arun/ClearFund)

---

## The Problem

Traditional charity donations are a black box. You send money and hope it reaches the intended cause. Even modern crypto-fundraising platforms suffer from:

- **No accountability after funding** — NGOs can ghost once they receive funds.
- **Donor fatigue from voting** — Requiring donors to manually approve each milestone is unrealistic.
- **Fake photo evidence** — Easy to submit old or internet-scraped photos as proof of work.
- **Deadlocked funds** — If a campaign stalls mid-way, money gets locked forever.

## The Solution

ClearFund combines smart contract escrow with an AI Oracle to create a fast, fair, and fraud-resistant funding pipeline.

1. NGOs create a campaign with a goal, a list of milestones, and a bootstrap percentage.
2. Donors fund the campaign. No hard cap — overfunding is welcome.
3. The NGO starts the campaign. The bootstrap grant is released immediately.
4. For each milestone, the NGO must take a **live photo on-site** (no gallery uploads).
5. The photo and GPS coordinates are sent to a **GPT-4o Vision** Oracle for analysis.
6. If the AI approves, a **24-hour veto window** opens. Any donor can veto if they spot fraud.
7. After 24 hours with no veto, funds are automatically released to the NGO.
8. If the NGO ghosts, donors can cancel the campaign after a deadline passes and claim refunds.

---

## Key Features

| Feature | Description |
|---|---|
| AI Oracle Verification | GPT-4o Vision analyzes live photo evidence against the milestone description |
| Live Camera Capture Only | Frontend forces camera capture; gallery uploads are blocked |
| GPS Location Tagging | Geolocation is captured alongside every photo submission |
| 24-Hour Donor Veto | Human check-and-balance on top of AI. Any donor can flag and stop a payout |
| Soft Cap (Overfunding) | No hard cap on donations. Payouts scale proportionally to total raised |
| Ghosting Deadlock Fix | If an NGO misses a milestone deadline, donors can cancel and claim proportional refunds |
| Non-custodial | ClearFund never holds funds. ETH is locked in the campaign contract itself |

---

## Project Structure

```
ClearFund/
|
|-- contracts/               # Solidity smart contracts (clean, no build artifacts)
|   |-- ClearFundFactory.sol     # Deploys campaign contracts and maintains the registry
|   |-- ClearFundCampaign.sol    # Escrow, AI Oracle, veto, refund logic
|
|-- frontend/                # React + TypeScript frontend (Vite)
|   |-- components/              # React UI pages and components
|   |   |-- App.tsx              # Root component with routing
|   |   |-- Home.tsx             # Campaign browsing page
|   |   |-- CampaignDetail.tsx   # Live camera capture, donate, veto interface
|   |   |-- CreateCampaign.tsx   # NGO campaign creation form
|   |   |-- Navbar.tsx
|   |   |-- Footer.tsx
|   |-- hooks/               # Custom React hooks
|   |   |-- useCampaign.ts       # Reads campaign and milestone state from chain
|   |   |-- useWallet.ts         # Wallet connection (MetaMask)
|   |-- utils/               # Shared utilities and constants
|   |   |-- constants.ts         # Contract addresses, ABIs
|   |   |-- types.ts             # TypeScript interfaces
|   |   |-- format.ts            # ETH formatting helpers
|   |-- assets/              # Static images
|   |-- main.tsx             # React entry point
|   |-- index.css            # Global styles
|
|-- oracle/                  # Node.js AI Oracle backend
|   |-- server.js                # Express server that calls OpenAI and signs txs
|
|-- .env                     # Secret keys (NOT committed to git)
|-- README.md
```

---

## How the Smart Contracts Work

### [`ClearFundFactory.sol`](https://sepolia.etherscan.io/address/0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470)

The factory is the single entry point deployed on-chain. It:
- Stores the `oracleAddress` (the AI backend's wallet).
- Deploys a new `ClearFundCampaign` contract for every campaign.
- Maintains a global registry of all campaigns.

**Key function:**
```solidity
function createCampaign(
    string _title,
    string _description,
    string _ngoName,
    uint256 _bootstrapPercent,  // 1-15%: released when campaign starts
    MilestoneInput[] _milestones,
    uint256 _goalAmount,
    uint256 _campaignDeadline
) external returns (address)
```

### [`ClearFundCampaign.sol`](./contracts/ClearFundCampaign.sol)

Each campaign is its own smart contract holding all the ETH. It has four lifecycle states:

```
Fundraising --> Active --> Completed
                  |
                  v
               Cancelled (if ghosted or refund triggered)
```

And five milestone states:

```
Pending --> Submitted --> InVeto --> Approved
                    \
                     --> Rejected (by AI or Donor Veto)
```

**Key functions:**

| Function | Who Calls It | What It Does |
|---|---|---|
| `donate()` | Anyone | Sends ETH to the campaign escrow |
| `startCampaign()` | NGO | Locks donations, releases bootstrap grant |
| `submitMilestone(id, evidenceUrl)` | NGO | Submits photo evidence on-chain |
| `oracleApproveMilestone(id)` | AI Oracle | Moves milestone to 24hr veto window |
| `oracleRejectMilestone(id)` | AI Oracle | Marks milestone as Rejected |
| `vetoMilestone(id)` | Any Donor | Stops a payout during the veto window |
| `executeMilestone(id)` | Anyone | Releases funds after veto window expires |
| `cancelStalledCampaign()` | Anyone | Cancels if NGO misses a deadline |
| `refund()` | Donor | Claims proportional refund if cancelled |

---

## How the AI Oracle Works

The oracle is a Node.js Express server in `/oracle/server.js`.

1. The frontend submits a milestone on-chain via `submitMilestone()`.
2. Immediately after, the frontend POSTs the live photo (Base64) and GPS coordinates to `POST localhost:3001/analyze`.
3. The oracle server sends the image and milestone description to **GPT-4o Vision**.
4. GPT-4o responds with `APPROVE` or `REJECT`.
5. The oracle's Ethereum wallet signs and sends either `oracleApproveMilestone()` or `oracleRejectMilestone()` to the campaign contract.

The AI prompt is straightforward:
> "You are an AI Oracle for a decentralized charity fund. Does this photo (taken at GPS location X) prove that the NGO completed: [milestone description]? Reply ONLY with APPROVE or REJECT."

---

## Deployed Contracts

| Contract | Network | Address |
|---|---|---|
| ClearFundFactory | Sepolia | [`0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470`](https://sepolia.etherscan.io/address/0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470) |

---

## Local Setup

### Prerequisites

- [Node.js](https://nodejs.org) v18+
- [MetaMask](https://metamask.io) browser extension
- OpenAI API key with GPT-4o access
- A funded Sepolia wallet (for the Oracle to sign transactions)

### 1. Clone the repo

```bash
git clone https://github.com/Arav-Arun/ClearFund.git
cd ClearFund
```

### 2. Configure environment variables

Create a `.env` file in the root:

```
OPENAI_API_KEY=sk-...
PRIVATE_KEY=0x...       # Oracle wallet private key
SEPOLIA_RPC_URL=        # Optional: defaults to publicnode
```

### 3. Start the frontend

```bash
cd frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5173`.

### 4. Start the AI Oracle backend

In a separate terminal:

```bash
cd oracle
node server.js
```

The oracle listens on `http://localhost:3001`.

---

## Deploying the Contracts (Optional)

If you want to redeploy to your own wallet:

```bash
cd deploy_temp
npx hardhat run scripts/deploy.js --network sepolia
```

Copy the output address and paste it into `frontend/utils/constants.ts` as `FACTORY_ADDRESS`.

---

## Security Design

| Threat | Defense |
|---|---|
| Old/recycled photos | Camera-only capture (`capture="environment"`); gallery uploads blocked |
| Fake GPS data | Browser Geolocation API; coordinates are embedded in the evidence URL on-chain |
| AI getting fooled by deepfakes | 24-hour donor veto window provides human oversight |
| NGO ghosting after bootstrap | `cancelStalledCampaign()` lets anyone trigger a cancellation after a missed deadline |
| Reentrancy attacks | OpenZeppelin `ReentrancyGuard` on all fund-moving functions |
| Overfunding | Soft cap: all payouts are calculated as a percentage of total `raisedAmount` |

---

## Tech Stack

**Frontend:** React, TypeScript, Vite, ethers.js

**Smart Contracts:** Solidity 0.8.27, OpenZeppelin, Hardhat

**AI Oracle:** Node.js, Express, OpenAI GPT-4o Vision API

**Blockchain:** Ethereum Sepolia Testnet

---

## License

MIT License. Built by [Arav Arun](https://aravarun.xyz).
