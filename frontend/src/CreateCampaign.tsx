import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import { FACTORY_ABI, FACTORY_ADDRESS, V2_FACTORY_ADDRESS, readProvider, errorMessage } from "./chain";
import type { Wallet } from "./chain";
import { endOfDay, parseUsd } from "./format";
import { uploadDocument, uploadFile } from "./proof";
import MoneyStrip from "./MoneyStrip";
import type { Part } from "./MoneyStrip";

const blank = (): Draft => ({ title: "", plan: "", share: "", due: "" });

export default function CreateCampaign({ wallet }: { wallet: Wallet }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [organizer, setOrganizer] = useState("");
  const [location, setLocation] = useState("");
  const [story, setStory] = useState("");
  const [cover, setCover] = useState<File | null>(null);
  const [goal, setGoal] = useState("");
  const [minimum, setMinimum] = useState("");
  const [deadline, setDeadline] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([blank(), blank(), blank()]);
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  // "checking" must not flash a warning, and a failed RPC read is not the same as a missing factory.
  const [factory, setFactory] = useState<"checking" | "ready" | "missing" | "unreachable">(V2_FACTORY_ADDRESS ? "checking" : "missing");
  const [attempt, setAttempt] = useState(0);
  const ready = factory === "ready";
  useEffect(() => {
    if (!V2_FACTORY_ADDRESS) return;
    let live = true;
    setFactory("checking");
    new ethers.Contract(V2_FACTORY_ADDRESS, FACTORY_ABI, readProvider).protocolVersion()
      .then(v => { if (live) setFactory(Number(v) === 2 ? "ready" : "missing"); })
      .catch(() => { if (live) setFactory("unreachable"); });
    return () => { live = false; };
  }, [attempt]);

  const goalAmount = parseUsd(goal);
  const update = (i: number, field: keyof Draft, value: string) => setDrafts(drafts.map((d, j) => (j === i ? { ...d, [field]: value } : d)));
  const preview: Part[] = drafts.map((d, i) => ({
    label: d.title || `Milestone ${i + 1}`,
    amount: (goalAmount * BigInt(shareBps(d.share))) / 10_000n,
    weight: shareBps(d.share),
    state: "planned",
  }));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || busy.current) return;
    const problem = problemWith({ title, organizer, story, cover, goal: goalAmount, minimum: parseUsd(minimum), deadline }, drafts);
    if (problem) return toast.error(problem);
    if (!wallet.signer) return wallet.connect();
    if (wallet.wrongNetwork) return wallet.switchToSepolia();

    busy.current = true;
    setSending(true);
    const id = toast.loading("Sign to authorize your story and cover uploads…");
    try {
      const context = { signer: wallet.signer, factory: FACTORY_ADDRESS, purpose: "campaign" as const };
      const coverRef = await uploadFile(cover!, context);
      const { cid, hash } = await uploadDocument({
        kind: "clearfund/campaign",
        title: title.trim(),
        organizer: organizer.trim(),
        location: location.trim(),
        story: story.trim(),
        cover: coverRef,
        milestones: drafts.map((d) => ({ title: d.title.trim(), plan: d.plan.trim() })),
      }, context);

      toast.loading("Confirm in your wallet…", { id });
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet.signer);
      const tx = await factory.createCampaign(
        { metadataCid: cid, metadataHash: hash, goal: goalAmount, minimum: parseUsd(minimum), fundingDeadline: endOfDay(deadline) },
        drafts.map((d) => ({ shareBps: shareBps(d.share), deadline: endOfDay(d.due) }))
      );
      toast.loading("Waiting for Sepolia…", { id });
      const receipt = await tx.wait();
      const created = receipt.logs.map((log: ethers.Log) => factory.interface.parseLog(log)).find((p: ethers.LogDescription | null) => p?.name === "CampaignCreated");
      toast.success("Your campaign is live", { id });
      navigate(created ? `/campaign/${created.args.campaign}` : "/");
    } catch (err) {
      toast.error(errorMessage(err, "The campaign could not be created."), { id });
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <main className="page create">
      <h1>Start a campaign</h1>
      <p className="lede">Donors see your plan before they give. Money reaches you one milestone at a time, after you show the work, and any donor can take back their unspent share at each step.</p>

      {factory === "missing" && <p className="notice notice-warn">Campaign creation is not configured on this deployment. Existing campaigns remain accessible with their original rules.</p>}
      {factory === "unreachable" && <p className="notice notice-warn">Couldn’t reach Sepolia to check the campaign factory. <button type="button" className="link-button" onClick={() => setAttempt(n => n + 1)}>Try again</button></p>}
      <p className="hint">Plan for reimbursement: work must be financed before proof and payment. Donors can leave during funding or review, reducing your budget. Cancel if the remaining funds cannot cover the plan. Each upload needs a wallet signature.</p>
      <form onSubmit={create} noValidate>
        <fieldset>
          <legend>The cause</legend>
          <label>Campaign title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rebuild the Ward 7 community kitchen" /></label>
          <div className="grid-2">
            <label>Organizer<input value={organizer} onChange={(e) => setOrganizer(e.target.value)} placeholder="Your name or organization" /></label>
            <label>Where<input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Chennai, India" /></label>
          </div>
          <label>Story<textarea rows={6} value={story} onChange={(e) => setStory(e.target.value)} placeholder="Who this helps, what the money buys, and how you will show it." /></label>
          <label>
            Cover photo
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setCover(e.target.files?.[0] || null)} />
          </label>
        </fieldset>

        <fieldset>
          <legend>The money</legend>
          <div className="grid-3">
            <label>Goal<span className="input-row"><span className="unit">$</span><input inputMode="decimal" value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="5,000" /></span></label>
            <label>Minimum to begin<span className="input-row"><span className="unit">$</span><input inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="3,000" /></span></label>
            <label>Funding closes<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
          </div>
          <p className="hint">Funding lasts at most 30 days. Donors may withdraw while funding is open. If funding fails, refunds are claimed from the contract.</p>
        </fieldset>

        <fieldset>
          <legend>Milestones</legend>
          <p className="hint">The first payout is at most 25%; each later payout at most 75%. First proof must be due 8–30 days after funding closes; later deadlines must be 5–30 days apart. Review lasts 72 hours, followed by one day to release. Missed deadlines open refunds.</p>
          <ol className="drafts">
            {drafts.map((d, i) => (
              <li key={i}>
                <div className="draft-head">
                  <span className="milestone-n" aria-hidden="true">{i + 1}</span>
                  <input aria-label={`Milestone ${i + 1} title`} value={d.title} onChange={(e) => update(i, "title", e.target.value)} placeholder={["Buy materials", "Build", "Open the doors"][i] || "Milestone"} />
                  {drafts.length > 2 && <button type="button" className="link-button" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>Remove</button>}
                </div>
                <label>What you will show as proof<textarea rows={2} value={d.plan} onChange={(e) => update(i, "plan", e.target.value)} placeholder="Receipts for the roof sheets and photos of them fitted." /></label>
                <div className="grid-2">
                  <label>Share<span className="input-row"><input inputMode="numeric" value={d.share} onChange={(e) => update(i, "share", e.target.value)} placeholder="25" /><span className="unit">%</span></span></label>
                  <label>Proof due<input type="date" value={d.due} onChange={(e) => update(i, "due", e.target.value)} /></label>
                </div>
              </li>
            ))}
          </ol>
          {drafts.length < 4 && <button type="button" className="button" onClick={() => setDrafts([...drafts, blank()])}>Add a milestone</button>}
        </fieldset>

        <section className="payout" aria-label="Payout preview">
          <h2>Where the money goes</h2>
          <MoneyStrip parts={preview} />
          <p className="hint">Each share is paid from what donors still have in when that milestone is released.</p>
        </section>

        <button className="button button-primary" disabled={sending || !ready}>{sending ? "Creating…" : factory === "checking" ? "Checking the factory…" : wallet.wrongNetwork ? "Switch to Sepolia" : wallet.account ? "Create the campaign" : "Connect a wallet to create"}</button>
      </form>
    </main>
  );
}

export interface Draft {
  title: string;
  plan: string;
  share: string;
  due: string;
}

/// Percentages must be positive, finite, and exactly representable in basis points.
export function shareBps(value: string): number {
  const text = value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return 0;
  const bps = Math.round(Number(text) * 100);
  return bps > 0 && bps <= 10_000 ? bps : 0;
}

export function problemWith(
  f: { title: string; organizer: string; story: string; cover: File | null; goal: bigint; minimum: bigint; deadline: string },
  drafts: Draft[],
  now = Date.now() / 1000,
) {
  if (!f.title.trim() || !f.organizer.trim() || !f.story.trim()) return "Give the campaign a title, an organizer and a story.";
  if (!f.cover) return "Add a cover photo so donors can see the cause.";
  if (f.goal <= 0n) return "Set a goal above zero.";
  if (f.minimum <= 0n || f.minimum > f.goal) return "The minimum to begin has to be above zero and no more than the goal.";
  const fundingDeadline = endOfDay(f.deadline);
  if (!Number.isFinite(fundingDeadline) || fundingDeadline <= now) return "Pick a funding deadline in the future.";
  if (fundingDeadline > now + 30 * 86400) return "The funding deadline must be within 30 days.";
  if (drafts.length < 2 || drafts.length > 4) return "Plan between two and four milestones.";
  if (drafts.some((d) => shareBps(d.share) === 0)) return "Each milestone needs a share above 0% and at most 100%, with at most two decimal places.";
  const total = drafts.reduce((sum, d) => sum + shareBps(d.share), 0);
  if (total !== 10_000) return `Milestone shares add up to ${total / 100}%. They need to add up to 100%.`;
  if (shareBps(drafts[0].share) > 2500) return "The first milestone can release at most 25%.";
  if (drafts.some(d => shareBps(d.share) > 7500)) return "Each milestone can release at most 75%.";
  let previous = fundingDeadline;
  for (const [i, d] of drafts.entries()) {
    if (!d.title.trim() || !d.plan.trim()) return `Milestone ${i + 1} needs a title and what you will show as proof.`;
    const due = endOfDay(d.due);
    if (!Number.isFinite(due) || due <= previous) return `Milestone ${i + 1} must be due after the funding deadline and the milestone before it.`;
    const minGap = (i === 0 ? 8 : 5) * 86400;
    if (due < previous + minGap || due > previous + 30 * 86400) return `Milestone ${i + 1} must be due ${i === 0 ? 8 : 5}–30 days after the previous deadline.`;
    if (due > now + 180 * 86400) return "The campaign must finish within 180 days.";
    previous = due;
  }
  return "";
}
