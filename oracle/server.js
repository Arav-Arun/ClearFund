require("dotenv").config({ path: "../.env" });
const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const { ethers } = require("ethers");
const OpenAI = require("openai");

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: "50mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Use Sepolia by default, or localhost if testing
const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://rpc.ankr.com/eth_sepolia";
const provider = new ethers.JsonRpcProvider(RPC_URL);

// The Oracle Wallet
const privateKey = process.env.PRIVATE_KEY;
const wallet = privateKey ? new ethers.Wallet(privateKey, provider) : null;

// ABI needed for the Oracle to make decisions
const CAMPAIGN_ABI = [
  "function oracleApproveMilestone(uint256) external",
  "function oracleRejectMilestone(uint256) external",
  "function getMilestone(uint256) view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string evidenceUrl, uint256 vetoEndsAt))"
];

app.post("/analyze", async (req, res) => {
  try {
    const { campaignAddress, milestoneId, imageB64, locationStr } = req.body;

    if (!wallet) {
      return res.status(500).json({ error: "Oracle wallet not configured (PRIVATE_KEY missing)" });
    }

    const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, wallet);
    
    // Fetch milestone details from contract to get the description
    const milestone = await contract.getMilestone(milestoneId);
    const description = milestone.description;

    console.log(`Analyzing Milestone ${milestoneId} for ${campaignAddress}...`);
    console.log(`Location provided: ${locationStr}`);

    // Call OpenAI Vision API
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an AI Oracle for a decentralized charity fund. Your job is to verify if the provided photo (taken at the provided GPS location) proves that the NGO has completed their milestone. Reply ONLY with 'APPROVE' if it looks legitimate, or 'REJECT' if it looks fake, irrelevant, or fails to meet the description."
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Milestone Description: ${description}\nLocation: ${locationStr}` },
            { type: "image_url", image_url: { url: imageB64 } }
          ]
        }
      ],
      max_tokens: 10,
    });

    const decision = response.choices[0].message.content.trim().toUpperCase();
    console.log(`OpenAI Decision: ${decision}`);

    if (decision.includes("APPROVE")) {
      const tx = await contract.oracleApproveMilestone(milestoneId);
      await tx.wait();
      return res.json({ status: "Approved", txHash: tx.hash });
    } else {
      const tx = await contract.oracleRejectMilestone(milestoneId);
      await tx.wait();
      return res.json({ status: "Rejected", txHash: tx.hash });
    }

  } catch (error) {
    console.error("Oracle Error:", error);
    res.status(500).json({ error: error.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`Oracle Server running on port ${PORT}`);
});
