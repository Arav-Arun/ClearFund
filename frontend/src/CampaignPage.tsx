import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ethers } from "ethers";
import { toast } from "react-hot-toast";
import { EXPLORER, USDC_ABI, USDC_ADDRESS, errorMessage, signPermit } from "./chain";
import type { Wallet } from "./chain";
import { date, dateTime, parseUsd, reviewCalendar, shortAddress, shortHash, timeLeft, usd } from "./format";
import { assertRegisteredCampaign, BPS, Status, Step, milestoneAmount, useCampaign, useChainTime, useTx } from "./campaigns";
import type { Campaign, Ledger, Milestone, Tx, Viewer } from "./campaigns";
import { gatewayUrl, uploadDocument, uploadFile, verifyDocument } from "./proof";
import type { ProofDocument, Verified } from "./proof";
import MoneyStrip, { campaignParts } from "./MoneyStrip";

const STATUS_TEXT = ["Raising funds", "Work in progress", "Completed", "Cancelled"];

export default function CampaignPage({ wallet }: { wallet: Wallet }) {
  const { address = "" } = useParams();
  const { campaign, viewer, ledger, error, reload } = useCampaign(address, wallet.account);
  const tx = useTx(wallet, address, reload);
  const now = useChainTime();

  if (error && !campaign) return <main className="page"><p className="notice notice-warn">{error}</p></main>;
  if (!campaign) return <main className="page"><p className="muted">Reading the campaign from Sepolia…</p></main>;

  const doc = campaign.doc;
  const isCreator = wallet.account?.toLowerCase() === campaign.creator.toLowerCase();
  const progress = campaign.goal > 0n ? Math.min(100, Number((campaign.raised * 100n) / campaign.goal)) : 0;

  return (
    <main className="page campaign">
      <Link to="/#campaigns" className="back">All campaigns</Link>
      {error && <p className="notice notice-warn">Could not refresh the campaign. Showing the last successful read; retrying shortly.</p>}

      <header className="campaign-head">
        {doc && <img className="campaign-cover" src={gatewayUrl(doc.cover.cid)} alt="" />}
        <div className="campaign-intro">
          <span className={`chip chip-${campaign.status}`}>{STATUS_TEXT[campaign.status]}</span>
          <h1>{doc?.title || "Untitled campaign"}</h1>
          <p className="campaign-by">
            {doc?.organizer}{doc?.location && <span className="muted">, {doc.location}</span>}
          </p>
          <div className="raised">
            <span className="figure figure-big">{usd(campaign.raised, 0)}</span>
            <span className="muted">raised of {usd(campaign.goal, 0)}</span>
          </div>
          <span className="meter" aria-hidden="true"><span style={{ width: `${progress}%` }} /></span>
          {!doc && <p className="notice notice-warn">The campaign story could not be fetched from IPFS. The on-chain balances and deadlines are shown below; retrying shortly.</p>}
          {doc && !campaign.docOk && <p className="notice notice-warn">This campaign's story does not match the hash it was created with. Read it with caution.</p>}
          {doc && campaign.docOk && !campaign.coverOk && <p className="notice notice-warn">The cover photo could not be checked against its hash yet. The IPFS gateway may be slow; retrying shortly.</p>}
        </div>
      </header>

      {campaign.version === 1 && <p className="notice">This campaign uses its original immutable rules. Funding-stage withdrawals and the newer payout and scheduling safeguards do not apply to this escrow.</p>}
      <p className="hint">Payments use a 72-hour opt-out review. Silence permits release even if proof is unavailable or misleading. Hashes verify the committed files, not whether the work is real. The creator wallet cannot donate; another wallet is not proof of an independent supporter.</p>
      <MoneyStrip parts={campaignParts(campaign, ledger)} />

      <div className="campaign-body">
        <div className="campaign-main">
          {doc?.story && (
            <section className="story">
              <h2>The cause</h2>
              {doc.story.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
            </section>
          )}

          <section className="milestones" aria-labelledby="milestones-title">
            <h2 id="milestones-title">How the money is spent</h2>
            <ol>
              {campaign.milestones.map((m) => (
                <MilestoneItem key={m.index} campaign={campaign} milestone={m} ledger={ledger} viewer={viewer} isCreator={isCreator} now={now} tx={tx} />
              ))}
            </ol>
          </section>

          <Activity ledger={ledger} />
        </div>

        <aside className="panel">
          <MoneyPanel campaign={campaign} viewer={viewer} wallet={wallet} isCreator={isCreator} now={now} tx={tx} />
        </aside>
      </div>
    </main>
  );
}

function MilestoneItem(props: { campaign: Campaign; milestone: Milestone; ledger: Ledger | null; viewer: Viewer; isCreator: boolean; now: number; tx: Tx }) {
  const { campaign, milestone: m, ledger, viewer, isCreator, now, tx } = props;
  const plan = campaign.doc?.milestones[m.index];
  const isCurrent = campaign.status === Status.Active && campaign.current === m.index;
  const open = isCurrent && m.step === Step.InReview && now <= m.reviewEndsAt;
  const state = m.step === Step.Released ? "released" : isCurrent && m.step === Step.InReview ? "review" : isCurrent ? "current" : "waiting";
  const label = campaign.status === Status.Cancelled && m.step !== Step.Released ? "Cancelled" : { released: "Released", review: open ? "Donors reviewing" : "Ready to release", current: "In progress", waiting: "Not started" }[state];

  return (
    <li className={`milestone milestone-${state}`}>
      <div className="milestone-head">
        <span className="milestone-n" aria-hidden="true">{m.index + 1}</span>
        <h3>{plan?.title || `Milestone ${m.index + 1}`}</h3>
        <span className="figure">{usd(milestoneAmount(campaign, m, ledger), 0)}</span>
        <span className={`tag tag-${state}`}>{label}</span>
      </div>
      {plan?.plan && <p className="milestone-plan">{plan.plan}</p>}
      <p className="hint">{Number(m.shareBps) / 100}% of the money, proof due {date(m.deadline)}</p>

      {m.proofCid && <ProofView campaign={campaign.address} index={m.index} cid={m.proofCid} hash={m.proofHash} />}

      {isCurrent && m.step === Step.InReview && (
        <div className="review">
          <p>
            {open
              ? `Review window: ${timeLeft(m.reviewEndsAt - now)}. If you are not convinced, you can take back your unspent share before it closes.`
              : "The review window has closed. Anyone can now release this milestone."}
          </p>
          {open && viewer.claim > 0n && (
            <button className="button button-quiet" disabled={!!tx.pending} onClick={() => tx.send("exit", (c) => c.exit(), "Your unspent share is back in your wallet")}>
              {tx.pending === "exit" ? "Withdrawing…" : `Walk away with ${usd(viewer.claim)}`}
            </button>
          )}
          {open && <a className="button" download={`clearfund-review-${m.index + 1}.ics`}
            href={`data:text/calendar;charset=utf-8,${encodeURIComponent(reviewCalendar(campaign.address, m.index, m.reviewEndsAt, window.location.href))}`}>Add review reminders to calendar</a>}
          {!open && !campaign.stalled && (
            <button className="button button-primary" disabled={!!tx.pending} onClick={() => tx.send("release", (c) => c.release(), "Milestone released")}>
              {tx.pending === "release" ? "Releasing…" : "Release this milestone"}
            </button>
          )}
        </div>
      )}

      {isCurrent && isCreator && m.step === Step.Pending && now <= m.deadline && (
        <ProofForm campaign={campaign.address} index={m.index} factory={campaign.factory} tx={tx} />
      )}
    </li>
  );
}

function MoneyPanel(props: { campaign: Campaign; viewer: Viewer; wallet: Wallet; isCreator: boolean; now: number; tx: Tx }) {
  const { campaign, viewer, wallet, isCreator, now, tx } = props;
  const [amount, setAmount] = useState("");
  const [consent, setConsent] = useState(false);
  const donating = useRef(false);
  const funding = campaign.status === Status.Funding && now <= campaign.fundingDeadline;
  const remaining = campaign.goal - campaign.raised;

  async function donate(e: React.FormEvent) {
    e.preventDefault();
    const value = parseUsd(amount);
    if (!consent) return toast.error("Read and accept the 72-hour review rule.");
    if (value <= 0n) return toast.error("Enter an amount.");
    if (!wallet.signer) return wallet.connect();
    if (wallet.wrongNetwork) return wallet.switchToSepolia();

    if (donating.current) return;
    if (value > remaining) return toast.error("Give only what is left to reach the goal.");
    if (value > viewer.balance) return toast.error("Your wallet does not have enough USDC.");
    donating.current = true;
    tx.setPending("donate");
    try {
      await assertRegisteredCampaign(campaign.address);
      let permit: Awaited<ReturnType<typeof signPermit>> | null = null;
      try {
        permit = await signPermit(wallet.signer, campaign.address, value);
      } catch (err) {
        if ((err as { code?: string }).code === "ACTION_REJECTED") {
          toast.error("You cancelled in your wallet.");
          return;
        }
      }
      if (permit) {
        const p = permit;
        if (await tx.send("donate", (c) => c.donateWithPermit(value, p.deadline, p.v, p.r, p.s), `Thank you. ${usd(value)} is held in escrow.`)) setAmount("");
      } else {
        // Wallets that cannot sign permits fall back to an exact approval, then donate.
        const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, wallet.signer);
        await (await usdc.approve(campaign.address, value)).wait();
        if (await tx.send("donate", (c) => c.donate(value), `Thank you. ${usd(value)} is held in escrow.`)) setAmount("");
      }
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      donating.current = false;
      tx.setPending("");
    }
  }

  const spentShare = Number(campaign.releasedBps) / Number(BPS);
  return (
    <>
      {funding && !isCreator && remaining > 0n && (
        <form className="give" onSubmit={donate}>
          <h2>Give in USDC</h2>
          <div className="input-row">
            <span className="unit">$</span>
            <input inputMode="decimal" aria-label="Amount in USDC" placeholder="25" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <label className="review-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> I understand that I must review each proof within 72 hours. If I do nothing, that payment can be released.</label>
          <button className="button button-primary" disabled={!!tx.pending || !consent}>
            {tx.pending === "donate" ? "Giving…" : wallet.wrongNetwork ? "Switch to Sepolia" : wallet.account ? "Give" : "Connect a wallet to give"}
          </button>
          <p className="hint">
            Your money is held in escrow, not sent to the organizer. Funding closes {date(campaign.fundingDeadline)}, and if it does not reach {usd(campaign.minimum, 0)} you get everything back.
          </p>
          {wallet.account && <p className="hint">Wallet balance: {usd(viewer.balance)}. Test USDC is free at faucet.circle.com.</p>}
        </form>
      )}

      {viewer.contribution > 0n && (
        <section className="yours">
          <h2>Your money</h2>
          <dl className="ledger">
            <div><dt>You gave</dt><dd className="figure">{usd(viewer.contribution)}</dd></div>
            <div><dt>Spent on the cause</dt><dd className="figure">{viewer.exited ? "—" : usd((viewer.contribution * campaign.releasedBps) / BPS)}</dd></div>
            <div><dt>Still yours</dt><dd className="figure">{usd(viewer.claim)}</dd></div>
          </dl>
          {viewer.exited && <p className="hint">You walked away and took back your unspent share.</p>}
          {campaign.exitOpen && viewer.claim > 0n && (
            <button className="button button-primary" disabled={!!tx.pending} onClick={() => tx.send("exit", (c) => c.exit(), "Your money is back in your wallet")}>
              {tx.pending === "exit" ? "Withdrawing…" : `Take back ${usd(viewer.claim)}`}
            </button>
          )}
        </section>
      )}

      {isCreator && (
        <div className="organizer">
          <h2>Organizer</h2>
          {campaign.status === Status.Funding && (
            <>
              <button className="button button-primary" disabled={campaign.raised < campaign.minimum || campaign.stalled || !!tx.pending || now + (campaign.version === 2 ? 86400 : 0) > campaign.milestones[0].deadline} onClick={() => tx.send("start", (c) => c.start(), "Funding closed. Post proof for the first milestone when it is done.")}>
                {tx.pending === "start" ? "Starting…" : "Close funding and begin"}
              </button>
              <p className="hint">{campaign.raised < campaign.minimum ? `Starting needs ${usd(campaign.minimum, 0)}.` : "Donations close when you begin."}</p>
            </>
          )}
          {campaign.creatorOwed > 0n && (
            <button className="button button-primary" disabled={!!tx.pending} onClick={() => tx.send("withdraw", (c) => c.withdraw(), "Withdrawn to your wallet")}>
              {tx.pending === "withdraw" ? "Withdrawing…" : `Withdraw ${usd(campaign.creatorOwed)}`}
            </button>
          )}
          {(campaign.status === Status.Funding || campaign.status === Status.Active) && (
            <button className="button button-danger" disabled={!!tx.pending} onClick={() => tx.send("cancel", (c) => c.cancel(), "Campaign cancelled. Donors can take back what is left.")}>
              Cancel and refund donors
            </button>
          )}
        </div>
      )}

      {campaign.stalled && !isCreator && (
        <div className="organizer">
          <p className="hint">This campaign missed a deadline. Anyone can cancel it so every donor can take back what is left.</p>
          <button className="button button-danger" disabled={!!tx.pending} onClick={() => tx.send("cancel", (c) => c.cancel(), "Campaign cancelled")}>Cancel the stalled campaign</button>
        </div>
      )}

      <p className="hint">Refunds require a wallet transaction and gas. USDC issuer restrictions can prevent transfers. Future stage budgets shrink when donors leave.</p>
      <dl className="facts">
        <div><dt>Held in escrow</dt><dd className="figure">{usd(campaign.held)}</dd></div>
        <div><dt>Current exit policy</dt><dd>{campaign.exitOpen ? "Unspent funds can be claimed now" : campaign.status === Status.Completed ? "Completed" : `Next work deadline: ${dateTime(campaign.milestones[campaign.current]?.deadline || campaign.fundingDeadline)}`}</dd></div>
        {campaign.version === 2 && campaign.status === Status.Active && <div><dt>Refunds open if this stage stalls</dt><dd>{dateTime(campaign.milestones[campaign.current].step === Step.InReview ? campaign.milestones[campaign.current].reviewEndsAt + 86401 : campaign.milestones[campaign.current].deadline + 1)}</dd></div>}
        <div><dt>Spent so far</dt><dd className="figure">{Math.round(spentShare * 100)}%</dd></div>
        <div><dt>Organizer</dt><dd><a href={`${EXPLORER}/address/${campaign.creator}`} target="_blank" rel="noreferrer"><code>{shortAddress(campaign.creator)}</code></a></dd></div>
        <div><dt>Escrow</dt><dd><a href={`${EXPLORER}/address/${campaign.address}`} target="_blank" rel="noreferrer"><code>{shortAddress(campaign.address)}</code></a></dd></div>
      </dl>
    </>
  );
}

function Activity({ ledger }: { ledger: Ledger | null }) {
  return (
    <section className="activity" aria-labelledby="activity-title">
      <h2 id="activity-title">On-chain record</h2>
      {!ledger && <p className="muted">Reading events…</p>}
      {ledger?.activity.length === 0 && <p className="muted">Nothing has happened yet.</p>}
      <ul>
        {ledger?.activity.map((item) => (
          <li key={item.hash}>
            <span>{item.text}</span>
            <a href={`${EXPLORER}/tx/${item.hash}`} target="_blank" rel="noreferrer">{item.timestamp ? dateTime(item.timestamp) : "View"}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/// The creator's proof upload: photos, receipts and a short note. Every file is hashed in this browser
/// before it leaves, and those hashes are what the contract commits to.
function ProofForm({ campaign, index, factory, tx }: { campaign: string; index: number; factory: string; tx: Tx }) {
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!tx.wallet.signer) return tx.wallet.connect();
    if (tx.wallet.wrongNetwork) return tx.wallet.switchToSepolia();
    if (files.length > 6) return toast.error("Choose at most six files per proof.");
    if (!files.length) return toast.error("Add at least one photo or receipt.");
    tx.setPending("proof");
    const id = toast.loading("Sign to authorize each file upload…");
    try {
      const context = { signer: tx.wallet.signer, factory, purpose: "proof" as const, campaign, milestone: index };
      const refs = [];
      for (const file of files) refs.push(await uploadFile(file, context));
      const { cid, hash } = await uploadDocument({ kind: "clearfund/proof", campaign, milestone: index, note: note.trim(), files: refs }, context);
      toast.dismiss(id);
      await tx.send("proof", (c) => c.submitProof(cid, hash), "Proof posted. Donors have 72 hours to review it.");
    } catch (err) {
      toast.error((err as Error).message, { id });
    } finally {
      tx.setPending("");
    }
  }

  return (
    <form className="proof-form" onSubmit={submit}>
      <label>
        Photos and receipts
        <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
      </label>
      <label>
        What was done
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Forty roof sheets bought and fitted. Receipts attached." />
      </label>
      <p className="hint">You can post proof once for this milestone. Donors then have 72 hours to review it, and any of them can take back their unspent share.</p>
      <button className="button button-primary" disabled={!!tx.pending}>{tx.pending === "proof" ? "Posting…" : "Post proof"}</button>
    </form>
  );
}

/// Shows a milestone's proof and checks it in the browser: the document must match the hash the
/// creator committed on-chain and name this campaign and milestone, and every file must match the
/// hash the document lists for it.
function ProofView({ campaign, index, cid, hash }: { campaign: string; index: number; cid: string; hash: string }) {
  const [result, setResult] = useState<Verified<ProofDocument> | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let live = true;
    setResult(null);
    setError("");
    verifyDocument<ProofDocument>(cid, hash, { campaign, milestone: index })
      .then((next) => { if (live) setResult(next); })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error && err.message === "Invalid ClearFund document"
          ? "This proof document is invalid. Treat it as unreliable."
          : "The proof could not be fetched from IPFS. The gateway may be slow; try again later.");
      });
    return () => { live = false; };

  }, [campaign, index, cid, hash, retry]);

  if (error) return <div className="notice notice-warn"><p>{error}</p><button className="button" onClick={() => setRetry(n => n + 1)}>Retry proof check</button></div>;
  if (!result) return <p className="muted">Fetching the proof from IPFS and checking it…</p>;

  const { doc, ok, documentOk, files } = result;
  return (
    <div className="proof">
      {doc.note && <p className="proof-note">{doc.note}</p>}
      <ul className="proof-files">
        {doc.files.map((file, i) => (
          <li key={file.cid}>
            <a href={gatewayUrl(file.cid)} target="_blank" rel="noreferrer">
              {file.type.startsWith("image/") ? <img src={gatewayUrl(file.cid)} alt={file.name} loading="lazy" /> : <span className="proof-doc">{file.name}</span>}
            </a>
            {!files[i]?.ok && <span className="proof-bad">Unavailable or changed</span>}
          </li>
        ))}
      </ul>
      <p className="hint">Matching hashes establish document integrity, not truthful work or a newly taken photo. Reusing a photo in a new document can still pass. Review the evidence yourself.</p>
      <p className={`seal ${ok ? "seal-ok" : "seal-bad"}`}>
        {ok
          ? <>Checked in your browser: every file matches the proof committed on-chain, <code>{shortHash(hash)}</code>.</>
          : documentOk
            ? "Some files no longer match what was posted. Treat this proof as unreliable."
            : "This proof does not match what was committed on-chain, or it was made for another milestone."}
      </p>
    </div>
  );
}
