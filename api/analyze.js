import { ethers } from "ethers";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const CAMPAIGN_ABI = [
  "function oracleApproveMilestone(uint256) external",
  "function oracleRejectMilestone(uint256) external",
  "function getMilestone(uint256) view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string evidenceUrl, uint256 vetoEndsAt))"
];

export default async function handler(req, res) {
  // CORS handled by Vercel automatically if configured, or just allowed by default for same-origin
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { campaignAddress, milestoneId, imageB64, locationStr } = req.body;
    const privateKey = process.env.PRIVATE_KEY;

    if (!privateKey) {
      return res.status(500).json({ error: "Oracle wallet not configured (PRIVATE_KEY missing)" });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, wallet);
    
    const milestone = await contract.getMilestone(milestoneId);
    const description = milestone.description;

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

    if (decision.includes("APPROVE")) {
      const tx = await contract.oracleApproveMilestone(milestoneId);
      await tx.wait();
      return res.status(200).json({ status: "Approved", txHash: tx.hash });
    } else {
      const tx = await contract.oracleRejectMilestone(milestoneId);
      await tx.wait();
      return res.status(200).json({ status: "Rejected", txHash: tx.hash });
    }

  } catch (error) {
    console.error("Oracle Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
