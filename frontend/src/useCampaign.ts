import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { FACTORY_ADDRESS, FACTORY_ABI, CAMPAIGN_ABI } from "./constants";
import type { CampaignInfo, MilestoneInfo } from "./types";

export function useAllCampaigns(provider: ethers.AbstractProvider | null) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampaigns = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);
      const addresses = await factory.getAllCampaigns();

      const loaded = await Promise.all(
        addresses.map(async (address: string) => {
          const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
          const info = await contract.getCampaign();
          return {
            address,
            ngoAddress: info.ngoAddress,
            title: info.title,
            description: info.description.replace(/\[PROFILE_CID:.*?\]/g, "").trim(),
            ngoName: info.ngoName,
            goalAmount: info.goalAmount,
            raisedAmount: info.raisedAmount,
            campaignDeadline: Number(info.campaignDeadline),
            bootstrapPercent: Number(info.bootstrapPercent),
            status: Number(info.status),
            milestoneCount: Number(info.milestoneCount),
          } as CampaignInfo;
        })
      );
      setCampaigns(loaded);
    } catch (err) {
      console.error(err);
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  return { campaigns, loading, refetch: fetchCampaigns };
}

export function useCampaign(provider: ethers.AbstractProvider | null, address: string | undefined) {
  const [campaign, setCampaign] = useState<CampaignInfo | null>(null);
  const [milestones, setMilestones] = useState<MilestoneInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchCampaign = useCallback(async () => {
    if (!provider || !address) {
      setCampaign(null);
      setMilestones([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const contract = new ethers.Contract(address, CAMPAIGN_ABI, provider);
      
      const info = await contract.getCampaign();
      setCampaign({
        address,
        ngoAddress: info.ngoAddress,
        title: info.title,
        description: info.description.replace(/\[PROFILE_CID:.*?\]/g, "").trim(),
        ngoName: info.ngoName,
        goalAmount: info.goalAmount,
        raisedAmount: info.raisedAmount,
        campaignDeadline: Number(info.campaignDeadline),
        bootstrapPercent: Number(info.bootstrapPercent),
        status: Number(info.status),
        milestoneCount: Number(info.milestoneCount),
      } as CampaignInfo);

      const allMilestones = await contract.getAllMilestones();
      setMilestones(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        allMilestones.map((m: any, i: number) => ({
          id: i,
          title: m.title,
          description: m.description,
          fundPercent: Number(m.fundPercent),
          deadline: Number(m.deadline),
          status: Number(m.status),
          evidenceUrl: m.evidenceUrl,
          votesFor: m.votesFor,
          votesAgainst: m.votesAgainst,
          submissionCount: Number(m.submissionCount),
        }))
      );
    } catch (err) {
      console.error(err);
      setCampaign(null);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  }, [provider, address]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  return { campaign, milestones, loading, refetch: fetchCampaign };
}
