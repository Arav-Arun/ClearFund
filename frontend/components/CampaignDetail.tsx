import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";
import {
  CAMPAIGN_ABI,
  CAMPAIGN_STATUS,
  MILESTONE_STATUS,
  formatEth,
  humanError,
  useCampaign,
} from "../blockchain";
import type { AIReviewInfo, WalletState } from "../blockchain";
import { toast } from "react-hot-toast";

type OracleResult = AIReviewInfo & {
  decision?: string;
  evidenceUrl?: string;
  locationStr?: string;
  capturedAt?: number;
  reviewUrl?: string;
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

function reviewSummary(summary: string | undefined) {
  const text = String(summary || "").trim();
  return /No AI analysis was returned|AI review was inconclusive|oracle response could not be parsed/i.test(text) ? "" : text;
}

function hasAiAnalysis(review: OracleResult | undefined) {
  return !!reviewSummary(review?.summary) && (review?.decision === "APPROVE" || review?.decision === "REJECT");
}

function mapLocation(value: string | undefined) {
  const [lat, lng] = String(value || "").split(",").map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return null;
  }

  return {
    label: `${lat}, ${lng}`,
    url: `https://www.google.com/maps?q=${lat},${lng}`,
  };
}

function formatTime(value: number | undefined, unit: "ms" | "s") {
  if (!value) return "";
  return new Date(unit === "s" ? value * 1000 : value).toLocaleString();
}

function oracleAuthMessage({
  action,
  campaignAddress,
  milestoneId,
  evidenceUrl = "",
  locationStr = "",
  capturedAt = 0,
  imageHash = "",
}: {
  action: string;
  campaignAddress: string;
  milestoneId: number;
  evidenceUrl?: string;
  locationStr?: string;
  capturedAt?: number;
  imageHash?: string;
}) {
  return [
    "ClearFund oracle request",
    `Action: ${action}`,
    `Campaign: ${campaignAddress}`,
    `Milestone: ${milestoneId}`,
    `Evidence: ${evidenceUrl}`,
    `Location: ${locationStr}`,
    `Captured: ${capturedAt}`,
    `ImageHash: ${imageHash}`,
  ].join("\n");
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
  const [capturingPhoto, setCapturingPhoto] = useState(false);
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
    setOracleResults({});
  }, [address]);

  useEffect(() => {
    if (!address || milestones.length === 0) return;

    let active = true;
    const reviewMilestones = milestones.filter((milestone) => milestone.id > 0 && milestone.status > 0);
    const reviewIds = new Set(reviewMilestones.map((milestone) => milestone.id));
    Promise.all(
      reviewMilestones.map(async (milestone) => {
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
          reviewUrl: review.reviewUrl,
          warning: review.warning,
          chainUpdated: review.chainUpdated,
        }] as const;
      })
    ).then((rows) => {
      if (!active) return;
      const next = rows.filter(Boolean) as Array<readonly [number, OracleResult]>;

      setOracleResults((current) => ({
        ...Object.fromEntries(
          Object.entries(current).filter(([milestoneId]) => reviewIds.has(Number(milestoneId)))
        ),
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
    if (!wallet.signer || !wallet.provider || !wallet.account || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    
    try {
      let amount: bigint;
      try {
        amount = ethers.parseEther(donateAmount || "0");
      } catch {
        toast.error("Enter a valid ETH amount.", { id: "donate" });
        return;
      }
      if (amount <= 0n) return toast.error("Enter an ETH amount greater than 0.");

      setIsDonating(true);
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, wallet.signer);
      const balance = await wallet.provider.getBalance(wallet.account);

      if (amount >= balance) {
        return toast.error(
          `Wallet balance is ${formatEth(balance, 6)} ETH. Donate less than that so there is ETH left for gas.`,
          { id: "donate" }
        );
      }

      const gas = await contract.donate.estimateGas({ value: amount });
      const feeData = await wallet.provider.getFeeData();
      const gasPrice = feeData.maxFeePerGas || feeData.gasPrice || 0n;
      const needed = amount + gas * gasPrice;

      if (gasPrice > 0n && balance < needed) {
        return toast.error(
          `Wallet balance is ${formatEth(balance, 6)} ETH, but this donation needs about ${formatEth(needed, 6)} ETH with gas.`,
          { id: "donate" }
        );
      }

      const tx = await contract.donate({ value: amount });
      
      toast.loading("Donating...", { id: "donate" });
      await tx.wait();
      toast.success("Donation successful!", { id: "donate" });
      
      setDonateAmount("");
      refetch();
    } catch (err: unknown) {
      toast.error(humanError(err, "Donation failed"), { id: "donate" });
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
      toast.error(humanError(err, "Failed to start"), { id: "start" });
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
      toast.error(humanError(err, "Failed to cancel"), { id: "cancel" });
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
      toast.error(humanError(err, "Refund failed"), { id: "refund" });
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

  const handleCapturePhoto = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return toast.error("Camera is not ready.");

    try {
      setCapturingPhoto(true);
      const position = await getLiveLocation();
      const width = Math.min(video.videoWidth, 1280);
      const height = Math.round((video.videoHeight * width) / video.videoWidth);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return toast.error("Could not capture photo.");
      context.drawImage(video, 0, 0, width, height);

      setLocationStr(`${position.coords.latitude},${position.coords.longitude}`);
      setEvidenceImage(canvas.toDataURL("image/jpeg", 0.82));
      setCapturedAt(Date.now());
      stopCamera();
      toast.success("Live evidence and GPS captured.");
    } catch {
      toast.error("Live location is required at capture time.");
    } finally {
      setCapturingPhoto(false);
    }
  };

  const clearEvidence = () => {
    stopCamera();
    setEvidenceImage("");
    setCapturedAt(null);
    setEvidenceMilestoneId(null);
    setLocationStr("");
  };

  const uploadProof = async (milestoneId: number) => {
    if (!wallet.signer || !address || !evidenceImage || !capturedAt || !locationStr) {
      throw new Error("Live camera photo and location required");
    }
    const signature = await wallet.signer.signMessage(oracleAuthMessage({
      action: "upload",
      campaignAddress: address,
      milestoneId,
      locationStr,
      capturedAt,
      imageHash: ethers.id(evidenceImage),
    }));

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
        signature,
      }),
    });

    const result = await response.json().catch(() => ({ error: "Proof upload failed" }));
    if (!response.ok || result.error) throw new Error(result.error || "Proof upload failed");
    return result.evidenceUrl as string;
  };

  const sendToOracle = async (milestoneId: number, evidenceUrl: string) => {
    if (!wallet.signer || !address || !evidenceUrl) {
      throw new Error("Public proof URL required");
    }
    const signature = await wallet.signer.signMessage(oracleAuthMessage({
      action: "review",
      campaignAddress: address,
      milestoneId,
      evidenceUrl,
    }));

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "review",
        campaignAddress: address,
        milestoneId,
        evidenceUrl,
        signature,
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
          reviewedAt: Number(result.reviewedAt || Math.floor(Date.now() / 1000)),
          evidenceUrl: result.evidenceUrl || evidenceUrl,
          locationStr: result.locationStr,
          capturedAt: Number(result.capturedAt || 0),
          reviewUrl: result.reviewUrl,
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
        const message = humanError(err, "Request failed");
        toast.error(`Oracle Error: ${message}. Retry in a few seconds.`, { id: "submit" });
      }
      refetch();
    } catch (err: unknown) {
      toast.error(humanError(err, "Failed to submit"), { id: "submit" });
    } finally {
      setSubmittingMilestone(null);
    }
  };

  const handleRetryOracle = async (milestoneId: number, evidenceUrl: string) => {
    if (!wallet.signer || !address) return toast.error("Connect wallet first");
    if (wallet.isWrongNetwork) return toast.error("Switch to Sepolia first");
    if (!evidenceUrl) {
      return toast.error("No public proof URL is stored on-chain for this milestone.");
    }

    try {
      setSubmittingMilestone(milestoneId);
      toast.loading("Retrying AI Oracle on the on-chain proof...", { id: "submit" });
      await sendToOracle(milestoneId, evidenceUrl);
      refetch();
    } catch (err: unknown) {
      const message = humanError(err, "Oracle request failed");
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
      toast.error(humanError(err, "Veto failed"), { id: "veto" });
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
      toast.error(humanError(err, "Execute failed"), { id: "execute" });
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
          <form onSubmit={handleDonate} className="flex gap-4 mb-4" noValidate>
            <input
              type="number"
              className="neo-input flex-1"
              step="any"
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
          const canSubmitProof = isNgo && milestone.id > 0 && (milestone.status === 0 || milestone.status === 4);
          const onchainProofUrl = isPublicProofUrl(milestone.evidenceUrl) ? milestone.evidenceUrl : "";
          const storedProofMatchesChain = milestone.status > 0
            && isPublicProofUrl(offchainReview?.evidenceUrl)
            && (!milestone.evidenceUrl || offchainReview?.evidenceUrl === milestone.evidenceUrl);
          const storedProofUrl = storedProofMatchesChain ? offchainReview?.evidenceUrl || "" : "";
          const proofUrl = onchainProofUrl || storedProofUrl;
          const proofMissing = milestone.id > 0 && milestone.status > 0 && !proofUrl;
          const legacySubmittedWithoutProof = milestone.status === 1 && proofMissing;
          const aiReady = hasAiAnalysis(review);
          const summary = reviewSummary(review?.summary);
          const reviewColor = aiReady ? (review?.approved ? "var(--success)" : "var(--danger)") : "var(--warning)";
          const location = mapLocation(review?.locationStr);
          const capturedTime = formatTime(review?.capturedAt, "ms");
          const reviewedTime = formatTime(review?.reviewedAt, "s");
          const publicReviewUrl = offchainReview && address
            ? `/api/analyze?campaignAddress=${address}&milestoneId=${milestone.id}`
            : "";

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
                  {(capturedTime || location || reviewedTime || publicReviewUrl) && (
                    <div className="proof-data">
                      {capturedTime && (
                        <div>
                          <strong>Captured</strong>
                          <span>{capturedTime}</span>
                        </div>
                      )}
                      {location && (
                        <div>
                          <strong>Live GPS</strong>
                          <span className="font-mono">{location.label}</span>
                          <a href={location.url} target="_blank" rel="noreferrer">Open map</a>
                        </div>
                      )}
                      {reviewedTime && (
                        <div>
                          <strong>AI reviewed</strong>
                          <span>{reviewedTime}</span>
                        </div>
                      )}
                      {publicReviewUrl && (
                        <div>
                          <strong>Review data</strong>
                          <a href={publicReviewUrl} target="_blank" rel="noreferrer">Open JSON</a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {proofMissing && (
                <div className="notice-box mb-4">
                  This older submission did not store a public proof URL, so ClearFund cannot show the photo, GPS data, or AI review for this exact proof. New submissions from the latest flow require live camera, live GPS, public proof storage, AI analysis, and a 24-hour donor review.
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
                      <button className="neo-btn neo-btn-primary" disabled={capturingPhoto} onClick={handleCapturePhoto}>
                        {capturingPhoto ? "Capturing..." : "Capture Photo"}
                      </button>
                    )}

                    {evidenceMilestoneId === milestone.id && evidenceImage && (
                      <button
                        className="neo-btn neo-btn-primary"
                        disabled={submittingMilestone === milestone.id}
                        onClick={() => handleSubmitMilestone(milestone.id)}
                      >
                        Submit Evidence
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
                    {legacySubmittedWithoutProof
                      ? "Legacy submission cannot be reviewed because no public proof URL is stored on-chain."
                      : aiReady
                      ? `AI analyzed this proof and recommends ${review?.approved ? "approval" : "rejection"}.`
                      : "Proof is submitted on-chain. AI Oracle review is pending."}
                  </p>
                  {summary && (
                    <p className="text-xs text-secondary whitespace-pre-line">{summary}</p>
                  )}
                  {review?.warning && (
                    <p className="text-xs text-secondary mt-2">{review.warning}</p>
                  )}
                  {proofUrl && !legacySubmittedWithoutProof && (
                    <p className="text-xs text-secondary mt-2">
                      Donors can see the proof image above. Voting starts after the oracle writes the review on-chain.
                    </p>
                  )}
                  {aiReady && !legacySubmittedWithoutProof && (
                    <p className="text-xs text-secondary mt-2">
                      The vote button appears only after the smart contract status changes from Submitted to 24h Review.
                    </p>
                  )}
                  {isNgo && (
                    <div className="mt-4">
                      {proofUrl ? (
                        <button
                          className="neo-btn neo-btn-primary"
                          disabled={submittingMilestone === milestone.id}
                          onClick={() => handleRetryOracle(milestone.id, proofUrl)}
                        >
                          Retry AI Oracle
                        </button>
                      ) : (
                        <p className="text-xs text-secondary">
                          This older submission has no public proof URL, so the oracle cannot safely retry it.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {milestone.status === 2 && (
                <div className="review-box mt-4">
                  <p className="mb-2 text-sm font-bold" style={{ color: reviewColor }}>
                    {aiReady ? `AI recommends ${review?.approved ? "approval" : "rejection"}.` : "AI review recorded."} 24-hour donor review active.
                  </p>
                  {summary ? (
                    <p className="text-xs mb-3 text-secondary whitespace-pre-line">{summary}</p>
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
                  {summary ? (
                    <p className="text-xs text-secondary whitespace-pre-line">{summary}</p>
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
