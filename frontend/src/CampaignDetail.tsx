import { useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import { useCampaign } from "./useCampaign";
import { CAMPAIGN_ABI, CAMPAIGN_STATUS, MILESTONE_STATUS } from "./constants";
import { formatEth } from "./format";
import type { WalletState } from "./types";
import { toast } from "react-hot-toast";

export default function CampaignDetail({ wallet }: { wallet: WalletState }) {
  const { address } = useParams<{ address: string }>();
  const { campaign, milestones, loading, refetch } = useCampaign(wallet.provider, address);
  
  const [donateAmount, setDonateAmount] = useState("");
  const [isDonating, setIsDonating] = useState(false);

  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [submittingMilestone, setSubmittingMilestone] = useState<number | null>(null);

  if (loading) {
    return <div className="page-container"><div className="empty-state">Loading campaign...</div></div>;
  }

  if (!campaign) {
    return <div className="page-container"><div className="empty-state">Campaign not found</div></div>;
  }

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    
    try {
      setIsDonating(true);
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.donate({ value: ethers.parseEther(donateAmount) });
      
      toast.loading("Donating...", { id: "donate" });
      await tx.wait();
      toast.success("Donation successful!", { id: "donate" });
      
      setDonateAmount("");
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Donation failed", { id: "donate" });
    } finally {
      setIsDonating(false);
    }
  };

  const handleSubmitMilestone = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (!evidenceUrl) return toast.error("Please enter evidence URL");

    try {
      setSubmittingMilestone(milestoneId);
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.submitMilestone(milestoneId, evidenceUrl);
      
      toast.loading("Submitting evidence...", { id: "submit" });
      await tx.wait();
      toast.success("Evidence submitted!", { id: "submit" });
      
      setEvidenceUrl("");
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit evidence", { id: "submit" });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const handleVote = async (milestoneId: number, approve: boolean) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");

    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.vote(milestoneId, approve);
      
      toast.loading("Voting...", { id: "vote" });
      await tx.wait();
      toast.success("Vote recorded!", { id: "vote" });
      
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Vote failed", { id: "vote" });
    }
  };

  const progress = campaign.goalAmount > 0n 
    ? Number(campaign.raisedAmount * 100n / campaign.goalAmount) 
    : 0;

  return (
    <div className="page-container">
      <div className="neo-card mb-8">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="page-title">{campaign.title}</h1>
            <p className="text-secondary mt-1">By {campaign.ngoName}</p>
          </div>
          <span className="neo-tag neo-tag-blue">
            {CAMPAIGN_STATUS[campaign.status]}
          </span>
        </div>

        <p className="mb-6">{campaign.description}</p>

        <div className="neo-progress mb-2">
          <div className="neo-progress-bar" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
        <div className="flex justify-between text-muted text-sm mb-6">
          <span>{formatEth(campaign.raisedAmount)} ETH raised</span>
          <span>{formatEth(campaign.goalAmount)} ETH goal</span>
        </div>

        {campaign.status === 0 && (
          <form onSubmit={handleDonate} className="flex gap-4">
            <input
              type="number"
              className="neo-input flex-1"
              step="0.01"
              required
              placeholder="Amount in ETH"
              value={donateAmount}
              onChange={(e) => setDonateAmount(e.target.value)}
            />
            <button
              type="submit"
              disabled={isDonating || !wallet.account}
              className="neo-btn neo-btn-primary"
            >
              {isDonating ? "Processing..." : "Donate"}
            </button>
          </form>
        )}
      </div>

      <h2 className="section-title">Milestones</h2>
      <div className="flex flex-col gap-4">
        {milestones.map((milestone) => (
          <div key={milestone.id} className="neo-card milestone-card">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold">{milestone.title}</h3>
              <span className={`neo-tag ${milestone.status === 0 ? "neo-tag-blue" : milestone.status === 1 ? "neo-tag-yellow" : milestone.status === 2 ? "neo-tag-green" : "neo-tag-red"}`}>
                {MILESTONE_STATUS[milestone.status]}
              </span>
            </div>
            
            <p className="text-secondary text-sm mb-4">{milestone.description}</p>
            
            <div className="flex justify-between text-sm text-muted mb-4">
              <span>Fund allocation: {milestone.fundPercent / 100}%</span>
              <span>Deadline: {new Date(milestone.deadline * 1000).toLocaleDateString()}</span>
            </div>

            {wallet.account?.toLowerCase() === campaign.ngoAddress.toLowerCase() && milestone.status === 0 && (
              <div className="flex gap-2 mt-4">
                <input
                  type="url"
                  className="neo-input flex-1"
                  placeholder="Evidence URL (e.g. Google Drive link)"
                  value={evidenceUrl}
                  onChange={(e) => setEvidenceUrl(e.target.value)}
                />
                <button
                  className="neo-btn neo-btn-primary"
                  disabled={submittingMilestone === milestone.id}
                  onClick={() => handleSubmitMilestone(milestone.id)}
                >
                  Submit Evidence
                </button>
              </div>
            )}

            {milestone.status === 1 && (
              <div className="mt-4 p-4 border-t-2" style={{ borderColor: 'var(--border)' }}>
                <p className="mb-2 text-sm">
                  <strong>Evidence:</strong> <a href={milestone.evidenceUrl} target="_blank" rel="noreferrer" className="underline">{milestone.evidenceUrl}</a>
                </p>
                {campaign.status === 1 && (
                  <div className="flex gap-4 mt-4">
                    <button className="neo-btn" style={{ background: 'var(--success)' }} onClick={() => handleVote(milestone.id, true)}>Approve ({formatEth(milestone.votesFor)} ETH)</button>
                    <button className="neo-btn" style={{ background: 'var(--danger)', color: 'white' }} onClick={() => handleVote(milestone.id, false)}>Reject ({formatEth(milestone.votesAgainst)} ETH)</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
