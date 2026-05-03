import { ethers } from "ethers";
import OpenAI from "openai";

const RPC_URL = envValue("SEPOLIA_RPC_URL") || envValue("VITE_SEPOLIA_RPC_URL");
const BLOCKED_FACTORY_ADDRESSES = addressSet(
  envValue("BLOCKED_FACTORY_ADDRESSES") || envValue("VITE_BLOCKED_FACTORY_ADDRESSES")
);
const SUPERSEDED_FACTORY_ADDRESSES = addressSet(
  envValue("SUPERSEDED_FACTORY_ADDRESSES") || envValue("VITE_SUPERSEDED_FACTORY_ADDRESSES")
);
const FACTORY_ADDRESS = factoryForOracle(
  envValue("FACTORY_ADDRESS") || envValue("VITE_FACTORY_ADDRESS")
);
const FACTORY_ADDRESSES = uniqueAddresses([
  FACTORY_ADDRESS,
  ...splitAddresses(envValue("FACTORY_ADDRESSES") || envValue("VITE_FACTORY_ADDRESSES")),
]);

const FACTORY_ABI = ["function getAllCampaigns() view returns (address[])"];

const CAMPAIGN_ABI = [
  "function oracleReviewMilestone(uint256,bool,string) external",
  "function oracleApproveMilestone(uint256) external",
  "function getAIReview(uint256) view returns (tuple(bool exists, bool approved, string summary, uint256 reviewedAt))",
  "function getMilestone(uint256) view returns (tuple(string title, string description, uint256 fundPercent, uint256 deadline, uint8 status, string evidenceUrl, uint256 vetoEndsAt))",
];

const MILESTONE_STATUS = {
  SUBMITTED: 1,
  IN_VETO: 2,
  APPROVED: 3,
  REJECTED: 4,
};

function envValue(key) {
  return String(process.env[key] || "").trim();
}

function splitAddresses(value) {
  return value.split(",").map((address) => address.trim()).filter(Boolean);
}

function addressSet(value) {
  return new Set(splitAddresses(value).map((address) => address.toLowerCase()));
}

function factoryForOracle(address) {
  if (!ethers.isAddress(address)) return "";

  const key = address.toLowerCase();
  if (BLOCKED_FACTORY_ADDRESSES.has(key) || SUPERSEDED_FACTORY_ADDRESSES.has(key)) {
    return "";
  }

  return address;
}

function uniqueAddresses(addresses) {
  const seen = new Set();

  return addresses.map((address) => address.trim()).filter((address) => {
    if (!ethers.isAddress(address)) return false;

    const key = address.toLowerCase();
    if (BLOCKED_FACTORY_ADDRESSES.has(key)) return false;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

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

function parseReview(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    const decision = String(parsed.decision || "").toUpperCase();
    const observations = String(parsed.observations || "").replace(/[^\x20-\x7E\n]/g, "").trim();
    const reason = String(parsed.reason || "").replace(/[^\x20-\x7E\n]/g, "").trim();

    if (decision !== "APPROVE" && decision !== "REJECT") {
      throw new Error("Invalid decision");
    }

    return {
      approved: decision === "APPROVE",
      decision,
      summary: `Observed: ${observations || "No clear visual evidence."}\nReason: ${reason || "The evidence was not strong enough."}`.slice(0, 680),
    };
  } catch {
    return {
      approved: false,
      decision: "REJECT",
      summary: "Observed: The oracle response could not be parsed.\nReason: The evidence was rejected because the AI review was inconclusive.",
    };
  }
}

async function supportsAIReview(provider, campaignAddress) {
  const data = new ethers.Interface(CAMPAIGN_ABI).encodeFunctionData("getAIReview", [0]);

  try {
    await provider.call({ to: campaignAddress, data });
    return true;
  } catch {
    return false;
  }
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

    if (!RPC_URL) {
      return res.status(500).json({ error: "Sepolia RPC URL is not configured." });
    }

    if (FACTORY_ADDRESSES.length === 0) {
      return res.status(500).json({ error: "Factory addresses are not configured." });
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
          content: "You are an AI Oracle for a decentralized charity fund. Verify whether this fresh browser-camera photo, captured at the provided GPS location, reasonably proves the NGO completed the milestone. Reject screenshots, edited images, irrelevant scenes, or weak evidence. Reply only as JSON with keys decision, observations, and reason. decision must be APPROVE or REJECT."
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Milestone: ${milestone.title}\nDescription: ${milestone.description}\nLocation: ${locationStr}\nCaptured: ${new Date(capturedAt).toISOString()}` },
            { type: "image_url", image_url: { url: imageB64 } }
          ]
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 220,
    });

    const review = parseReview(response.choices[0].message.content);
    const supportsReview = await supportsAIReview(provider, campaignAddress);

    if (supportsReview) {
      const tx = await contract.oracleReviewMilestone(milestoneId, review.approved, review.summary);
      await tx.wait();
      return res.status(200).json({
        status: "24-hour review window opened",
        decision: review.decision,
        summary: review.summary,
        txHash: tx.hash,
        chainUpdated: true,
      });
    }

    if (review.approved) {
      const tx = await contract.oracleApproveMilestone(milestoneId);
      await tx.wait();
      return res.status(200).json({
        status: "24-hour review window opened",
        decision: review.decision,
        summary: review.summary,
        txHash: tx.hash,
        chainUpdated: true,
        warning: "This legacy campaign cannot store the AI explanation on-chain.",
      });
    }

    return res.status(200).json({
      status: "AI recommends rejection",
      decision: review.decision,
      summary: review.summary,
      chainUpdated: false,
      warning: "This legacy campaign cannot run a 24-hour rejection review, so the oracle did not reject it on-chain.",
    });

  } catch (error) {
    console.error("Oracle Error:", error);
    return res.status(500).json({ error: cleanOracleError(error) });
  }
}
