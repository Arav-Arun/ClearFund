import { useState } from "react";
import { ethers } from "ethers";
import { FACTORY_ADDRESS, FACTORY_ABI } from "./constants";
import type { WalletState } from "./types";
import { toast } from "react-hot-toast";

export default function CreateCampaign({ wallet }: { wallet: WalletState }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ngoName, setNgoName] = useState("");
  const [goalAmount, setGoalAmount] = useState("");
  const [campaignDeadline, setCampaignDeadline] = useState("");
  const [bootstrapPercent, setBootstrapPercent] = useState("");
  const [milestones, setMilestones] = useState([
    { title: "", description: "", fundPercent: "", deadline: "" },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAddMilestone = () => {
    setMilestones([...milestones, { title: "", description: "", fundPercent: "", deadline: "" }]);
  };

  const handleRemoveMilestone = (index: number) => {
    setMilestones(milestones.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.signer) {
      toast.error("Please connect your wallet");
      return;
    }

    try {
      setIsSubmitting(true);
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, wallet.signer);

      const parsedGoal = ethers.parseEther(goalAmount);
      const parsedDeadline = Math.floor(new Date(campaignDeadline).getTime() / 1000);
      const parsedBootstrap = Number(bootstrapPercent) * 100; // basis points

      const formattedMilestones = milestones.map((m) => ({
        title: m.title,
        description: m.description,
        fundPercent: Number(m.fundPercent) * 100, // basis points
        deadline: Math.floor(new Date(m.deadline).getTime() / 1000),
      }));

      // Validation
      const totalMilestonePercent = formattedMilestones.reduce((acc, m) => acc + m.fundPercent, 0);
      if (totalMilestonePercent + parsedBootstrap !== 10000) {
        toast.error(`Total percentages must equal 100%. Currently: ${(totalMilestonePercent + parsedBootstrap) / 100}%`);
        return;
      }

      const tx = await factory.createCampaign(
        title,
        description,
        ngoName,
        parsedBootstrap,
        formattedMilestones,
        parsedGoal,
        parsedDeadline
      );

      toast.loading("Transaction pending...", { id: "tx" });
      await tx.wait();
      toast.success("Campaign created successfully!", { id: "tx" });
      
      // Reset form
      setTitle("");
      setDescription("");
      setNgoName("");
      setGoalAmount("");
      setCampaignDeadline("");
      setBootstrapPercent("");
      setMilestones([{ title: "", description: "", fundPercent: "", deadline: "" }]);

    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to create campaign", { id: "tx" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="page-container" style={{ maxWidth: 640 }}>
      <h1 className="page-title mb-6">Create Campaign</h1>
      
      <form onSubmit={handleSubmit} className="neo-card flex flex-col gap-4">
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
              step="0.01"
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
          <p className="text-secondary text-sm mb-2">Percentage released immediately upon funding goal met.</p>
          <input
            className="neo-input"
            type="number"
            required
            min="0"
            max="100"
            placeholder="e.g. 10"
            value={bootstrapPercent}
            onChange={(e) => setBootstrapPercent(e.target.value)}
          />
        </div>

        <div className="mt-4">
          <h2 className="section-title text-xl mb-4">Milestones</h2>
          
          {milestones.map((milestone, index) => (
            <div key={index} className="neo-card mb-4" style={{ background: "var(--bg)" }}>
              <div className="flex justify-between items-center mb-2">
                <span className="font-bold">Milestone {index + 1}</span>
                {milestones.length > 1 && (
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
                  onChange={(e) => {
                    const newM = [...milestones];
                    newM[index].title = e.target.value;
                    setMilestones(newM);
                  }}
                />
                <textarea
                  className="neo-input"
                  required
                  rows={2}
                  placeholder="Milestone Description"
                  value={milestone.description}
                  onChange={(e) => {
                    const newM = [...milestones];
                    newM[index].description = e.target.value;
                    setMilestones(newM);
                  }}
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
                    onChange={(e) => {
                      const newM = [...milestones];
                      newM[index].fundPercent = e.target.value;
                      setMilestones(newM);
                    }}
                  />
                  <input
                    className="neo-input flex-1"
                    type="date"
                    required
                    value={milestone.deadline}
                    onChange={(e) => {
                      const newM = [...milestones];
                      newM[index].deadline = e.target.value;
                      setMilestones(newM);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="neo-btn neo-btn-outline w-full mt-2"
            onClick={handleAddMilestone}
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
