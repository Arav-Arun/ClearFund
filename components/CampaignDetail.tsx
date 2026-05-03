import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import { useCampaign } from "../hooks/useCampaign";
import { CAMPAIGN_ABI, CAMPAIGN_STATUS, MILESTONE_STATUS } from "../utils/constants";
import { formatEth } from "../utils/format";
import type { WalletState } from "../utils/types";
import { toast } from "react-hot-toast";

export default function CampaignDetail({ wallet }: { wallet: WalletState }) {
  const { address } = useParams<{ address: string }>();
  const { campaign, milestones, loading, refetch } = useCampaign(wallet.provider, address);
  
  const [donateAmount, setDonateAmount] = useState("");
  const [isDonating, setIsDonating] = useState(false);

  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [locationStr, setLocationStr] = useState<string>("");
  const [submittingMilestone, setSubmittingMilestone] = useState<number | null>(null);

  // Auto-fetch location when trying to submit
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
          }
        );
      } else {
        toast.error("Geolocation is not supported by this browser.");
      }
    }
  }, [evidenceFile, locationStr]);

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

  const handleStartCampaign = async () => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
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

  const handleSubmitMilestone = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (!evidenceFile || !locationStr) return toast.error("Live photo and location required");

    try {
      setSubmittingMilestone(milestoneId);
      
      // 1. Submit on-chain first
      const simulatedUploadUrl = `ipfs://live-capture-${Date.now()}`;
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.submitMilestone(milestoneId, simulatedUploadUrl);
      
      toast.loading("Submitting to blockchain...", { id: "submit" });
      await tx.wait();
      toast.success("Submitted on-chain! Sending to AI Oracle...", { id: "submit" });
      
      // 2. Convert File to Base64
      const reader = new FileReader();
      reader.readAsDataURL(evidenceFile);
      reader.onload = async () => {
        const base64Image = reader.result as string;
        
        // 3. Trigger Oracle Backend
        try {
          const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              campaignAddress: address,
              milestoneId: milestoneId,
              imageB64: base64Image,
              locationStr: locationStr
            })
          });
          
          const result = await response.json();
          if (result.error) {
            toast.error(`Oracle Error: ${result.error}`, { id: "submit" });
          } else {
            toast.success(`AI Oracle Decision: ${result.status}`, { id: "submit" });
          }
          refetch();
        } catch (err) {
          toast.error("Failed to connect to AI Oracle backend", { id: "submit" });
        }
      };

      setEvidenceFile(null);
      setLocationStr("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit", { id: "submit" });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const handleVeto = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.vetoMilestone(milestoneId);
      toast.loading("Casting Veto...", { id: "veto" });
      await tx.wait();
      toast.success("Veto successful! Milestone rejected.", { id: "veto" });
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Veto failed", { id: "veto" });
    }
  };

  const handleExecute = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
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
          <span>{formatEth(campaign.goalAmount)} ETH soft goal</span>
        </div>

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

        {/* NGO Actions */}
        {campaign.status === 0 && wallet.account?.toLowerCase() === campaign.ngoAddress.toLowerCase() && (
           <button onClick={handleStartCampaign} className="neo-btn" style={{ background: "var(--accent)" }}>
             Start Campaign & Lock Donations
           </button>
        )}

        {/* Donor Actions */}
        {campaign.status === 1 && (
           <button onClick={handleCancelStalled} className="neo-btn mt-4" style={{ background: "var(--danger)", color: "white" }}>
             Cancel Stalled Campaign (If NGO Ghosted)
           </button>
        )}
      </div>

      <h2 className="section-title">Milestones</h2>
      <div className="flex flex-col gap-4">
        {milestones.map((milestone) => (
          <div key={milestone.id} className="neo-card milestone-card">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-bold">{milestone.title}</h3>
              <span className={`neo-tag ${milestone.status === 0 ? "neo-tag-blue" : milestone.status === 1 ? "neo-tag-yellow" : milestone.status === 2 ? "neo-tag-yellow" : milestone.status === 3 ? "neo-tag-green" : "neo-tag-red"}`}>
                {MILESTONE_STATUS[milestone.status]}
              </span>
            </div>
            
            <p className="text-secondary text-sm mb-4">{milestone.description}</p>
            
            <div className="flex justify-between text-sm text-muted mb-4">
              <span>Fund allocation: {milestone.fundPercent}%</span>
              <span>Deadline: {new Date(milestone.deadline * 1000).toLocaleDateString()}</span>
            </div>

            {wallet.account?.toLowerCase() === campaign.ngoAddress.toLowerCase() && milestone.status === 0 && (
              <div className="flex gap-2 mt-4 items-center">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="neo-input flex-1"
                  onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
                />
                <button
                  className="neo-btn neo-btn-primary"
                  disabled={submittingMilestone === milestone.id || !evidenceFile || !locationStr}
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
                  AI Approved! 24-Hour Veto Window Active.
                </p>
                <p className="text-xs mb-4 text-secondary">
                  Veto ends at: {new Date(milestone.vetoEndsAt * 1000).toLocaleString()}
                </p>
                <div className="flex gap-4 mt-4">
                  <button className="neo-btn" style={{ background: 'var(--danger)', color: 'white' }} onClick={() => handleVeto(milestone.id)}>Veto AI Decision</button>
                  <button className="neo-btn" style={{ background: 'var(--accent)' }} onClick={() => handleExecute(milestone.id)}>Execute (If Veto Passed)</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
