import { ethers } from "ethers";
import OpenAI from "openai";

const RPC_URL = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const FACTORY_ADDRESS =
  process.env.FACTORY_ADDRESS || "0x9F2F3AEF7960eBf8f578d7174FB8f3135394b398";
const LEGACY_FACTORY_ADDRESSES = [
  "0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470",
  "0x6A837595E2592d699d48eB2DAcF47Df9493035d2",
];
const FACTORY_ADDRESSES = [
  FACTORY_ADDRESS,
  ...(process.env.FACTORY_ADDRESSES?.split(",") || LEGACY_FACTORY_ADDRESSES),
].map((address) => address.trim()).filter(Boolean);

const FACTORY_ABI = ["function getAllCampaigns() view returns (address[])"];

const CAMPAIGN_ABI = [
  "function oracleApproveMilestone(uint256) external",
  "function oracleRejectMilestone(uint256) external",
  "function getMilestone(uint256) view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string evidenceUrl, uint256 vetoEndsAt))"
];

const MILESTONE_STATUS = {
  SUBMITTED: 1,
  IN_VETO: 2,
  APPROVED: 3,
  REJECTED: 4,
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanOracleError(error) {
  const message = [
    error?.reason,
    error?.shortMessage,
    error?.info?.error?.message,
    error?.message,
  ].filter(Boolean).join(" ");

  if (/not submitted|proof is not submitted/i.test(message)) {
    return "Proof is not visible to the oracle yet. Wait a few seconds and retry.";
  }

  if (/caller is not.*oracle|not the oracle/i.test(message)) {
    return "Oracle wallet does not match this campaign.";
  }

  return "Oracle request failed.";
}

async function waitForSubmittedMilestone(contract, milestoneId) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const milestone = await contract.getMilestone(milestoneId);
    const status = Number(milestone.status);

    if (status === MILESTONE_STATUS.SUBMITTED) return milestone;
    if (status === MILESTONE_STATUS.IN_VETO) return { done: "Already in veto review." };
    if (status === MILESTONE_STATUS.APPROVED) return { done: "Already approved." };
    if (status === MILESTONE_STATUS.REJECTED) return { error: "Milestone was already rejected. Submit fresh proof." };

    await wait(1500);
  }

  return { error: "Proof is not visible on-chain yet. Wait a few seconds and retry." };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { campaignAddress, milestoneId, imageB64, locationStr, capturedAt } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const privateKey = process.env.PRIVATE_KEY;

    if (!apiKey || !privateKey) {
      return res.status(500).json({ error: "Oracle is not configured." });
    }

    if (!ethers.isAddress(campaignAddress)) {
      return res.status(400).json({ error: "Invalid campaign address." });
    }

    if (!Number.isInteger(milestoneId) || milestoneId < 0) {
      return res.status(400).json({ error: "Invalid milestone id." });
    }

    if (typeof imageB64 !== "string" || !imageB64.startsWith("data:image/jpeg;base64,")) {
      return res.status(400).json({ error: "Live camera photo is required." });
    }

    if (imageB64.length > 5_000_000) {
      return res.status(413).json({ error: "Image is too large." });
    }

    if (!Number.isInteger(capturedAt) || Math.abs(Date.now() - capturedAt) > 5 * 60 * 1000) {
      return res.status(400).json({ error: "Evidence capture is stale." });
    }

    if (typeof locationStr !== "string" || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(locationStr)) {
      return res.status(400).json({ error: "Invalid location." });
    }

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const normalizedCampaign = campaignAddress.toLowerCase();
    let isRegistered = false;

    for (const factoryAddress of FACTORY_ADDRESSES) {
      if (!ethers.isAddress(factoryAddress)) continue;

      try {
        const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
        const campaigns = await factory.getAllCampaigns();
        if (campaigns.some((address) => address.toLowerCase() === normalizedCampaign)) {
          isRegistered = true;
          break;
        }
      } catch (err) {
        console.error("Factory lookup failed:", factoryAddress, err);
      }
    }

    if (!isRegistered) {
      return res.status(403).json({ error: "Campaign is not registered." });
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, wallet);
    const milestone = await waitForSubmittedMilestone(contract, milestoneId);

    if (milestone.done) {
      return res.status(200).json({ status: milestone.done });
    }

    if (milestone.error) {
      return res.status(409).json({ error: milestone.error });
    }

    const openai = new OpenAI({ apiKey });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an AI Oracle for a decentralized charity fund. Verify whether this fresh browser-camera photo, captured at the provided GPS location, reasonably proves the NGO completed the milestone. Reject screenshots, edited images, irrelevant scenes, or weak evidence. Reply ONLY with APPROVE or REJECT."
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Milestone: ${milestone.title}\nDescription: ${milestone.description}\nLocation: ${locationStr}\nCaptured: ${new Date(capturedAt).toISOString()}` },
            { type: "image_url", image_url: { url: imageB64 } }
          ]
        }
      ],
      max_tokens: 10,
    });

    const decision = response.choices[0].message.content?.trim().toUpperCase() || "REJECT";

    if (decision === "APPROVE") {
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
    return res.status(500).json({ error: cleanOracleError(error) });
  }
}
