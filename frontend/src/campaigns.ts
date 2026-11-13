import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import { CAMPAIGN_ABI, FACTORY_ABI, FACTORY_REGISTRIES, USDC_ABI, USDC_ADDRESS, campaignInterface, errorMessage, eventSources, readProvider } from "./chain";
import type { Wallet } from "./chain";
import { shortAddress, usd } from "./format";
import { verifyDocument } from "./proof";
import type { CampaignDocument } from "./proof";

export const Status = { Funding: 0, Active: 1, Completed: 2, Cancelled: 3 } as const;
export const Step = { Pending: 0, InReview: 1, Released: 2 } as const;
export const BPS = 10_000n;

export interface Milestone {
  index: number;
  shareBps: number;
  deadline: number;
  reviewEndsAt: number;
  step: number;
  proofCid: string;
  proofHash: string;
}

export interface Campaign {
  address: string;
  version: number;
  factory: string;
  creator: string;
  metadataCid: string;
  metadataHash: string;
  goal: bigint;
  minimum: bigint;
  fundingDeadline: number;
  status: number;
  current: number;
  raised: bigint;
  activeRaised: bigint;
  releasedBps: bigint;
  creatorOwed: bigint;
  held: bigint;
  stalled: boolean;
  exitOpen: boolean;
  milestones: Milestone[];
  doc: CampaignDocument | null;
  /** The story document matches its on-chain hash. */
  docOk: boolean;
  /** The cover photo was fetched and matches the hash the story lists for it. */
  coverOk: boolean;
}

export interface Viewer {
  contribution: bigint;
  claim: bigint;
  exited: boolean;
  balance: bigint;
}

export interface Ledger {
  released: Record<number, bigint>;
  returned: bigint;
  activity: { hash: string; block: number; index: number; timestamp: number; text: string }[];
}

const campaignAt = (address: string) => new ethers.Contract(address, CAMPAIGN_ABI, readProvider);
const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, readProvider);

/// Immutable, verified stories need not be fetched again on every balance refresh.
const stories = new Map<string, Promise<{ doc: CampaignDocument | null; docOk: boolean; coverOk: boolean }>>();
async function loadStory(cid: string, hash: string) {
  const key = `${cid}:${hash.toLowerCase()}`;
  if (!stories.has(key)) {
    const story = (async () => {
      try {
        const { doc, documentOk: docOk, files } = await verifyDocument<CampaignDocument>(cid, hash);
        if (doc.kind !== "clearfund/campaign") throw new Error("Invalid campaign story");
        // A slow gateway for the cover photo is not tampering, so it is reported separately.
        const coverOk = files.every(f => f.ok);
        if (!docOk || !coverOk) stories.delete(key);
        return { doc, docOk, coverOk };
      } catch {
        stories.delete(key);
        return { doc: null, docOk: false, coverOk: false };
      }
    })();
    stories.set(key, story);
  }
  return stories.get(key)!;
}

const registrations = new Map<string, typeof FACTORY_REGISTRIES[number]>();
export async function assertRegisteredCampaign(address: string) {
  if (!ethers.isAddress(address)) throw new Error("Invalid campaign address");
  const key = address.toLowerCase();
  if (!registrations.has(key)) {
    const registry = await authenticateCampaign(address, FACTORY_REGISTRIES,
      async (r, a) => new ethers.Contract(r.address, FACTORY_ABI, readProvider).isCampaign(a));
    registrations.set(key, registry);
  }
  return registrations.get(key)!;
}

async function readCampaign(address: string): Promise<Campaign> {
  const registry = await assertRegisteredCampaign(address);
  const c = campaignAt(address);
  const [creator, metadataCid, metadataHash, goal, minimum, fundingDeadline, status, current, raised, activeRaised, releasedBps, creatorOwed, stalled, exitOpen, rows, held] =
    await Promise.all([
      c.creator(), c.metadataCid(), c.metadataHash(), c.goal(), c.minimum(), c.fundingDeadline(), c.status(), c.current(),
      c.raised(), c.activeRaised(), c.releasedBps(), c.creatorOwed(), c.isStalled(), c.canExit(), c.getMilestones(),
      usdc.balanceOf(address),
    ]);
  const story = await loadStory(metadataCid, metadataHash);
  return {
    address, version: registry.version, factory: registry.address, creator, metadataCid, metadataHash, goal, minimum, raised, activeRaised, releasedBps, creatorOwed, held, stalled, exitOpen,
    fundingDeadline: Number(fundingDeadline),
    status: Number(status),
    current: Number(current),
    milestones: rows.map((m: ethers.Result, index: number) => ({
      index,
      shareBps: Number(m.shareBps),
      deadline: Number(m.deadline),
      reviewEndsAt: Number(m.reviewEndsAt),
      step: Number(m.step),
      proofCid: m.proofCid,
      proofHash: m.proofHash,
    })),
    ...story,
  };
}

export function useCampaigns() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const loadRef = useRef<() => Promise<void>>(async () => {});
  const loadMore = useCallback(() => loadRef.current(), []);

  useEffect(() => {
    let live = true;
    let busy = false;
    let retryCount = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retryAddresses: string[] = [];
    const cursors = FACTORY_REGISTRIES.map(r => ({ ...r, next: -1, done: false, pending: [] as string[] }));
    const order = new Map<string, number>();
    const load = async () => {
      if (busy || !live) return;
      clearTimeout(timer);
      busy = true; setLoading(true); setError("");
      let skipEmptyRegistry = false;
      let retry = false;
      try {
        let addresses = retryAddresses;
        retryAddresses = [];
        if (!addresses.length) {
          const registry = cursors.find(r => !r.done);
          if (!registry) return;
          const factory = new ethers.Contract(registry.address, FACTORY_ABI, readProvider);
          if (registry.version === 2) {
            const end = registry.next < 0 ? Number(await factory.campaignCount()) : registry.next;
            const offset = Math.max(0, end - 12);
            addresses = [...await factory.campaignsPage(offset, end - offset || 1)].reverse();
            registry.next = offset; registry.done = offset === 0;
            skipEmptyRegistry = addresses.length === 0 && registry.done;
          } else if (registry.pending.length) {
            addresses = registry.pending.splice(0, 12);
            registry.done = registry.next < registry.block && registry.pending.length === 0;
          } else {
            // Bound each page to 50,000 blocks and only commit its cursor on success.
            const next = registry.next < 0 ? await readEventHead(eventSources) : registry.next;
            const page = await scanLegacyPage({ next, block: registry.block }, async (fromBlock, toBlock) => {
              const logs = await readEventLogs(eventSources, { address: registry.address,
                topics: [factory.interface.getEvent("CampaignCreated")!.topicHash], fromBlock, toBlock });
              return logs.reverse().map(log => String(factory.interface.parseLog(log)!.args.campaign));
            });
            addresses = page.addresses;
            Object.assign(registry, { next: page.next, pending: page.pending, done: page.done });
          }
        }
        for (const address of addresses) if (!order.has(address.toLowerCase())) order.set(address.toLowerCase(), order.size);
        const failures = await mapLimited(addresses, 3, async address => {
          try { return await readCampaign(address); }
          catch (error) { retryAddresses.push(address); throw error; }
        }, c => {
          if (live) setCampaigns(old => old.some(row => row.address.toLowerCase() === c.address.toLowerCase()) ? old : [...old, c].sort((a, b) => order.get(a.address.toLowerCase())! - order.get(b.address.toLowerCase())!));
        });
        if (failures) {
          retry = true;
          if (live) setError("Some campaigns couldn’t be loaded. Your other campaigns are still available. Please try again.");
        } else retryCount = 0;
      } catch {
        retry = true;
        // RPC payloads can include URLs, request details and internal errors; never render them.
        if (live) setError(CAMPAIGN_CONNECTION_ERROR);
      } finally {
        busy = false;
        if (live) {
          setLoading(false); setHasMore(cursors.some(r => !r.done) || retryAddresses.length > 0);
          if (retry && retryCount < 3) {
            timer = setTimeout(() => void load(), 2_000 * 2 ** retryCount++);
          } else if (skipEmptyRegistry && cursors.some(r => !r.done)) void load();
        }
      }
    };
    loadRef.current = load;
    if (cursors.length) void load();
    else {
      setLoading(false); setHasMore(false);
      setError("Campaigns are not configured on this deployment.");
    }
    return () => { live = false; clearTimeout(timer); };
  }, []);
  return { campaigns, error, loading, hasMore, loadMore };
}

export function useCampaign(address: string, account: string | null) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [viewer, setViewer] = useState<Viewer>({ contribution: 0n, claim: 0n, exited: false, balance: 0n });
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [error, setError] = useState("");

  const generation = useRef(0);
  const refresh = useRef<() => Promise<void>>(async () => {});
  const load = useCallback(() => refresh.current(), []);

  useEffect(() => {
    const version = ++generation.current;
    let busy = false;
    const current = () => generation.current === version;
    const emptyViewer = { contribution: 0n, claim: 0n, exited: false, balance: 0n };
    setCampaign(null);
    setLedger(null);
    setViewer(emptyViewer);
    setError("");

    const update = async () => {
      if (busy || !current()) return;
      busy = true;
      try {
        if (!ethers.isAddress(address)) throw new Error("Invalid campaign address");
        const next = await readCampaign(address);
        if (!current()) return;
        setCampaign(next);
        setError("");
        if (account) {
          const c = campaignAt(address);
          const [contribution, claim, exited, balance] = await Promise.all([
            c.contributionOf(account), c.claimOf(account), c.exited(account), usdc.balanceOf(account),
          ]);
          if (!current()) return;
          setViewer({ contribution, claim, exited, balance });
        }
        // A failed read keeps the last successful record and is retried on the next refresh.
        try {
          const nextLedger = await loadLedger(address, next);
          if (current()) setLedger(nextLedger);
        } catch { /* Reading failed, rather than proving the record is empty. */ }
      } catch {
        if (current()) setError("This campaign could not be loaded. Check the address, or refresh to try again.");
      } finally {
        busy = false;
      }
    };
    refresh.current = update;
    void update();
    const timer = window.setInterval(update, 20_000);
    return () => {
      generation.current++;
      window.clearInterval(timer);
    };
  }, [address, account]);

  return { campaign, viewer, ledger, error, reload: load };
}

function titleOf(campaign: Campaign, index: unknown) {
  return campaign.doc?.milestones[Number(index)]?.title || `milestone ${Number(index) + 1}`;
}

function describe(log: ethers.LogDescription, campaign: Campaign) {
  const a = log.args;
  switch (log.name) {
    case "Donated":
      return `${shortAddress(a.donor)} gave ${usd(a.amount)}`;
    case "Started":
      return "Funding closed and the work began";
    case "ProofSubmitted":
      return `Proof posted for ${titleOf(campaign, a.milestone)}; donors have 72 hours to review it`;
    case "Exited":
      return `${shortAddress(a.donor)} took back ${usd(a.amount)} they had not yet spent`;
    case "Released":
      return `${usd(a.amount)} released for ${titleOf(campaign, a.milestone)}`;
    case "Withdrawn":
      return `The organizer withdrew ${usd(a.amount)}`;
    case "Cancelled":
      return "Campaign cancelled; every donor can take back what is left";
    default:
      return log.name;
  }
}

const LOG_CHUNK = 10_000;
/// Events already read for each campaign, so a refresh only asks for the blocks it has not seen.
const seen = new Map<string, { logs: ethers.Log[]; upTo: number }>();

/// Reads a campaign's events. The first read walks back from the newest block and stops at the block
/// where the factory created the campaign, so the cost depends on the campaign's age and not on how
/// long the factory has existed. Later reads fetch only what is new.
async function campaignLogs(address: string) {
  const latest = await readEventHead(eventSources);
  const cached = seen.get(address);
  if (cached) {
    for (let from = cached.upTo + 1; from <= latest; from += LOG_CHUNK) {
      const to = Math.min(from + LOG_CHUNK - 1, latest);
      cached.logs.push(...(await readEventLogs(eventSources, { address, fromBlock: from, toBlock: to })));
      cached.upTo = to;
    }
    return cached.logs;
  }

  const registry = await assertRegisteredCampaign(address);
  const floor = registry.block;
  const birth = new ethers.Interface(FACTORY_ABI).encodeFilterTopics("CampaignCreated", [address]);
  const logs: ethers.Log[] = [];
  for (let to = latest; to >= floor; to -= LOG_CHUNK) {
    const range = { fromBlock: Math.max(to - LOG_CHUNK + 1, floor), toBlock: to };
    const [own, created] = await Promise.all([
      readEventLogs(eventSources, { address, ...range }),
      readEventLogs(eventSources, { address: registry.address, topics: birth, ...range }),
    ]);
    logs.unshift(...own);
    if (created.length > 0) {
      seen.set(address, { logs, upTo: latest });
      return logs;
    }
  }
  throw new Error("Campaign creation record could not be read");

}

async function loadLedger(address: string, campaign: Campaign): Promise<Ledger> {
  const logs = await campaignLogs(address);

  const released: Record<number, bigint> = {};
  let returned = 0n;
  const rows = new Map<string, { block: number; index: number; text: string }>();
  for (const log of logs) {
    const parsed = campaignInterface.parseLog(log);
    if (!parsed) continue;
    if (parsed.name === "Released") released[Number(parsed.args.milestone)] = parsed.args.amount;
    if (parsed.name === "Exited") returned += parsed.args.amount;
    if (!rows.has(log.transactionHash)) rows.set(log.transactionHash, { block: log.blockNumber, index: log.index, text: describe(parsed, campaign) });
  }

  const blocks = [...new Set([...rows.values()].map((row) => row.block))];
  const times = new Map(await Promise.all(blocks.map(async (b) => [b, (await readProvider.getBlock(b))?.timestamp || 0] as const)));
  const activity = [...rows.entries()]
    .map(([hash, row]) => ({ hash, block: row.block, index: row.index, timestamp: times.get(row.block) || 0, text: row.text }))
    .sort((a, b) => b.block - a.block || b.index - a.index);
  return { released, returned, activity };
}

/// What a milestone is worth to the creator right now: its share of the money donors still have in.
export function milestoneAmount(campaign: Campaign, m: Milestone, ledger: Ledger | null) {
  if (m.step === Step.Released) return ledger?.released[m.index] ?? 0n;
  const base = campaign.status === Status.Funding ? campaign.goal : campaign.activeRaised;
  return (base * BigInt(m.shareBps)) / BPS;
}

/// The chain's clock, which is what the contract judges every deadline by.
export function useChainTime() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const tick = () => readProvider.getBlock("latest").then((block) => block && setNow(block.timestamp)).catch(() => {});
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export interface EventRange {
  address: string;
  topics?: Array<string | string[] | null>;
  fromBlock: number;
  toBlock: number;
}

export interface EventSource<Log> {
  getBlock(tag: "latest"): Promise<{ number: number } | null>;
  getLogs(range: EventRange): Promise<Log[]>;
}

function temporary(error: unknown): boolean {
  if (error instanceof AggregateError) return error.errors.some(temporary);
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; error?: unknown; info?: { error?: unknown } };
  return ["NETWORK_ERROR", "SERVER_ERROR", "TIMEOUT"].includes(String(e.code)) ||
    /head block|beyond.*head|block.*not found|timeout|temporar|rate.?limit|too many requests|network|fetch failed|\b(429|502|503)\b/i.test(String(e.message || "")) ||
    temporary(e.error) || temporary(e.info?.error);
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Race configured nodes for a successful read; a lagging node's error is not a successful quorum.
 * Retry the exact same range, never clip it and then mark omitted blocks as scanned. */
async function eventRead<T, Log>(
  sources: readonly EventSource<Log>[], read: (source: EventSource<Log>) => Promise<T>,
  wait: (ms: number) => Promise<void>,
): Promise<T> {
  for (const delay of [0, 300, 900]) {
    if (delay) await wait(delay);
    try { return await Promise.any(sources.map(source => Promise.resolve().then(() => read(source)))); }
    catch (error) {
      if (delay === 900 || !temporary(error)) throw error;
    }
  }
  throw new Error("Event read failed");
}

/** A real block header, rather than FallbackProvider's aggregated, non-decreasing height. */
export function readEventHead<Log>(sources: readonly EventSource<Log>[], wait = pause) {
  return eventRead(sources, async source => {
    const block = await source.getBlock("latest");
    if (!block || !Number.isSafeInteger(block.number) || block.number < 0) throw new Error("Latest block temporarily unavailable");
    return block.number;
  }, wait);
}

export function readEventLogs<Log>(sources: readonly EventSource<Log>[], range: EventRange, wait = pause) {
  return eventRead(sources, source => source.getLogs(range), wait);
}

export const CAMPAIGN_CONNECTION_ERROR = "We couldn’t load the campaigns from Sepolia. Please try again.";

// A campaign-shaped contract is not enough: a configured factory must attest to it.
export async function authenticateCampaign<T extends { address: string }>(
  address: string, registries: T[], check: (registry: T, address: string) => Promise<boolean>,
): Promise<T> {
  let unavailable = false;
  for (const registry of registries) {
    try { if (await check(registry, address)) return registry; }
    catch { unavailable = true; }
  }
  throw new Error(unavailable ? "Campaign verification is temporarily unavailable. Try again." : "This address is not a registered ClearFund campaign.");
}

export async function mapLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>, onResult: (result: R) => void) {
  let cursor = 0;
  let failures = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      try { onResult(await work(item)); } catch { failures++; }
    }
  }));
  return failures;
}

/** A page is committed only after every range succeeds. A failed later chunk must not discard
 * campaigns already found in an earlier chunk or advance the caller's cursor past them. */
export async function scanLegacyPage(
  cursor: { next: number; block: number },
  query: (fromBlock: number, toBlock: number) => Promise<string[]>,
) {
  let next = cursor.next;
  const addresses: string[] = [];
  for (let chunk = 0; chunk < 5 && next >= cursor.block; chunk++) {
    const from = Math.max(cursor.block, next - 10_000 + 1);
    addresses.push(...await query(from, next));
    next = from - 1;
    if (addresses.length >= 12) break;
  }
  const pending = addresses.splice(12);
  return { addresses, next, pending, done: next < cursor.block && pending.length === 0 };
}

/// Sends one contract call with toasts, and tracks which action is pending so its button can say so.
export function useTx(wallet: Wallet, address: string, onDone: () => void) {
  const [pending, setPending] = useState("");
  const busy = useRef(false);

  async function send(action: string, call: (c: ethers.Contract) => Promise<ethers.TransactionResponse>, done: string) {
    if (!wallet.signer) {
      wallet.connect();
      return false;
    }
    if (wallet.wrongNetwork) {
      wallet.switchToSepolia();
      return false;
    }

    if (busy.current) return false;
    busy.current = true;
    setPending(action);
    const id = toast.loading("Confirm in your wallet…");
    try {
      if ((await wallet.signer.getAddress()).toLowerCase() !== wallet.account?.toLowerCase()) throw new Error("Wallet account changed. Try again.");
      await assertRegisteredCampaign(address);
      const tx = await call(new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer));
      toast.loading("Waiting for Sepolia…", { id });
      await tx.wait();
      toast.success(done, { id });
      onDone();
      return true;
    } catch (err) {
      toast.error(errorMessage(err), { id });
      return false;
    } finally {
      busy.current = false;
      setPending("");
    }
  }

  return { send, pending, setPending, wallet };
}

export type Tx = ReturnType<typeof useTx>;
