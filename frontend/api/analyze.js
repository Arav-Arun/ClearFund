import { list, put } from "@vercel/blob";
import { ethers } from "ethers";
import OpenAI from "openai";

const RPC_URL = envValue("SEPOLIA_RPC_URL") || envValue("VITE_SEPOLIA_RPC_URL");
const AI_MODEL = envValue("AI_MODEL");
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

function reviewPath(campaignAddress, milestoneId) {
  return `reviews/${campaignAddress.toLowerCase()}/${milestoneId}.json`;
}

function proofPath(campaignAddress, milestoneId, capturedAt) {
  return `proofs/${campaignAddress.toLowerCase()}/${milestoneId}-${capturedAt}.jpg`;
}

function hasBlobStore() {
  return !!envValue("BLOB_READ_WRITE_TOKEN");
}

function requireBlobStore() {
  if (!hasBlobStore()) {
    throw new Error("Proof storage is not configured. Add BLOB_READ_WRITE_TOKEN in Vercel.");
  }
}

function imageBuffer(imageB64) {
  return Buffer.from(imageB64.replace("data:image/jpeg;base64,", ""), "base64");
}

async function saveProof({ campaignAddress, milestoneId, imageB64, capturedAt }) {
  requireBlobStore();

  const blob = await put(
    proofPath(campaignAddress, milestoneId, capturedAt),
    imageBuffer(imageB64),
    {
      access: "public",
      allowOverwrite: true,
      contentType: "image/jpeg",
      cacheControlMaxAge: 31536000,
    }
  );

  return blob.url;
}

async function saveReview(review) {
  if (!hasBlobStore()) return "";

  try {
    const blob = await put(
      reviewPath(review.campaignAddress, review.milestoneId),
      JSON.stringify(review, null, 2),
      {
        access: "public",
        allowOverwrite: true,
        contentType: "application/json",
        cacheControlMaxAge: 60,
      }
    );

    return blob.url;
  } catch (error) {
    console.error("Review storage failed:", error);
    return "";
  }
}

async function loadReview(campaignAddress, milestoneId) {
  if (!hasBlobStore()) return null;

  try {
    const result = await list({
      prefix: reviewPath(campaignAddress, milestoneId),
      limit: 1,
    });
    const [blob] = result.blobs;
    if (!blob) return null;

    const response = await fetch(blob.url, { cache: "no-store" });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error("Review lookup failed:", error);
    return null;
  }
}

function validateEvidence({ campaignAddress, milestoneId, imageB64, locationStr, capturedAt }) {
  const idError = validateIds({ campaignAddress, milestoneId });
  if (idError) return idError;

  if (typeof imageB64 !== "string" || !imageB64.startsWith("data:image/jpeg;base64,")) {
    return "Live camera photo is required.";
  }

  if (imageB64.length > 5_000_000) {
    return "Image is too large.";
  }

  if (!Number.isInteger(capturedAt) || Math.abs(Date.now() - capturedAt) > 5 * 60 * 1000) {
    return "Evidence capture is stale.";
  }

  if (typeof locationStr !== "string" || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(locationStr)) {
    return "Invalid location.";
  }

  const [lat, lng] = locationStr.split(",").map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return "Invalid location.";
  }

  return "";
}

function validateIds({ campaignAddress, milestoneId }) {
  if (!ethers.isAddress(campaignAddress)) {
    return "Invalid campaign address.";
  }

  if (!Number.isInteger(milestoneId) || milestoneId < 0) {
    return "Invalid milestone id.";
  }

  return "";
}

function validateProofUrl(evidenceUrl) {
  if (typeof evidenceUrl !== "string" || evidenceUrl.length > 2048 || !/^https:\/\//i.test(evidenceUrl)) {
    return "Public proof image URL is required.";
  }

  return "";
}

function validateStoredProof(record, evidenceUrl) {
  if (!record || record.evidenceUrl !== evidenceUrl) {
    return "Stored proof metadata does not match the on-chain proof.";
  }

  if (typeof record.locationStr !== "string" || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(record.locationStr)) {
    return "Stored proof location is missing.";
  }

  const [lat, lng] = record.locationStr.split(",").map(Number);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return "Stored proof location is invalid.";
  }

  if (!Number.isInteger(Number(record.capturedAt)) || Number(record.capturedAt) <= 0) {
    return "Stored proof capture time is missing.";
  }

  return "";
}

const REVIEW_RESPONSE_FORMATS = [
  {
    type: "json_schema",
    json_schema: {
      name: "clearfund_ai_review",
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          decision: { type: "string", enum: ["APPROVE", "REJECT"] },
          observations: { type: "string" },
          reason: { type: "string" },
        },
        required: ["decision", "observations", "reason"],
      },
    },
  },
  { type: "json_object" },
];

function cleanOracleError(error) {
  const message = [
    error?.reason,
    error?.shortMessage,
    error?.info?.error?.message,
    error?.message,
  ].filter(Boolean).join(" ");

  if (/proof storage|blob_read_write_token|blob token/i.test(message)) {
    return "Proof storage is not configured. Add BLOB_READ_WRITE_TOKEN in Vercel.";
  }

  if (/not submitted|proof is not submitted/i.test(message)) {
    return "Proof is not visible to the oracle yet. Wait a few seconds and retry.";
  }

  if (/caller is not.*oracle|not the oracle/i.test(message)) {
    return "Oracle wallet does not match this campaign.";
  }

  if (/AI returned no analysis|AI refused|AI did not return|Finish reason/i.test(message)) {
    return message;
  }

  if (/image.*not supported|does not support.*image|vision/i.test(message)) {
    return "AI model cannot analyze images. Set AI_MODEL to a vision-capable OpenAI model such as gpt-4o or gpt-4o-mini.";
  }

  if (/model.*not found|does not exist|invalid model/i.test(message)) {
    return "AI model is not available for this API key. Check AI_MODEL in Vercel.";
  }

  return "Oracle request failed.";
}

function reviewMessages({ milestone, proofLocation, proofCapturedAt, evidenceUrl }) {
  return [
    {
      role: "system",
      content: "You are an AI Oracle for a decentralized charity fund. Verify whether this public proof image reasonably proves the NGO completed the milestone. Reject screenshots, edited images, irrelevant scenes, or weak evidence. Reply only as JSON with keys decision, observations, and reason. decision must be APPROVE or REJECT.",
    },
    {
      role: "user",
      content: [
        { type: "text", text: `Milestone: ${milestone.title}\nDescription: ${milestone.description}\nLocation: ${proofLocation}\nCaptured: ${new Date(proofCapturedAt).toISOString()}\nProof URL: ${evidenceUrl}` },
        { type: "image_url", image_url: { url: evidenceUrl } },
      ],
    },
  ];
}

function aiText(response) {
  const choice = response?.choices?.[0];
  const message = choice?.message || {};

  if (message.refusal) {
    throw new Error(`AI refused to review the proof: ${message.refusal}`);
  }

  if (typeof message.content === "string" && message.content.trim()) {
    return message.content.trim();
  }

  if (Array.isArray(message.content)) {
    const text = message.content.map((part) => {
      if (typeof part === "string") return part;
      return part?.text || part?.content || "";
    }).join("\n").trim();

    if (text) return text;
  }

  const finishReason = choice?.finish_reason || "unknown";
  throw new Error(`AI returned no analysis text. Finish reason: ${finishReason}. Use a vision-capable OpenAI model such as gpt-4o or gpt-4o-mini.`);
}

function parseReview(raw) {
  const content = String(raw || "").trim();
  if (!content) {
    throw new Error("AI returned no analysis text.");
  }

  try {
    const jsonText = content.match(/\{[\s\S]*\}/)?.[0] || content || "{}";
    const parsed = JSON.parse(jsonText);
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
    const text = content.replace(/[^\x20-\x7E\n]/g, "").trim();
    if (!text) throw new Error("AI returned no analysis text.");

    const saysApprove = /\bAPPROVE\b/i.test(text);
    const saysReject = /\bREJECT\b/i.test(text);
    if (saysApprove === saysReject) {
      throw new Error("AI did not return a clear APPROVE or REJECT decision.");
    }

    const approved = saysApprove;

    return {
      approved,
      decision: approved ? "APPROVE" : "REJECT",
      summary: `Observed: ${text.slice(0, 500)}\nReason: The model returned text instead of structured JSON, so the raw analysis is shown.`,
    };
  }
}

async function analyzeProof({ openai, milestone, proofLocation, proofCapturedAt, evidenceUrl }) {
  let lastError;
  const messages = reviewMessages({ milestone, proofLocation, proofCapturedAt, evidenceUrl });

  for (const response_format of REVIEW_RESPONSE_FORMATS) {
    try {
      const response = await openai.chat.completions.create({
        model: AI_MODEL,
        messages,
        response_format,
        max_completion_tokens: 500,
      });

      return parseReview(aiText(response));
    } catch (error) {
      lastError = error;
      console.error("AI review attempt failed:", error);
    }
  }

  throw lastError || new Error("AI review failed.");
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

async function isRegisteredCampaign(provider, campaignAddress) {
  const normalizedCampaign = campaignAddress.toLowerCase();

  for (const factoryAddress of FACTORY_ADDRESSES) {
    if (!ethers.isAddress(factoryAddress)) continue;

    try {
      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
      const campaigns = await factory.getAllCampaigns();
      if (campaigns.some((address) => address.toLowerCase() === normalizedCampaign)) {
        return true;
      }
    } catch (err) {
      console.error("Factory lookup failed:", factoryAddress, err);
    }
  }

  return false;
}

async function saveReviewResult(review, warning = "") {
  const reviewUrl = await saveReview(warning ? { ...review, warning } : review);
  return { reviewUrl, warning };
}

function assertServerConfig() {
  if (!RPC_URL) return "Sepolia RPC URL is not configured.";
  if (FACTORY_ADDRESSES.length === 0) return "Factory addresses are not configured.";
  return "";
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const campaignAddress = String(req.query.campaignAddress || "");
      const milestoneId = Number(req.query.milestoneId);

      if (!ethers.isAddress(campaignAddress) || !Number.isInteger(milestoneId)) {
        return res.status(400).json({ error: "Invalid review lookup." });
      }

      const review = await loadReview(campaignAddress, milestoneId);
      return review
        ? res.status(200).json(review)
        : res.status(404).json({ error: "No AI review found." });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = req.body || {};
    const { action = "review", campaignAddress, milestoneId, imageB64, locationStr, capturedAt, evidenceUrl } = body;
    const configError = assertServerConfig();
    if (configError) return res.status(500).json({ error: configError });

    const idError = validateIds({ campaignAddress, milestoneId });
    if (idError) return res.status(400).json({ error: idError });

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    if (!(await isRegisteredCampaign(provider, campaignAddress))) {
      return res.status(403).json({ error: "Campaign is not registered." });
    }

    if (action === "upload") {
      const evidenceError = validateEvidence({ campaignAddress, milestoneId, imageB64, locationStr, capturedAt });
      if (evidenceError) return res.status(400).json({ error: evidenceError });

      const url = await saveProof({ campaignAddress, milestoneId, imageB64, capturedAt });
      const recordUrl = await saveReview({
        campaignAddress,
        milestoneId,
        evidenceUrl: url,
        locationStr,
        capturedAt,
        reviewedAt: 0,
        chainUpdated: false,
      });
      if (!recordUrl) return res.status(500).json({ error: "Proof metadata could not be saved." });

      return res.status(200).json({ evidenceUrl: url, locationStr, capturedAt });
    }

    if (action !== "review") {
      return res.status(400).json({ error: "Unknown oracle action." });
    }

    const proofUrlError = validateProofUrl(evidenceUrl);
    if (proofUrlError) return res.status(400).json({ error: proofUrlError });

    const proofRecord = await loadReview(campaignAddress, milestoneId);
    const storedProofError = validateStoredProof(proofRecord, evidenceUrl);
    if (storedProofError) return res.status(409).json({ error: storedProofError });

    const apiKey = envValue("OPENAI_API_KEY");
    const privateKey = envValue("PRIVATE_KEY");

    if (!apiKey || !privateKey || !AI_MODEL) {
      return res.status(500).json({ error: "Oracle is not configured." });
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

    if (String(milestone.evidenceUrl || "") !== evidenceUrl) {
      return res.status(409).json({ error: "Oracle proof does not match the on-chain proof URL." });
    }

    const proofLocation = proofRecord.locationStr;
    const proofCapturedAt = Number(proofRecord.capturedAt);

    const openai = new OpenAI({ apiKey });
    const review = await analyzeProof({ openai, milestone, proofLocation, proofCapturedAt, evidenceUrl });
    const supportsReview = await supportsAIReview(provider, campaignAddress);
    const baseReview = {
      campaignAddress,
      milestoneId,
      evidenceUrl,
      locationStr: proofLocation,
      capturedAt: proofCapturedAt,
      decision: review.decision,
      approved: review.approved,
      summary: review.summary,
      reviewedAt: Math.floor(Date.now() / 1000),
    };

    if (supportsReview) {
      try {
        const tx = await contract.oracleReviewMilestone(milestoneId, review.approved, review.summary);
        await tx.wait();
        const { reviewUrl } = await saveReviewResult({ ...baseReview, txHash: tx.hash, chainUpdated: true });
        return res.status(200).json({
          status: "24-hour review window opened",
          decision: review.decision,
          summary: review.summary,
          evidenceUrl,
          reviewUrl,
          locationStr: proofLocation,
          capturedAt: proofCapturedAt,
          reviewedAt: baseReview.reviewedAt,
          txHash: tx.hash,
          chainUpdated: true,
        });
      } catch (error) {
        const warning = `${cleanOracleError(error)} The AI analysis is saved, but donor voting starts only after the on-chain 24-hour review opens.`;
        const { reviewUrl } = await saveReviewResult({ ...baseReview, chainUpdated: false }, warning);
        return res.status(200).json({
          status: "AI analyzed proof, but on-chain review did not open",
          decision: review.decision,
          summary: review.summary,
          evidenceUrl,
          reviewUrl,
          locationStr: proofLocation,
          capturedAt: proofCapturedAt,
          reviewedAt: baseReview.reviewedAt,
          chainUpdated: false,
          warning,
        });
      }
    }

    if (review.approved) {
      const tx = await contract.oracleApproveMilestone(milestoneId);
      await tx.wait();
      const warning = "This legacy campaign cannot store the AI explanation on-chain.";
      const { reviewUrl } = await saveReviewResult({ ...baseReview, txHash: tx.hash, chainUpdated: true }, warning);
      return res.status(200).json({
        status: "24-hour review window opened",
        decision: review.decision,
        summary: review.summary,
        evidenceUrl,
        reviewUrl,
        locationStr: proofLocation,
        capturedAt: proofCapturedAt,
        reviewedAt: baseReview.reviewedAt,
        txHash: tx.hash,
        chainUpdated: true,
        warning,
      });
    }

    const warning = "This legacy campaign cannot run a 24-hour rejection review, so the oracle did not reject it on-chain.";
    const { reviewUrl } = await saveReviewResult({ ...baseReview, chainUpdated: false }, warning);
    return res.status(200).json({
      status: "AI recommends rejection",
      decision: review.decision,
      summary: review.summary,
      evidenceUrl,
      reviewUrl,
      locationStr: proofLocation,
      capturedAt: proofCapturedAt,
      reviewedAt: baseReview.reviewedAt,
      chainUpdated: false,
      warning,
    });

  } catch (error) {
    console.error("Oracle Error:", error);
    return res.status(500).json({ error: cleanOracleError(error) });
  }
}
