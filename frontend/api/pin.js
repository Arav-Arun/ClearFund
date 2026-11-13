import { ethers } from "ethers";
import { createHmac } from "node:crypto";
import { put, BlobError } from "@vercel/blob";
import { uploadMessage } from "../src/uploadAuth.js";

const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "application/json"]);
const registryAbi = ["function isCampaign(address) view returns (bool)"];
const campaignAbi = ["function creator() view returns(address)", "function current() view returns(uint256)", "function status() view returns(uint8)"];

async function authorizeProof(auth) {
  if (auth.purpose !== "proof") return;
  const rpc = new ethers.FetchRequest(process.env.SEPOLIA_RPC_URL || process.env.VITE_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com");
  rpc.timeout = 10_000;
  const provider = new ethers.JsonRpcProvider(rpc, 11155111, { staticNetwork: true });
  try {
    const registry = new ethers.Contract(auth.factory, registryAbi, provider);
    if (!ethers.isAddress(auth.campaign) || !(await registry.isCampaign(auth.campaign))) throw new Error("Unregistered campaign");
    const c = new ethers.Contract(auth.campaign, campaignAbi, provider);
    const [creator, current, status] = await Promise.all([c.creator(), c.current(), c.status()]);
    if (creator.toLowerCase() !== auth.wallet.toLowerCase() || Number(current) !== auth.milestone || Number(status) !== 1) throw new Error("Not the current campaign organizer");
  } finally { provider.destroy(); }
}

// Immutable slots avoid per-instance memory counters and read/modify/write races.
// Failed pins consume their reservation too. Never refund a slot after an ambiguous network failure.
async function reserveUpload({ wallet, ip, nonce, now = Date.now(), claim = claimBlob, secret = process.env.BLOB_READ_WRITE_TOKEN }) {
  if (!secret) throw Object.assign(new Error("Upload quotas are not configured."), { status: 503 });
  const digest = value => createHmac("sha256", secret).update(value).digest("hex");
  const day = new Date(now).toISOString().slice(0, 10);
  // Per-account, per-IP, daily and lifetime ceilings apply across all serverless instances.
  const scopes = [
    ["lifetime", 500],
    [`day/${day}/global`, 60],
    [`day/${day}/wallet/${digest(wallet)}`, 12],
    [`day/${day}/ip/${digest(ip)}`, 24],
  ];
  for (const [scope, limit] of scopes) {
    const start = parseInt(digest(scope + nonce).slice(0, 8), 16) % limit;
    let reserved = false;
    for (let probe = 0; probe < Math.min(limit, 8); probe++) {
      if (await claim(`upload-quota/v1/${scope}/${(start + probe) % limit}`)) { reserved = true; break; }
    }
    if (!reserved) throw Object.assign(new Error("The upload budget is full. Try later or contact the organizer."), { status: 429 });
  }
  if (!(await claim(`upload-quota/v1/nonces/${digest(wallet + nonce)}`))) {
    throw Object.assign(new Error("This upload authorization has already been used. Sign again."), { status: 409 });
  }
}

async function claimBlob(path) {
  try {
    await put(path, "reserved", { access: process.env.UPLOAD_QUOTA_BLOB_ACCESS === "private" ? "private" : "public",
      addRandomSuffix: false, allowOverwrite: false, contentType: "text/plain", cacheControlMaxAge: 60 });
    return true;
  } catch (err) {
    if (err instanceof BlobError && /already exists/i.test(err.message)) return false;
    throw Object.assign(new Error("Upload quota storage is unavailable. Try later."), { status: 503 });
  }
}

function createHandler({ reserve = reserveUpload, authorize = authorizeProof, pinFetch = fetch, now = () => Date.now() } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    if (!process.env.PINATA_JWT) return res.status(503).json({ error: "Uploads are not configured on this deployment." });
    const { name, type, data, auth, signature } = req.body || {};
    if (typeof name !== "string" || !name || name.length > 120 || /[\r\n]/.test(name) || !TYPES.has(type) || typeof data !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      return res.status(400).json({ error: "Send a photo, a PDF or a proof document." });
    }
    if (data.length > 4 * 1024 * 1024) return res.status(413).json({ error: "Files must be at most 3 MB." });
    const bytes = Buffer.from(data, "base64");
    if (!bytes.length || bytes.length > MAX_BYTES) return res.status(413).json({ error: "Files must be at most 3 MB." });
    const factories = [process.env.VITE_FACTORY_ADDRESS, process.env.VITE_FACTORY_V2_ADDRESS].filter(Boolean).map(a => a.toLowerCase());
    const host = String(req.headers?.host || "").toLowerCase();
    const issued = auth?.issued;
    if (!auth || !ethers.isAddress(auth.wallet) || !ethers.isAddress(auth.factory) || !factories.includes(auth.factory.toLowerCase())
      || auth.host !== host || auth.hash !== ethers.sha256(bytes) || auth.name !== name || auth.type !== type
      || !["campaign", "proof"].includes(auth.purpose) || !Number.isSafeInteger(issued)
      || issued > now() + 30_000 || issued < now() - 5 * 60_000 || !/^[a-f0-9]{32}$/.test(auth.nonce || "")
      || (auth.purpose === "proof" && (!Number.isInteger(auth.milestone) || auth.milestone < 0 || auth.milestone > 3))
      || typeof signature !== "string") {
      return res.status(401).json({ error: "Sign a fresh upload authorization with your wallet." });
    }
    try {
      if (ethers.verifyMessage(uploadMessage(auth), signature).toLowerCase() !== auth.wallet.toLowerCase()) throw new Error("Wrong signer");
    } catch { return res.status(401).json({ error: "The upload signature is invalid." }); }
    try {
      await authorize(auth);
    } catch { return res.status(403).json({ error: "Only the current organizer can upload proof for a registered campaign." }); }
    if (type === "application/json") {
      try {
        const doc = JSON.parse(bytes.toString("utf8"));
        if (doc.kind !== `clearfund/${auth.purpose}` || (auth.purpose === "proof" &&
          (doc.campaign?.toLowerCase() !== auth.campaign?.toLowerCase() || doc.milestone !== auth.milestone))) throw new Error();
      } catch { return res.status(400).json({ error: "The document does not match this upload authorization." }); }
    }
    try {
      const ip = String(req.headers?.["x-vercel-forwarded-for"] || req.headers?.["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
      await reserve({ wallet: auth.wallet.toLowerCase(), ip, nonce: auth.nonce, now: now() });
      const form = new FormData();
      form.append("file", new Blob([bytes], { type }), name);
      form.append("pinataOptions", JSON.stringify({ cidVersion: 1 }));
      const response = await pinFetch(`${process.env.PINATA_API_URL || "https://api.pinata.cloud"}/pinning/pinFileToIPFS`, {
        method: "POST", headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body: form,
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw Object.assign(new Error("IPFS pinning failed. Sign again to retry."), { status: 502 });
      const { IpfsHash } = await response.json();
      if (typeof IpfsHash !== "string" || !/^[a-zA-Z0-9]{20,100}$/.test(IpfsHash)) throw new Error("Invalid pinning response");
      return res.status(200).json({ cid: IpfsHash });
    } catch (err) {
      const code = [409, 429, 503, 502].includes(err.status) ? err.status : 502;
      return res.status(code).json({ error: code === 502 ? "IPFS pinning failed. Sign again to retry." : err.message });
    }
  };
}
export default createHandler();
