import { usd } from "./format";
import { Status, Step, milestoneAmount } from "./campaigns";
import type { Campaign, Ledger } from "./campaigns";

export type Part = { label: string; amount: bigint; weight: number; state: "planned" | "released" | "review" | "held" | "returned" };

const STATE_TEXT = { planned: "Planned", released: "Released", review: "In review", held: "Held", returned: "Returned" };

/// Where every dollar of a campaign is: released to the cause, under review, still held, or back
/// with the donors who walked away. One segment per milestone, sized by its share. While a campaign
/// is still raising money nothing is held for a milestone yet, so the strip shows the plan at the goal.
export function campaignParts(campaign: Campaign, ledger: Ledger | null): Part[] {
  const title = (i: number) => campaign.doc?.milestones[i]?.title || `Milestone ${i + 1}`;
  const weightOf = (amount: bigint) => Number((amount * 10_000n) / (campaign.raised || 1n));
  const returned = ledger?.returned ?? 0n;

  // A cancelled campaign has no milestones left to fund: show what was spent, what went back to
  // donors and what is still waiting for them to claim.
  if (campaign.status === Status.Cancelled) {
    const parts: Part[] = campaign.milestones
      .filter((m) => m.step === Step.Released)
      .map((m) => ({ label: title(m.index), amount: milestoneAmount(campaign, m, ledger), weight: m.shareBps, state: "released" }));
    const unclaimed = campaign.held - campaign.creatorOwed;
    if (returned > 0n) parts.push({ label: "Back with donors", amount: returned, weight: weightOf(returned), state: "returned" });
    if (unclaimed > 0n) parts.push({ label: "Waiting to be claimed", amount: unclaimed, weight: weightOf(unclaimed), state: "held" });
    return parts;
  }

  const waiting = campaign.status === Status.Funding ? "planned" : "held";
  const parts: Part[] = campaign.milestones.map((m) => ({
    label: title(m.index),
    amount: milestoneAmount(campaign, m, ledger),
    weight: m.shareBps,
    state: m.step === Step.Released ? "released" : m.step === Step.InReview ? "review" : waiting,
  }));
  if (returned > 0n) parts.push({ label: "Donors who walked away", amount: returned, weight: weightOf(returned), state: "returned" });
  return parts;
}

export default function MoneyStrip({ parts }: { parts: Part[] }) {
  return (
    <ol className="strip" aria-label="Where the money is">
      {parts.map((part, i) => (
        <li key={i} className={`stub stub-${part.state}`} style={{ flexGrow: Math.max(part.weight, 900) }}>
          <span className="stub-state">{STATE_TEXT[part.state]}</span>
          <span className="stub-amount">{usd(part.amount, 0)}</span>
          <span className="stub-label">{part.label}</span>
        </li>
      ))}
    </ol>
  );
}
