import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Boxes, Camera, Code2, Coins, HandCoins, Hourglass, Layers, PenLine, Unlock } from "lucide-react";
import { usd } from "./format";
import { STATUS_TEXT, fundedPercent, useCampaigns } from "./campaigns";
import { gatewayUrl } from "./proof";

const BUILT_ON = [
  { Icon: Layers, label: "Ethereum" },
  { Icon: Coins, label: "USDC" },
  { Icon: Boxes, label: "IPFS" },
  { Icon: PenLine, label: "EIP-2612 permits" },
  { Icon: Code2, label: "Foundry" },
];

const STEPS = [
  { Icon: HandCoins, title: "You give", body: "Donate USDC with one signature. It goes into an escrow made for this cause alone.", tone: "peach" },
  { Icon: Camera, title: "They show the work", body: "When a milestone is done, the organizer posts photos and receipts, once, with no edits later.", tone: "blue" },
  { Icon: Hourglass, title: "You decide", body: "You get 72 hours to look. If you aren't convinced, you take back your unspent share.", tone: "cream" },
  { Icon: Unlock, title: "Money moves", body: "Then that milestone's share of everyone who stayed is released to the cause.", tone: "navy" },
];

const GUARANTEES = [
  ["Review each payout within 72 hours.", "If you stay silent, your share is released. During review you can withdraw everything still unspent."],
  ["A whale can’t outvote you.", "There is no vote to win. Each donor decides only for their own money, so size buys no power."],
  ["Proof can’t be swapped.", "Photos and receipts are hashed before upload and that hash is locked on-chain. Your browser checks it again."],
  ["Documents are bound to their milestone.", "A document from another milestone fails verification. Hashes cannot prove a photo is new or that the work is real."],
  ["An organizer can’t vanish with it.", "Money moves in stages. Miss a deadline and anyone can cancel; every donor takes back what is left."],
  ["Escrow has no admin key.", "Campaigns cannot be upgraded or drained by an admin. The website, RPC and IPFS are hosted services; USDC transfers remain subject to its issuer’s controls."],
];

// How far the reader has scrolled through the pinned hero: 0 until the stage pins, 1 when it is about
// to scroll away. The stage is the section's first child, and how far it has slid down inside the
// section is exactly the pinned distance. Reduced motion shows the finished machine at once.
function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [progress, setProgress] = useState(0);
  const [still, setStill] = useState(false);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStill(true);
      setProgress(1);
      return;
    }
    // Two rect reads per scroll event are cheap, and React skips renders when the value is unchanged.
    const measure = () => {
      const stage = ref.current?.firstElementChild;
      if (!ref.current || !stage) return;
      const section = ref.current.getBoundingClientRect();
      const pinned = stage.getBoundingClientRect();
      const travel = section.height - pinned.height;
      setProgress(travel > 0 ? Math.round(Math.min(1, Math.max(0, (pinned.top - section.top) / travel)) * 500) / 500 : 1);
    };
    measure();
    addEventListener("scroll", measure, { passive: true });
    addEventListener("resize", measure);
    return () => {
      removeEventListener("scroll", measure);
      removeEventListener("resize", measure);
    };
  }, []);

  return { ref, progress, still };
}

export default function Home() {
  const { campaigns, error, loading, hasMore, loadMore } = useCampaigns();
  const machine = useScrollProgress<HTMLElement>();

  return (
    <main className="home">
      <section className={`hero-scroll${machine.still ? " is-still" : ""}`} ref={machine.ref}>
        <div className="hero-stage">
          <div className="hero-copy">
            <h1>Donations that wait for <em>proof</em>.</h1>
            <p className="lede">
              Give to a cause without handing over a blank cheque. Your USDC reaches the organizer one milestone at a
              time, only after they show the work, and whatever hasn’t been spent stays yours.
            </p>
            <div className="actions">
              <Link to="/#campaigns" className="button button-primary">See the campaigns</Link>
              <Link to="/new" className="button">Start a campaign</Link>
            </div>
          </div>
          <div className="machine-frame">
            <EscrowMachine progress={machine.progress} />
          </div>
          <p className="machine-hint" aria-hidden="true">{machine.progress < 0.04 ? "Scroll to watch a donation move through the escrow" : "\u00a0"}</p>
        </div>
      </section>

      <ul className="built-on page-band" aria-label="Built on">
        {BUILT_ON.map(({ Icon, label }) => (
          <li key={label}><Icon size={16} strokeWidth={1.6} aria-hidden="true" />{label}</li>
        ))}
      </ul>

      <section className="steps page-band" aria-labelledby="steps-title">
        <h2 id="steps-title">How a donation moves</h2>
        <ol>
          {STEPS.map(({ Icon, title, body, tone }, i) => (
            <li key={title} className={`step step-${tone}`}>
              <span className="step-top">
                <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
                <span className="step-icon" aria-hidden="true"><Icon size={24} strokeWidth={1.5} /></span>
              </span>
              <h3>{title}</h3>
              <p>{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="guarantees page-band" aria-labelledby="guarantees-title">
        <h2 id="guarantees-title">What the rules protect</h2>
        <ul>
          {GUARANTEES.map(([claim, why]) => (
            <li key={claim}>
              <h3>{claim}</h3>
              <p>{why}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="campaigns" className="campaigns page-band" aria-labelledby="campaigns-title">
        <h2 id="campaigns-title">Campaigns</h2>
        {loading && <p className="muted centered">Reading campaigns from Sepolia…</p>}
        {error && <p className="notice notice-warn">{error}</p>}
        {!loading && !error && campaigns.length === 0 && (
          <p className="notice centered">{hasMore ? "No campaigns in the blocks checked so far. Load more to continue." : <>No campaigns yet. <Link to="/new">Start the first one.</Link></>}</p>
        )}
        <ul className="campaign-grid">
          {campaigns.map((c) => (
            <li key={c.address}>
              <Link to={`/campaign/${c.address}`} className="card">
                <span className="card-cover">{c.doc && <img src={gatewayUrl(c.doc.cover.cid)} alt="" loading="lazy" />}</span>
                <span className="card-body">
                  <span className={`chip chip-${c.status}`}>{STATUS_TEXT[c.status]}</span>
                  <strong>{c.doc?.title || "Untitled campaign"}</strong>
                  <span className="muted">{c.doc?.organizer}{c.doc?.location ? `, ${c.doc.location}` : ""}</span>
                  <span className="meter" aria-hidden="true"><span style={{ width: `${fundedPercent(c)}%` }} /></span>
                  <span className="card-money"><span className="figure">{usd(c.raised, 0)}</span> raised of {usd(c.goal, 0)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {hasMore && <button className="button" disabled={loading} onClick={loadMore}>{loading ? "Loading…" : error ? "Retry loading campaigns" : "Load more campaigns"}</button>}
      </section>

      <section className="closing page-band">
        <h2>Give with your eyes <em>open</em>.</h2>
        <p>Plan to review every proof within 72 hours. Organizers need upfront capital, and donor exits can reduce later-stage budgets.</p>
        <div className="actions">
          <Link to="/#campaigns" className="button button-primary">Find a cause</Link>
          <Link to="/new" className="button">Start a campaign</Link>
        </div>
      </section>
    </main>
  );
}

// The escrow drawn as a bench machine (assets/escrow.svg), played by the scroll position.
// The drawing is static isometric art whose moving parts carry data-part names. escrow.json holds the
// screen vector of one world unit along each axis, so a part moves along the rail, across it or up by
// plain 2D translation and stays true to the drawing's own camera, plus the points the notes pin to.

interface Camera {
  x: [number, number];
  y: [number, number];
  z: [number, number];
  needle: { centre: [number, number]; radius: number };
  size: [number, number];
  anchors: Record<string, [number, number]>;
}

type Vec = [number, number, number];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const ease = (t: number) => t * t * (3 - 2 * t);
// Progress through one stage of the story, eased, given the overall progress 0–1.
const stage = (p: number, from: number, to: number) => ease(clamp((p - from) / (to - from)));

// What happens, in order. Each note shows from `at` onwards and is the current one until the next.
const NOTES = [
  { at: 0.02, anchor: "vault", place: "above", text: "Donations wait in escrow" },
  { at: 0.24, anchor: "proof", place: "left", text: "Proof posted for milestone 2" },
  { at: 0.42, anchor: "timer", place: "above", text: "72-hour review window" },
  { at: 0.52, anchor: "exit", place: "below", text: "Not convinced? Your share comes back" },
  { at: 0.8, anchor: "release", place: "above", text: "The rest is released to the cause" },
] as const;

function pose(p: number) {
  const fall = stage(p, 0.02, 0.18); // donations drop into the vault
  const roll = stage(p, 0.2, 0.36); // the cart rolls up to the gate under review
  const review = stage(p, 0.42, 0.7); // the review window runs
  const exit = stage(p, 0.52, 0.66); // one donor's coin slides down the exit chute
  const lift = stage(p, 0.72, 0.78); // the gate opens
  const through = stage(p, 0.78, 0.9); // the cart rolls through
  const release = stage(p, 0.86, 0.97); // released coins land in the organizer's tray
  return {
    drop: { at: [0, 0, 36 * (1 - fall)] as Vec, opacity: fall },
    cart: [-34 + 34 * roll + 46 * through, 0, 0] as Vec,
    coin: { at: [0, -9 + 27 * exit, 3 - 2 * exit] as Vec, opacity: exit > 0 && exit < 1 ? 1 : 0 },
    bar: [0, 0, 16 * lift] as Vec,
    release: { at: [0, 0, 34 * (1 - release)] as Vec, opacity: release },
    needle: review * Math.PI * 2 * 0.98,
  };
}

function moveBy(camera: Camera, [dx, dy, dz]: Vec) {
  const sx = camera.x[0] * dx + camera.y[0] * dy + camera.z[0] * dz;
  const sy = camera.x[1] * dx + camera.y[1] * dy + camera.z[1] * dz;
  return `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`;
}

function apply(root: HTMLElement, camera: Camera, p: number) {
  const pos = pose(p);
  const set = (name: string, transform: string, opacity?: number) => {
    const el = root.querySelector<SVGElement>(`[data-part="${name}"]`);
    el?.setAttribute("transform", transform);
    if (opacity !== undefined) el?.setAttribute("opacity", opacity.toFixed(2));
  };
  set("drop", moveBy(camera, pos.drop.at), pos.drop.opacity);
  set("cart", moveBy(camera, pos.cart));
  set("chute-coin", moveBy(camera, pos.coin.at), pos.coin.opacity);
  set("bar", moveBy(camera, pos.bar));
  set("release", moveBy(camera, pos.release.at), pos.release.opacity);

  const { centre, radius } = camera.needle;
  const ex = Math.sin(pos.needle) * radius;
  const ey = -Math.cos(pos.needle) * radius;
  const end = [centre[0] + camera.x[0] * ex + camera.y[0] * ey, centre[1] + camera.x[1] * ex + camera.y[1] * ey];
  root.querySelector('[data-part="needle"]')?.setAttribute("d", `M${centre[0].toFixed(2)} ${centre[1].toFixed(2)}L${end[0].toFixed(2)} ${end[1].toFixed(2)}`);
}

function EscrowMachine({ progress }: { progress: number }) {
  const drawing = useRef<HTMLDivElement>(null);
  const camera = useRef<Camera | null>(null);
  const [anchors, setAnchors] = useState<Camera | null>(null);
  // The drawing arrives after the first renders, so it must pose itself with the latest progress,
  // not the value captured when loading began.
  const latest = useRef(progress);
  latest.current = progress;

  useEffect(() => {
    let live = true;
    Promise.all([fetch("/escrow.svg").then((r) => r.text()), fetch("/escrow.json").then((r) => r.json())]).then(([svg, cam]) => {
      if (!live || !drawing.current) return;
      drawing.current.innerHTML = svg;
      camera.current = cam;
      setAnchors(cam);
      apply(drawing.current, cam, latest.current);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (drawing.current && camera.current) apply(drawing.current, camera.current, progress);
  }, [progress]);

  const current = NOTES.reduce((index, note, i) => (progress >= note.at ? i : index), -1);

  return (
    <div className="machine">
      <div ref={drawing} role="img" aria-label="An escrow drawn as a bench machine, moving through the steps of a donation" />
      {anchors &&
        NOTES.map((note, i) => {
          const [x, y] = anchors.anchors[note.anchor];
          return (
            <span
              key={note.anchor}
              className={`machine-note note-${note.place}${i <= current ? " is-shown" : ""}${i === current ? " is-current" : ""}`}
              style={{ left: `${(x / anchors.size[0]) * 100}%`, top: `${(y / anchors.size[1]) * 100}%` }}
            >
              <span className="note-n">{i + 1}</span>
              {note.text}
            </span>
          );
        })}
    </div>
  );
}
