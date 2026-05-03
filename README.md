![ClearFund Banner](frontend/assets/clearFundBanner.png)

# ClearFund

A transparent, milestone based donation platform built on the Ethereum Sepolia testnet.

ClearFund solves the problem of trust in charitable donations. Instead of sending money blindly to an organization and hoping it gets used correctly, donors fund a smart contract escrow. The NGO only receives funds as they prove they have completed specific milestones. Every step of the way is verified on chain, ensuring total accountability and transparency.

### Core Concept

* **Targeted Goals:** NGOs create a campaign with a specific financial goal and a clear breakdown of milestones.
* **Smart Escrow:** Donated ETH is held safely in a smart contract. An initial bootstrap percentage is released immediately to kickstart the project, while the rest remains locked.
* **Community Verification:** As the NGO progresses, they submit evidence for each milestone. Donors then vote on whether the evidence is sufficient.
* **Weighted Voting:** Your voting power is proportional to your donation amount. If the majority approves, the milestone funds are unlocked. If rejected, the NGO must resubmit better evidence.
* **Donor Protection:** If a campaign fails to reach its fundraising goal by the deadline, the contract allows donors to safely withdraw their contributions.

### Project Architecture

The project is deliberately structured to be clean and explainable, split into two core areas:

* **contracts:** Contains the pure Solidity smart contracts `ImpactFundCampaign.sol` and `ImpactFundFactory.sol` that handle all the escrow, voting, and release logic.
* **frontend:** A lightweight React application using Vite and ethers.js to interact directly with the blockchain, featuring a custom neobrutalist aesthetic.

### Getting Started Locally

* Navigate into the frontend directory
* Install dependencies using `npm install`
* Create a `.env` file and set your `VITE_FACTORY_ADDRESS` and `VITE_SEPOLIA_RPC_URL`
* Start the local server with `npm run dev`
* Open the provided localhost link in your browser

### Technical Foundation

* Solidity Smart Contracts
* React 19 and TypeScript
* Ethers.js v6 for pure on chain interaction
* Custom Neobrutalism UI design
