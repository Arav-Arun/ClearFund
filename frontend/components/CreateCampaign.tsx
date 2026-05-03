import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import { FACTORY_ADDRESS, FACTORY_ABI, humanError } from "../blockchain";
import type { WalletState } from "../blockchain";
import { toast } from "react-hot-toast";

type MilestoneDraft = {
  title: string;
  description: string;
  fundPercent: string;
  deadline: string;
};

const emptyMilestone = (): MilestoneDraft => ({
  title: "",
  description: "",
  fundPercent: "",
  deadline: "",
});

function toTimestamp(date: string) {
  return Math.floor(new Date(date).getTime() / 1000);
}

export default function CreateCampaign({ wallet }: { wallet: WalletState }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ngoName, setNgoName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [campaignDeadline, setCampaignDeadline] = useState("");
  const [bootstrapPercent, setBootstrapPercent] = useState("");
  const [milestones, setMilestones] = useState([
    emptyMilestone(),
    emptyMilestone(),
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddMilestone = () => {
    if (milestones.length >= 5) {
      toast.error("Use at most 5 milestones.");
      return;
    }
    setMilestones([...milestones, emptyMilestone()]);
  };

  const handleRemoveMilestone = (index: number) => {
    if (milestones.length <= 2) {
      toast.error("Use at least 2 milestones.");
      return;
    }
    setMilestones(milestones.filter((_, i) => i !== index));
  };

  const updateMilestone = (index: number, field: keyof MilestoneDraft, value: string) => {
    setMilestones(
      milestones.map((milestone, i) => i === index ? { ...milestone, [field]: value } : milestone)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.signer) {
      toast.error("Please connect your wallet");
      return;
    }
    if (wallet.isWrongNetwork) {
      toast.error("Switch to Sepolia first");
      return;
    }
    if (!FACTORY_ADDRESS) {
      toast.error("Factory address is not configured.");
      return;
    }

    try {
      setIsSubmitting(true);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet.signer);

      const now = Math.floor(Date.now() / 1000);
      const parsedDeadline = toTimestamp(campaignDeadline);
      const parsedBootstrap = Number(bootstrapPercent);
      let parsedGoal: bigint;

      try {
        parsedGoal = ethers.parseEther(goalAmount || "0");
      } catch {
        toast.error("Enter a valid ETH goal amount.");
        return;
      }

      const formattedMilestones = milestones.map((m) => ({
        title: m.title.trim(),
        description: m.description.trim(),
        fundPercent: Number(m.fundPercent),
        deadline: toTimestamp(m.deadline),
      }));

      if (!title.trim() || !description.trim() || !ngoName.trim()) {
        toast.error("Campaign title, NGO name, and description are required.");
        return;
      }

      if (parsedGoal <= 0n) {
        toast.error("Goal must be greater than 0 ETH.");
        return;
      }

      if (milestones.length < 2 || milestones.length > 5) {
        toast.error("Use 2 to 5 milestones.");
        return;
      }

      if (!Number.isInteger(parsedBootstrap) || parsedBootstrap < 1 || parsedBootstrap > 15) {
        toast.error("Bootstrap must be between 1% and 15%.");
        return;
      }

      if (!Number.isFinite(parsedDeadline) || parsedDeadline <= now) {
        toast.error("Campaign deadline must be in the future.");
        return;
      }

      const totalMilestonePercent = formattedMilestones.reduce((acc, m) => acc + m.fundPercent, 0);
      if (totalMilestonePercent !== 100) {
        toast.error(`Milestone percentages must equal 100%. Currently: ${totalMilestonePercent}%`);
        return;
      }

      const remainingPercent = 100 - parsedBootstrap;
      let assignedPercent = 0;

      let previousDeadline = parsedDeadline;
      for (const [index, milestone] of formattedMilestones.entries()) {
        if (!milestone.title || !milestone.description) {
          toast.error("Every milestone needs a title and description.");
          return;
        }

        if (!Number.isInteger(milestone.fundPercent) || milestone.fundPercent < 1 || milestone.fundPercent > 100) {
          toast.error("Each milestone fund percent must be a whole number between 1 and 100.");
          return;
        }

        if (!Number.isFinite(milestone.deadline) || milestone.deadline <= previousDeadline) {
          toast.error("Milestone deadlines must be after fundraising and in order.");
          return;
        }

        const actualPercent = index === formattedMilestones.length - 1
          ? remainingPercent - assignedPercent
          : Math.floor((milestone.fundPercent * remainingPercent) / 100);
        if (actualPercent <= 0) {
          toast.error("Each milestone must receive at least 1% after the bootstrap split.");
          return;
        }
        assignedPercent += actualPercent;

        previousDeadline = milestone.deadline;
      }

      const tx = await factory.createCampaign(
        title.trim(),
        description.trim(),
        ngoName.trim(),
        parsedBootstrap,
        formattedMilestones,
        parsedGoal,
        parsedDeadline
      );

      toast.loading("Transaction pending...", { id: "tx" });
      const receipt = await tx.wait();
      if (!receipt) throw new Error("Transaction was not confirmed.");
      toast.success("Campaign created successfully!", { id: "tx" });

      let campaignAddress: string | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === "CampaignCreated") {
            campaignAddress = parsed.args[0] as string;
            break;
          }
        } catch {
          // Ignore logs from other contracts in the same transaction.
        }
      }
      
      setTitle("");
      setDescription("");
      setNgoName("");
      setGoalAmount("");
      setCampaignDeadline("");
      setBootstrapPercent("");
      setMilestones([emptyMilestone(), emptyMilestone()]);
      navigate(campaignAddress ? `/campaign/${campaignAddress}` : "/");

    } catch (err: unknown) {
      console.error(err);
      toast.error(humanError(err, "Failed to create campaign"), { id: "tx" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 640 }}>
      <h1 className="page-title mb-6">Create Campaign</h1>
      
      <form onSubmit={handleSubmit} className="neo-card flex flex-col gap-4" noValidate>
        <div>
          <label className="neo-label">Campaign Title</label>
          <input
            className="neo-input"
            type="text"
            required
            placeholder="e.g. Clean Water Initiative"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div>
          <label className="neo-label">NGO Name</label>
          <input
            className="neo-input"
            type="text"
            required
            placeholder="e.g. Water for All"
            value={ngoName}
            onChange={(e) => setNgoName(e.target.value)}
          />
        </div>

        <div>
          <label className="neo-label">Description</label>
          <textarea
            className="neo-input"
            required
            rows={4}
            placeholder="Describe the campaign..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="neo-label">Goal (ETH)</label>
            <input
              className="neo-input"
              type="number"
              step="any"
              required
              placeholder="e.g. 10.5"
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value)}
            />
          </div>
          <div className="flex-1">
            <label className="neo-label">Campaign Deadline</label>
            <input
              className="neo-input"
              type="date"
              required
              value={campaignDeadline}
              onChange={(e) => setCampaignDeadline(e.target.value)}
            />
          </div>
        </div>

        <div>
          <label className="neo-label">Bootstrap Funds (%)</label>
          <p className="text-secondary text-sm mb-2">Percentage released when the bootstrap threshold is reached.</p>
          <input
            className="neo-input"
            type="number"
            required
            min="1"
            max="15"
            placeholder="e.g. 10"
            value={bootstrapPercent}
            onChange={(e) => setBootstrapPercent(e.target.value)}
          />
        </div>

        <div className="mt-4">
          <h2 className="section-title text-xl mb-4">Milestones</h2>
          
          {milestones.map((milestone, index) => (
            <div key={index} className="milestone-form-group mb-4">
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold">Milestone {index + 1}</span>
                {milestones.length > 2 && (
                  <button type="button" className="neo-btn" style={{ padding: "4px 8px" }} onClick={() => handleRemoveMilestone(index)}>
                    Remove
                  </button>
                )}
              </div>
              
              <div className="flex flex-col gap-3">
                <input
                  className="neo-input"
                  type="text"
                  required
                  placeholder="Milestone Title"
                  value={milestone.title}
                  onChange={(e) => updateMilestone(index, "title", e.target.value)}
                />
                <textarea
                  className="neo-input"
                  required
                  rows={2}
                  placeholder="Milestone Description"
                  value={milestone.description}
                  onChange={(e) => updateMilestone(index, "description", e.target.value)}
                />
                <div className="flex gap-4">
                  <input
                    className="neo-input flex-1"
                    type="number"
                    required
                    min="1"
                    max="100"
                    placeholder="Fund %"
                    value={milestone.fundPercent}
                    onChange={(e) => updateMilestone(index, "fundPercent", e.target.value)}
                  />
                  <input
                    className="neo-input flex-1"
                    type="date"
                    required
                    value={milestone.deadline}
                    onChange={(e) => updateMilestone(index, "deadline", e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="neo-btn neo-btn-outline w-full mt-2"
            onClick={handleAddMilestone}
            disabled={milestones.length >= 5}
          >
            + Add Milestone
          </button>
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="neo-btn neo-btn-primary w-full mt-6"
        >
          {isSubmitting ? "Creating..." : "Deploy Campaign"}
        </button>
      </form>
    </div>
  );
}
