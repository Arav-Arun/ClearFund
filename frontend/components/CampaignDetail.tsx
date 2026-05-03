import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import {
  CAMPAIGN_ABI,
  CAMPAIGN_STATUS,
  MILESTONE_STATUS,
  formatEth,
  useCampaign,
} from "../blockchain";
import type { WalletState } from "../blockchain";
import { toast } from "react-hot-toast";

function statusTagClass(status: number) {
  if (status === 0) return "neo-tag-blue";
  if (status === 1 || status === 2) return "neo-tag-yellow";
  if (status === 3) return "neo-tag-green";
  return "neo-tag-red";
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read evidence image."));
    reader.readAsDataURL(file);
  });
}

export default function CampaignDetail({ wallet }: { wallet: WalletState }) {
  const { address } = useParams<{ address: string }>();
  const { campaign, milestones, loading, refetch } = useCampaign(wallet.provider, address, wallet.account);
  
  const [donateAmount, setDonateAmount] = useState("");
  const [isDonating, setIsDonating] = useState(false);

  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceMilestoneId, setEvidenceMilestoneId] = useState<number | null>(null);
  const [locationStr, setLocationStr] = useState<string>("");
  const [submittingMilestone, setSubmittingMilestone] = useState<number | null>(null);

  useEffect(() => {
    if (evidenceFile && !locationStr) {
      if (navigator.geolocation) {
        toast.loading("Fetching live location...", { id: "geo" });
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setLocationStr(`${position.coords.latitude},${position.coords.longitude}`);
            toast.success("Location captured", { id: "geo" });
          },
          (_error) => {
            toast.error("Failed to get location. It is required.", { id: "geo" });
            setEvidenceFile(null);
            setEvidenceMilestoneId(null);
          }
        );
      } else {
        toast.error("Geolocation is not supported by this browser.");
        setEvidenceFile(null);
        setEvidenceMilestoneId(null);
      }
    }
  }, [evidenceFile, locationStr]);

  if (loading) {
    return <div className="page-container"><div className="empty-state">Loading campaign...</div></div>;
  }

  if (!campaign) {
    return <div className="page-container"><div className="empty-state">Campaign not found</div></div>;
  }

  const isNgo = wallet.account?.toLowerCase() === campaign.ngoAddress.toLowerCase();
  const isDonor = (campaign.userDonation || 0n) > 0n;
  const bootstrapTarget = (campaign.goalAmount * BigInt(campaign.bootstrapPercent)) / 100n;
  const canStartCampaign = campaign.raisedAmount >= bootstrapTarget;
  const now = Math.floor(Date.now() / 1000);
  const nextMilestone = milestones.find((milestone) => milestone.id > 0 && milestone.status !== 3);
  const canCancelStalled = campaign.status === 1 && !!nextMilestone?.deadline && nextMilestone.deadline < now;
  const fundraisingFailed = campaign.status === 0 && campaign.campaignDeadline < now && campaign.raisedAmount < bootstrapTarget;

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    
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

  const handleStartCampaign = async () => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.startCampaign();
      toast.loading("Starting campaign & releasing bootstrap...", { id: "start" });
      await tx.wait();
      toast.success("Campaign Started!", { id: "start" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start", { id: "start" });
    }
  };

  const handleCancelStalled = async () => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.cancelStalledCampaign();
      toast.loading("Cancelling stalled campaign...", { id: "cancel" });
      await tx.wait();
      toast.success("Campaign Cancelled. You can now claim refunds.", { id: "cancel" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel", { id: "cancel" });
    }
  };

  const handleRefund = async () => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.refund();
      toast.loading("Claiming refund...", { id: "refund" });
      await tx.wait();
      toast.success("Refund claimed.", { id: "refund" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Refund failed", { id: "refund" });
    }
  };

  const handleSubmitMilestone = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    if (!evidenceFile || !locationStr) return toast.error("Live photo and location required");

    try {
      setSubmittingMilestone(milestoneId);
      
      const simulatedUploadUrl = `ipfs://live-capture-${Date.now()}`;
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.submitMilestone(milestoneId, simulatedUploadUrl);
      
      toast.loading("Submitting to blockchain...", { id: "submit" });
      await tx.wait();
      toast.success("Submitted on-chain! Sending to AI Oracle...", { id: "submit" });
      
      const base64Image = await readFileAsDataUrl(evidenceFile);
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignAddress: address,
          milestoneId,
          imageB64: base64Image,
          locationStr,
        }),
      });

      const result = await response.json().catch(() => ({ error: "Oracle request failed" }));
      if (!response.ok || result.error) {
        toast.error(`Oracle Error: ${result.error || "Request failed"}`, { id: "submit" });
      } else {
        toast.success(`AI Oracle Decision: ${result.status}`, { id: "submit" });
      }
      refetch();

      setEvidenceFile(null);
      setEvidenceMilestoneId(null);
      setLocationStr("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit", { id: "submit" });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const handleVeto = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.vetoMilestone(milestoneId);
      toast.loading("Recording veto vote...", { id: "veto" });
      await tx.wait();
      toast.success("Veto recorded. Rejection requires a donor majority.", { id: "veto" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Veto failed", { id: "veto" });
    }
  };

  const handleExecute = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.executeMilestone(milestoneId);
      toast.loading("Releasing funds...", { id: "execute" });
      await tx.wait();
      toast.success("Funds released!", { id: "execute" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Execute failed", { id: "execute" });
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
          <span className={`neo-tag ${campaign.status === 3 ? "neo-tag-red" : statusTagClass(campaign.status)}`}>
            {CAMPAIGN_STATUS[campaign.status]}
          </span>
        </div>

        <p className="mb-6">{campaign.description}</p>

        <div className="neo-progress mb-2">
          <div className="neo-progress-bar" style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
        <div className="flex justify-between text-muted text-sm mb-6">
          <span>{formatEth(campaign.raisedAmount)} ETH raised</span>
          <span>{formatEth(campaign.goalAmount)} ETH soft goal</span>
        </div>

        {wallet.account && (
          <p className="text-secondary text-sm mb-4">
            Your donation: {formatEth(campaign.userDonation || 0n)} ETH
          </p>
        )}

        {campaign.status === 0 && (
          <form onSubmit={handleDonate} className="flex gap-4 mb-4">
            <input
              type="number"
              className="neo-input flex-1"
              step="0.01"
              required
              placeholder="Amount in ETH (Overfunding allowed)"
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

        {campaign.status === 0 && isNgo && (
           <button
             onClick={handleStartCampaign}
             className="neo-btn neo-btn-primary"
             disabled={!canStartCampaign}
           >
             {canStartCampaign ? "Start Campaign" : `Need ${formatEth(bootstrapTarget)} ETH to start`}
           </button>
        )}

        {canCancelStalled && (
           <button onClick={handleCancelStalled} className="neo-btn neo-btn-danger mt-4">
             Cancel After Missed Milestone Deadline
           </button>
        )}

        {(campaign.status === 3 || fundraisingFailed) && isDonor && (
          <button onClick={handleRefund} className="neo-btn neo-btn-outline mt-4">
            Claim Refund
          </button>
        )}
      </div>

      <h2 className="section-title">Milestones</h2>
      <div className="flex flex-col gap-4">
        {milestones.map((milestone) => (
          <div key={milestone.id} className="neo-card milestone-card">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold">{milestone.title}</h3>
              <span className={`neo-tag ${statusTagClass(milestone.status)}`}>
                {MILESTONE_STATUS[milestone.status]}
              </span>
            </div>
            
            <p className="text-secondary text-sm mb-4">{milestone.description}</p>
            
            <div className="flex justify-between text-sm text-muted mb-4">
              <span>Fund allocation: {milestone.fundPercent}%</span>
              <span>
                Deadline: {milestone.id === 0 ? "Released at start" : new Date(milestone.deadline * 1000).toLocaleDateString()}
              </span>
            </div>

            {isNgo && milestone.id > 0 && milestone.status === 0 && (
              <div className="flex gap-2 mt-4 items-center">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="neo-input flex-1"
                  onChange={(e) => {
                    setEvidenceFile(e.target.files?.[0] || null);
                    setEvidenceMilestoneId(e.target.files?.[0] ? milestone.id : null);
                    setLocationStr("");
                  }}
                />
                <button
                  className="neo-btn neo-btn-primary"
                  disabled={
                    submittingMilestone === milestone.id ||
                    !evidenceFile ||
                    !locationStr ||
                    evidenceMilestoneId !== milestone.id
                  }
                  onClick={() => handleSubmitMilestone(milestone.id)}
                >
                  Submit Live Evidence
                </button>
              </div>
            )}

            {milestone.status === 1 && (
              <div className="mt-4 p-4 border-t-2" style={{ borderColor: 'var(--border)' }}>
                <p className="mb-2 text-sm text-yellow-600 font-bold">
                  AI Oracle is analyzing the evidence...
                </p>
              </div>
            )}

            {milestone.status === 2 && (
              <div className="mt-4 p-4 border-t-2" style={{ borderColor: 'var(--border)' }}>
                <p className="mb-2 text-sm font-bold" style={{ color: 'var(--success)' }}>
                  AI Approved. 24-Hour Veto Window Active.
                </p>
                <p className="text-xs mb-4 text-secondary">
                  No vote counts as yes. Veto votes: {milestone.vetoVotes}/{milestone.donorCount || "?"}. Ends at {new Date(milestone.vetoEndsAt * 1000).toLocaleString()}.
                </p>
                {(isDonor || isNgo) && (
                  <div className="notice-box mb-4">
                    {isNgo
                      ? "Donors and the NGO should watch this 24-hour review window. Funds release if veto votes do not reach a majority."
                      : "You are a donor on this campaign. Only vote if you want to block this milestone; doing nothing counts as yes."}
                  </div>
                )}
                <div className="flex gap-4 mt-4">
                  {isDonor && (
                    <button
                      className="neo-btn neo-btn-danger"
                      disabled={milestone.hasVetoed || milestone.vetoEndsAt <= now}
                      onClick={() => handleVeto(milestone.id)}
                    >
                      {milestone.hasVetoed ? "Veto Recorded" : "Veto Milestone"}
                    </button>
                  )}
                  <button
                    className="neo-btn neo-btn-primary"
                    disabled={milestone.vetoEndsAt > now}
                    onClick={() => handleExecute(milestone.id)}
                  >
                    {milestone.vetoEndsAt > now ? "Waiting for Veto Window" : "Release Funds"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
