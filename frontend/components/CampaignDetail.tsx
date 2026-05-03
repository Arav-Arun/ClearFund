import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import {
  CAMPAIGN_ABI,
  CAMPAIGN_STATUS,
  MILESTONE_STATUS,
  formatEth,
  useCampaign,
} from "../blockchain";
import type { AIReviewInfo, WalletState } from "../blockchain";
import { toast } from "react-hot-toast";

type OracleResult = AIReviewInfo & {
  decision?: string;
  evidenceUrl?: string;
  locationStr?: string;
  capturedAt?: number;
  warning?: string;
  chainUpdated?: boolean;
};

function statusTagClass(status: number) {
  if (status === 0) return "neo-tag-blue";
  if (status === 1 || status === 2) return "neo-tag-yellow";
  if (status === 3) return "neo-tag-green";
  return "neo-tag-red";
}

function getLiveLocation() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 15000,
    });
  });
}

function isPublicProofUrl(value: string | undefined) {
  return !!value && /^https:\/\//i.test(value);
}

export default function CampaignDetail({ wallet }: { wallet: WalletState }) {
  const { address } = useParams<{ address: string }>();
  const { campaign, milestones, loading, refetch } = useCampaign(wallet.provider, address, wallet.account);
  
  const [donateAmount, setDonateAmount] = useState("");
  const [isDonating, setIsDonating] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [evidenceImage, setEvidenceImage] = useState("");
  const [evidenceMilestoneId, setEvidenceMilestoneId] = useState<number | null>(null);
  const [locationStr, setLocationStr] = useState("");
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [openingCamera, setOpeningCamera] = useState(false);
  const [submittingMilestone, setSubmittingMilestone] = useState<number | null>(null);
  const [oracleResults, setOracleResults] = useState<Record<number, OracleResult>>({});

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };

  useEffect(() => {
    if (!videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
    videoRef.current.play().catch(() => toast.error("Camera preview could not start."));
  }, [evidenceMilestoneId]);

  useEffect(() => stopCamera, []);

  useEffect(() => {
    if (!address || milestones.length === 0) return;

    let active = true;
    Promise.all(
      milestones.filter((milestone) => milestone.id > 0).map(async (milestone) => {
        const response = await fetch(`/api/analyze?campaignAddress=${address}&milestoneId=${milestone.id}`);
        if (!response.ok) return null;
        const review = await response.json();
        return [milestone.id, {
          exists: true,
          approved: !!review.approved,
          decision: review.decision,
          summary: review.summary,
          reviewedAt: Number(review.reviewedAt || 0),
          evidenceUrl: review.evidenceUrl,
          locationStr: review.locationStr,
          capturedAt: review.capturedAt,
          warning: review.warning,
          chainUpdated: review.chainUpdated,
        }] as const;
      })
    ).then((rows) => {
      if (!active) return;
      const next = rows.filter(Boolean) as Array<readonly [number, OracleResult]>;
      if (next.length === 0) return;

      setOracleResults((current) => ({
        ...current,
        ...Object.fromEntries(next),
      }));
    }).catch(() => {
      // Reviews are extra context; chain reads should still render without them.
    });

    return () => {
      active = false;
    };
  }, [address, milestones]);

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
  const canCancelStalled = campaign.status === 1 && !!nextMilestone?.deadline && nextMilestone.deadline < now && (nextMilestone.status === 0 || nextMilestone.status === 4);
  const fundraisingFailed = campaign.status === 0 && campaign.campaignDeadline < now && campaign.raisedAmount < bootstrapTarget;

  const handleDonate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    
    try {
      const amount = ethers.parseEther(donateAmount || "0");
      if (amount <= 0n) return toast.error("Enter an ETH amount greater than 0.");

      setIsDonating(true);
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.donate({ value: amount });
      
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

  const handleOpenCamera = async (milestoneId: number) => {
    if (!navigator.mediaDevices?.getUserMedia) return toast.error("Camera is not supported by this browser.");
    if (!navigator.geolocation) return toast.error("Location permission is not supported by this browser.");

    try {
      setOpeningCamera(true);
      toast.loading("Allow camera and location...", { id: "capture" });

      const position = await getLiveLocation();
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });

      stopCamera();
      streamRef.current = stream;
      setEvidenceImage("");
      setCapturedAt(null);
      setEvidenceMilestoneId(milestoneId);
      setLocationStr(`${position.coords.latitude},${position.coords.longitude}`);
      toast.success("Live camera and location ready.", { id: "capture" });
    } catch {
      stopCamera();
      setEvidenceMilestoneId(null);
      setLocationStr("");
      toast.error("Camera and live location are required.", { id: "capture" });
    } finally {
      setOpeningCamera(false);
    }
  };

  const handleCapturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !locationStr) return toast.error("Camera and location are not ready.");

    const width = Math.min(video.videoWidth, 1280);
    const height = Math.round((video.videoHeight * width) / video.videoWidth);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return toast.error("Could not capture photo.");
    context.drawImage(video, 0, 0, width, height);

    setEvidenceImage(canvas.toDataURL("image/jpeg", 0.82));
    setCapturedAt(Date.now());
    stopCamera();
    toast.success("Live evidence captured.");
  };

  const clearEvidence = () => {
    stopCamera();
    setEvidenceImage("");
    setCapturedAt(null);
    setEvidenceMilestoneId(null);
    setLocationStr("");
  };

  const uploadProof = async (milestoneId: number) => {
    if (!address || !evidenceImage || !capturedAt || !locationStr) {
      throw new Error("Live camera photo and location required");
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "upload",
        campaignAddress: address,
        milestoneId,
        imageB64: evidenceImage,
        locationStr,
        capturedAt,
      }),
    });

    const result = await response.json().catch(() => ({ error: "Proof upload failed" }));
    if (!response.ok || result.error) throw new Error(result.error || "Proof upload failed");
    return result.evidenceUrl as string;
  };

  const sendToOracle = async (milestoneId: number, evidenceUrl: string) => {
    if (!address || !evidenceImage || !capturedAt || !locationStr) {
      throw new Error("Live camera photo and location required");
    }

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review",
        campaignAddress: address,
        milestoneId,
        imageB64: evidenceImage,
        locationStr,
        capturedAt,
        evidenceUrl,
      }),
    });

    const result = await response.json().catch(() => ({ error: "Oracle request failed" }));
    if (!response.ok || result.error) throw new Error(result.error || "Request failed");

    if (result.summary && result.decision) {
      setOracleResults((current) => ({
        ...current,
        [milestoneId]: {
          exists: true,
          approved: result.decision === "APPROVE",
          decision: result.decision,
          summary: result.summary,
          reviewedAt: Math.floor(Date.now() / 1000),
          evidenceUrl: result.evidenceUrl || evidenceUrl,
          warning: result.warning,
          chainUpdated: result.chainUpdated,
        },
      }));
    }

    toast.success(`AI Oracle: ${result.status}`, { id: "submit" });
    if (result.warning) toast(result.warning);
    if (result.chainUpdated !== false) clearEvidence();
  };

  const handleSubmitMilestone = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    if (!evidenceImage || !capturedAt || !locationStr || evidenceMilestoneId !== milestoneId) {
      return toast.error("Live camera photo and location required");
    }

    try {
      setSubmittingMilestone(milestoneId);

      toast.loading("Uploading public proof...", { id: "submit" });
      const evidenceUrl = await uploadProof(milestoneId);
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const tx = await contract.submitMilestone(milestoneId, evidenceUrl);
      
      toast.loading("Submitting to blockchain...", { id: "submit" });
      await tx.wait();
      toast.success("Submitted on-chain! Sending to AI Oracle...", { id: "submit" });

      try {
        await sendToOracle(milestoneId, evidenceUrl);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Request failed";
        toast.error(`Oracle Error: ${message}. Retry in a few seconds.`, { id: "submit" });
      }
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to submit", { id: "submit" });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const handleRetryOracle = async (milestoneId: number) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    if (!evidenceImage || !capturedAt || !locationStr || evidenceMilestoneId !== milestoneId) {
      return toast.error("Capture a fresh live photo first");
    }

    try {
      setSubmittingMilestone(milestoneId);
      toast.loading("Uploading public proof...", { id: "submit" });
      const evidenceUrl = await uploadProof(milestoneId);
      toast.loading("Sending to AI Oracle...", { id: "submit" });
      await sendToOracle(milestoneId, evidenceUrl);
      refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Oracle request failed";
      toast.error(`Oracle Error: ${message}`, { id: "submit" });
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
      toast.success("No vote recorded. Final outcome still waits for 24 hours.", { id: "veto" });
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
      toast.loading("Finalizing 24-hour review...", { id: "execute" });
      await tx.wait();
      toast.success("Review finalized.", { id: "execute" });
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
              min="0.000001"
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
        {milestones.map((milestone) => {
          const offchainReview = oracleResults[milestone.id];
          const chainReview: OracleResult | undefined = milestone.aiReview?.exists
            ? {
                ...milestone.aiReview,
                decision: milestone.aiReview.approved ? "APPROVE" : "REJECT",
                chainUpdated: true,
              }
            : undefined;
          const review = offchainReview || chainReview;
          const canSubmitProof = isNgo && milestone.id > 0 && (milestone.status === 0 || milestone.status === 1 || milestone.status === 4);
          const proofUrl = isPublicProofUrl(milestone.evidenceUrl)
            ? milestone.evidenceUrl
            : isPublicProofUrl(offchainReview?.evidenceUrl) ? offchainReview.evidenceUrl : "";
          const proofMissing = milestone.id > 0 && milestone.status > 0 && !proofUrl;
          const reviewColor = review ? (review.approved ? "var(--success)" : "var(--danger)") : "var(--warning)";

          return (
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

              {proofUrl && (
                <div className="proof-box mb-4">
                  <img src={proofUrl} alt={`${milestone.title} proof`} className="proof-image" />
                  <div className="proof-meta">
                    <span>Public proof image</span>
                    <a href={proofUrl} target="_blank" rel="noreferrer" className="text-accent font-bold">
                      Open full image
                    </a>
                  </div>
                </div>
              )}

              {proofMissing && (
                <div className="notice-box mb-4">
                  This older submission did not store a public proof image. The NGO must capture fresh live evidence so voters can inspect the photo.
                </div>
              )}

              {canSubmitProof && (
                <div className="camera-box mt-4">
                  {evidenceMilestoneId === milestone.id && !evidenceImage && (
                    <video ref={videoRef} className="camera-preview" playsInline muted autoPlay />
                  )}

                  {evidenceMilestoneId === milestone.id && evidenceImage && (
                    <img src={evidenceImage} alt="Live milestone evidence" className="camera-preview" />
                  )}

                  <div className="flex gap-2 items-center">
                    <button
                      className="neo-btn neo-btn-outline"
                      disabled={openingCamera || submittingMilestone === milestone.id}
                      onClick={() => handleOpenCamera(milestone.id)}
                    >
                      {openingCamera && evidenceMilestoneId === milestone.id ? "Opening..." : "Open Live Camera"}
                    </button>

                    {evidenceMilestoneId === milestone.id && !evidenceImage && streamRef.current && (
                      <button className="neo-btn neo-btn-primary" onClick={handleCapturePhoto}>
                        Capture Photo
                      </button>
                    )}

                    {evidenceMilestoneId === milestone.id && evidenceImage && (
                      <button
                        className="neo-btn neo-btn-primary"
                        disabled={submittingMilestone === milestone.id}
                        onClick={() => milestone.status === 1 ? handleRetryOracle(milestone.id) : handleSubmitMilestone(milestone.id)}
                      >
                        {milestone.status === 1 ? "Retry AI Oracle" : "Submit Evidence"}
                      </button>
                    )}

                    {evidenceMilestoneId === milestone.id && (
                      <button className="neo-btn neo-btn-outline" onClick={clearEvidence}>
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              )}

              {milestone.status === 1 && (
                <div className="review-box mt-4">
                  <p className="mb-2 text-sm font-bold" style={{ color: reviewColor }}>
                    {review
                      ? `AI analyzed this proof and recommends ${review.approved ? "approval" : "rejection"}.`
                      : "Proof is submitted on-chain. AI Oracle review is pending."}
                  </p>
                  {review?.summary && (
                    <p className="text-xs text-secondary whitespace-pre-line">{review.summary}</p>
                  )}
                  {review?.warning && (
                    <p className="text-xs text-secondary mt-2">{review.warning}</p>
                  )}
                  {proofUrl && (
                    <p className="text-xs text-secondary mt-2">
                      Donors can see the proof image above. Voting starts after the oracle writes the review on-chain.
                    </p>
                  )}
                  {review && (
                    <p className="text-xs text-secondary mt-2">
                      The vote button appears only after the smart contract status changes from Submitted to 24h Review.
                    </p>
                  )}
                  {isNgo && (
                    <p className="text-xs text-secondary mt-2">
                      If this stays here after an oracle error, capture a fresh live photo above and retry the AI Oracle.
                    </p>
                  )}
                </div>
              )}

              {milestone.status === 2 && (
                <div className="review-box mt-4">
                  <p className="mb-2 text-sm font-bold" style={{ color: reviewColor }}>
                    {review ? `AI recommends ${review.approved ? "approval" : "rejection"}.` : "AI review recorded."} 24-hour donor review active.
                  </p>
                  {review?.summary ? (
                    <p className="text-xs mb-3 text-secondary whitespace-pre-line">{review.summary}</p>
                  ) : (
                    <p className="text-xs mb-3 text-secondary">
                      The vote window is open. AI analysis is loading from review storage.
                    </p>
                  )}
                  <p className="text-xs mb-4 text-secondary">
                    Final outcome can be announced after {new Date(milestone.vetoEndsAt * 1000).toLocaleString()}. Not voting accepts the AI recommendation. Veto votes recorded: {milestone.vetoVotes}/{milestone.donorCount || "?"}.
                  </p>
                  {(isDonor || isNgo) && (
                    <div className="notice-box mb-4">
                      {isNgo
                        ? "Donors and the NGO should watch this review window. Nothing becomes final until the 24 hours finish."
                      : "You are a donor. Vote no only if you want to block this milestone; doing nothing counts as yes."}
                    </div>
                  )}
                  {!wallet.account && (
                    <div className="notice-box mb-4">
                      Connect the donor wallet used for this campaign to vote no. Anyone can still inspect the proof and AI analysis.
                    </div>
                  )}
                  {wallet.account && !isDonor && !isNgo && (
                    <div className="notice-box mb-4">
                      Only donors in this campaign can vote. This wallet can view the proof, but cannot cast a veto.
                    </div>
                  )}
                  <div className="flex gap-4 mt-4">
                    {isDonor && (
                      <button
                        className="neo-btn neo-btn-danger"
                        disabled={milestone.hasVetoed || milestone.vetoEndsAt <= now}
                        onClick={() => handleVeto(milestone.id)}
                      >
                        {milestone.hasVetoed ? "No Vote Recorded" : "Vote No / Veto"}
                      </button>
                    )}
                    <button
                      className="neo-btn neo-btn-primary"
                      disabled={milestone.vetoEndsAt > now}
                      onClick={() => handleExecute(milestone.id)}
                    >
                      {milestone.vetoEndsAt > now ? "Waiting for 24 Hours" : review?.approved === false ? "Finalize Rejection" : "Finalize / Release Funds"}
                    </button>
                  </div>
                </div>
              )}

              {milestone.status === 4 && (
                <div className="review-box mt-4">
                  <p className="mb-2 text-sm font-bold" style={{ color: 'var(--danger)' }}>
                    Final outcome: rejected.
                  </p>
                  {review?.summary ? (
                    <p className="text-xs text-secondary whitespace-pre-line">{review.summary}</p>
                  ) : (
                    <p className="text-xs text-secondary">
                      This older campaign was rejected by a legacy oracle contract that did not save the AI explanation or wait through the new 24-hour rejection review. The NGO can submit fresh live evidence before the deadline.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
