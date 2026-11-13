import type { Signer } from "ethers";
import { uploadMessage } from "./uploadAuth.js";

export interface UploadContext {
  signer: Signer; factory: string; purpose: "campaign" | "proof";
  campaign?: string; milestone?: number;
}

// Campaign stories and milestone proofs are JSON documents on IPFS. The contract stores each
// document's CID to find it and its sha256 to trust it: a gateway can serve the bytes, but it cannot
// change them without the hash showing it. Each document lists its files with their own sha256, so
// one hash on-chain covers every photo and receipt.

export interface FileRef {
  name: string;
  type: string;
  size: number;
  sha256: string;
  cid: string;
}

export interface CampaignDocument {
  kind: "clearfund/campaign";
  title: string;
  organizer: string;
  location: string;
  story: string;
  cover: FileRef;
  milestones: { title: string; plan: string }[];
}

export interface ProofDocument {
  kind: "clearfund/proof";
  campaign: string;
  milestone: number;
  note: string;
  files: FileRef[];
}

export interface Verified<T> {
  doc: T;
  documentOk: boolean;
  files: { name: string; ok: boolean }[];
  ok: boolean;
}

type Fetch = (cid: string) => Promise<Uint8Array>;

// Any gateway will do, because nothing it serves is trusted until it matches the on-chain hash.
// ipfs.io and dweb.link stopped serving files to web pages, so the default is Pinata's.
const GATEWAY = String(import.meta.env?.VITE_IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs/");

export const gatewayUrl = (cid: string) => `${GATEWAY}${cid}`;

export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return `0x${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/// The exact bytes that get pinned and hashed. Hashing the same bytes that were uploaded, rather than
/// re-serialising later, is what makes the on-chain hash checkable.
export const encodeDocument = (doc: object) => new TextEncoder().encode(JSON.stringify(doc));

export const fetchFromGateway: Fetch = async (cid) => {
  const response = await fetch(gatewayUrl(cid), { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`IPFS gateway responded ${response.status}`);
  if (!response.body || Number(response.headers.get("content-length")) > 3 * 1024 * 1024) throw new Error("IPFS file is too large");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new Error("IPFS file is too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
};

function isFileRef(file: unknown): file is FileRef {
  if (!file || typeof file !== "object") return false;
  const f = file as Record<string, unknown>;
  return typeof f.name === "string" && typeof f.type === "string" &&
    typeof f.cid === "string" && f.cid.length > 0 && typeof f.sha256 === "string" &&
    /^0x[0-9a-f]{64}$/i.test(f.sha256) && typeof f.size === "number" && Number.isFinite(f.size) && f.size >= 0;
}

function parseDocument(bytes: Uint8Array): CampaignDocument | ProofDocument {
  if (bytes.length > 64 * 1024) throw new Error("Invalid ClearFund document");
  const doc = JSON.parse(new TextDecoder().decode(bytes));
  if (doc?.kind === "clearfund/campaign" && typeof doc.title === "string" &&
      typeof doc.organizer === "string" && typeof doc.location === "string" &&
      typeof doc.story === "string" && isFileRef(doc.cover) && Array.isArray(doc.milestones) && doc.milestones.length >= 2 && doc.milestones.length <= 4 &&
      doc.milestones.every((m: unknown) => m && typeof m === "object" &&
        typeof (m as Record<string, unknown>).title === "string" && typeof (m as Record<string, unknown>).plan === "string")) return doc;
  if (doc?.kind === "clearfund/proof" && typeof doc.campaign === "string" &&
      Number.isInteger(doc.milestone) && doc.milestone >= 0 && typeof doc.note === "string" &&
      Array.isArray(doc.files) && doc.files.length > 0 && doc.files.length <= 6 && doc.files.every(isFileRef)) return doc;
  throw new Error("Invalid ClearFund document");
}

function filesOf(doc: CampaignDocument | ProofDocument): FileRef[] {
  return doc.kind === "clearfund/campaign" ? [doc.cover] : doc.files;
}

/// Fetches a document by CID, checks it against the hash stored on-chain, then checks every file it
/// lists. A proof must also name the campaign and milestone it was posted for, so an old proof
/// cannot be replayed on another milestone.
export async function verifyDocument<T extends CampaignDocument | ProofDocument>(
  cid: string,
  onchainHash: string,
  expect: Partial<ProofDocument> = {},
  fetchBytes: Fetch = fetchFromGateway
): Promise<Verified<T>> {
  const bytes = await fetchBytes(cid);
  const doc = parseDocument(bytes) as T;
  const matchesContext = Object.entries(expect).every(
    ([key, value]) => String((doc as unknown as Record<string, unknown>)[key]).toLowerCase() === String(value).toLowerCase()
  );
  const correctKind = Object.keys(expect).length === 0 || doc.kind === "clearfund/proof";
  const documentOk = (await sha256(bytes)) === onchainHash.toLowerCase() && matchesContext && correctKind;

  const files = await Promise.all(
    filesOf(doc).map(async (file) => {
      try {
        return { name: file.name, ok: (await sha256(await fetchBytes(file.cid))) === file.sha256.toLowerCase() };
      } catch {
        return { name: file.name, ok: false };
      }
    })
  );
  return { doc, documentOk, files, ok: documentOk && files.every((f) => f.ok) };
}

// ------------------------------------------------------------------ uploads (browser)

const MAX_SIDE = 1600;

/// Photos are re-encoded at a sane size before hashing, so what donors see is exactly what was hashed
/// and uploads stay under the server's body limit.
export async function prepareFile(file: File): Promise<{ name: string; type: string; bytes: Uint8Array }> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") {
    return { name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return { name: file.name.replace(/\.\w+$/, ".jpg"), type: "image/jpeg", bytes: new Uint8Array(await blob.arrayBuffer()) };
}

async function pin(name: string, type: string, bytes: Uint8Array, context: UploadContext): Promise<string> {
  if (bytes.length > 3 * 1024 * 1024) throw new Error("Files must be at most 3 MB. Choose a smaller file.");
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  const auth = { host: window.location.host.toLowerCase(), wallet: await context.signer.getAddress(),
    factory: context.factory, purpose: context.purpose, campaign: context.campaign, milestone: context.milestone,
    hash: await sha256(bytes), type, name, issued: Date.now(),
    nonce: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, "0")).join("") };
  const signature = await context.signer.signMessage(uploadMessage(auth));
  const response = await fetch("/api/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, type, data: btoa(binary), auth, signature }),
    signal: AbortSignal.timeout(45_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The upload failed.");
  return result.cid;
}

export async function uploadFile(file: File, context: UploadContext): Promise<FileRef> {
  const prepared = await prepareFile(file);
  const cid = await pin(prepared.name, prepared.type, prepared.bytes, context);
  return { name: prepared.name, type: prepared.type, size: prepared.bytes.length, sha256: await sha256(prepared.bytes), cid };
}

/// Pins a document and returns what the contract stores for it.
export async function uploadDocument(doc: CampaignDocument | ProofDocument, context: UploadContext): Promise<{ cid: string; hash: string }> {
  const bytes = encodeDocument(doc);
  const cid = await pin(`${doc.kind.replace("/", "-")}.json`, "application/json", bytes, context);
  return { cid, hash: await sha256(bytes) };
}
