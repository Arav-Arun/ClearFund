import { useCallback, useEffect, useMemo, useState } from "react";
import { getDefaultConfig, useConnectModal } from "@rainbow-me/rainbowkit";
import { ethers } from "ethers";
import { http } from "wagmi";
import { useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";

const env = import.meta.env;

function envValue(key: string) {
  return String(env[key] || "").trim();
}

function splitAddresses(value: string) {
  return value.split(",").map((address) => address.trim()).filter(Boolean);
}

function addressSet(value: string) {
  return new Set(splitAddresses(value).map((address) => address.toLowerCase()));
}

const BLOCKED_FACTORY_ADDRESSES = addressSet(envValue("VITE_BLOCKED_FACTORY_ADDRESSES"));
const SUPERSEDED_FACTORY_ADDRESSES = addressSet(envValue("VITE_SUPERSEDED_FACTORY_ADDRESSES"));

function factoryForCreation(address: string) {
  const trimmed = address.trim();
  const key = trimmed.toLowerCase();

  if (!ethers.isAddress(trimmed)) return "";
  if (BLOCKED_FACTORY_ADDRESSES.has(key) || SUPERSEDED_FACTORY_ADDRESSES.has(key)) {
    return "";
  }

  return trimmed;
}

export const FACTORY_ADDRESS = factoryForCreation(envValue("VITE_FACTORY_ADDRESS"));

function uniqueAddresses(addresses: string[]) {
  const seen = new Set<string>();

  return addresses.map((address) => address.trim()).filter((address) => {
    if (!ethers.isAddress(address)) return false;

    const key = address.toLowerCase();
    if (BLOCKED_FACTORY_ADDRESSES.has(key)) return false;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

export const FACTORY_ADDRESSES = uniqueAddresses([
  FACTORY_ADDRESS,
  ...splitAddresses(envValue("VITE_FACTORY_ADDRESSES")),
]);

export const BLOCK_EXPLORER_URL = envValue("VITE_BLOCK_EXPLORER_URL");

export const READONLY_SEPOLIA_RPC = envValue("VITE_SEPOLIA_RPC_URL");

export const WALLETCONNECT_PROJECT_ID = envValue("VITE_WALLETCONNECT_PROJECT_ID");

export const SEPOLIA_CHAIN_ID = 11155111;

export const CAMPAIGN_STATUS = [
  "Accepting Donations",
  "In Progress",
  "Completed",
  "Cancelled",
] as const;

export const MILESTONE_STATUS = [
  "Pending",
  "Submitted",
  "24h Review",
  "Approved",
  "Rejected",
] as const;

export const FACTORY_ABI = [
  `function createCampaign(
    string _title,
    string _description,
    string _ngoName,
    uint256 _bootstrapPercent,
    tuple(
      string title,
      string description,
      uint256 fundPercent,
      uint256 deadline
    )[] _milestones,
    uint256 _goalAmount,
    uint256 _campaignDeadline
  ) external returns (address)`,
  "function getAllCampaigns() view returns (address[])",
  "function getCampaignCount() view returns (uint256)",
  "function getCampaignsByNGO(address) view returns (address[])",
  "event CampaignCreated(address indexed, address indexed)",
  "event CampaignCreated(address indexed, address indexed, string)",
] as const;

export const CAMPAIGN_ABI = [
  "function donate() payable",
  "function startCampaign() external",
  "function submitMilestone(uint256, string) external",
  "function vetoMilestone(uint256) external",
  "function executeMilestone(uint256) external",
  "function cancelStalledCampaign() external",
  "function refund() external",
  `function getCampaign() view returns (
    tuple(
      address ngoAddress,
      string title,
      string description,
      string ngoName,
      uint256 goalAmount,
      uint256 raisedAmount,
      uint256 campaignDeadline,
      uint256 bootstrapPercent,
      uint8 status,
      uint256 milestoneCount
    )
  )`,
  `function getAllMilestones() view returns (
    tuple(
      string title,
      string description,
      uint256 fundPercent,
      uint256 deadline,
      uint8 status,
      string evidenceUrl,
      uint256 vetoEndsAt
    )[]
  )`,
  "function getDonation(address) view returns (uint256)",
  "function getDonors() view returns (address[])",
  "function getAIReview(uint256) view returns (tuple(bool exists,bool approved,string summary,uint256 reviewedAt))",
  "function getVetoInfo(uint256,address) view returns (uint256 donorCount,uint256 currentVetoVotes,bool voterHasVetoed,uint256 vetoEndsAt)",
  "function donations(address) view returns (uint256)",
  "event DonationReceived(address indexed, uint256)",
  "event CampaignStarted()",
  "event MilestoneSubmitted(uint256 indexed, string)",
  "event OracleDecision(uint256 indexed, bool)",
  "event OracleReview(uint256 indexed, bool, string)",
  "event VetoWindowOpened(uint256 indexed, uint256, address, uint256)",
  "event VetoCast(address indexed, uint256 indexed)",
  "event VetoMajorityReached(uint256 indexed, uint256, uint256)",
  "event FundsReleased(uint256 indexed, uint256)",
  "event CampaignCancelled()",
] as const;

export interface CampaignInfo {
  address: string;
  factoryAddress: string;
  ngoAddress: string;
  title: string;
  description: string;
  ngoName: string;
  goalAmount: bigint;
  raisedAmount: bigint;
  campaignDeadline: number;
  bootstrapPercent: number;
  bootstrapReleased?: boolean;
  status: number;
  milestoneCount: number;
  userDonation?: bigint;
}

export interface MilestoneInfo {
  id: number;
  title: string;
  description: string;
  fundPercent: number;
  deadline: number;
  status: number;
  evidenceUrl: string;
  vetoEndsAt: number;
  donorCount: number;
  vetoVotes: number;
  hasVetoed: boolean;
  aiReview?: AIReviewInfo;
}

export interface AIReviewInfo {
  exists: boolean;
  approved: boolean;
  summary: string;
  reviewedAt: number;
}

export interface WalletState {
  account: string | null;
  provider: ethers.AbstractProvider | null;
  signer: ethers.Signer | null;
  chainId: number | null;
  isConnecting: boolean;
  isWrongNetwork: boolean;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchToSepolia: () => Promise<void>;
}

type CampaignRow = {
  ngoAddress: string;
  title: string;
  description: string;
  ngoName: string;
  goalAmount: bigint;
  raisedAmount: bigint;
  campaignDeadline: bigint;
  bootstrapPercent: bigint;
  status: bigint;
  milestoneCount: bigint;
};

type MilestoneRow = {
  title: string;
  description: string;
  fundPercent: bigint;
  deadline: bigint;
  status: bigint;
  evidenceUrl: string;
  vetoEndsAt: bigint;
};

type VetoRow = {
  donorCount: bigint;
  currentVetoVotes: bigint;
  voterHasVetoed: boolean;
  vetoEndsAt: bigint;
};

type AIReviewRow = {
  exists: boolean;
  approved: boolean;
  summary: string;
  reviewedAt: bigint;
};

export const wagmiConfig = getDefaultConfig({
  appName: "ClearFund",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [sepolia],
  transports: { [sepolia.id]: READONLY_SEPOLIA_RPC ? http(READONLY_SEPOLIA_RPC) : http() },
});

export function formatEth(value: bigint, maxDecimals = 4): string {
  const num = Number(ethers.formatEther(value));
  if (!Number.isFinite(num)) return "0";

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
}

export function humanError(err: unknown, fallback = "Something went wrong. Please try again.") {
  const error = err as {
    reason?: string;
    shortMessage?: string;
    message?: string;
    data?: { message?: string };
    info?: { error?: { message?: string } };
  };
  const raw = String(
    typeof err === "string"
      ? err
      : error?.reason || error?.shortMessage || error?.info?.error?.message || error?.data?.message || error?.message || ""
  );
  const message = raw.replace(/\s*\(transaction=\{[\s\S]*/i, "").replace(/\s*\{[\s\S]*/i, "").trim();

  if (!message) return fallback;
  if (/user rejected|user denied|rejected the request|action rejected/i.test(message)) {
    return "Transaction cancelled in your wallet.";
  }
  if (/insufficient funds/i.test(message)) {
    return "This wallet does not have enough Sepolia ETH for the amount plus gas.";
  }
  if (/invalid (fixednumber|string|decimal|value)|invalid number|not a valid number/i.test(message)) {
    return "Enter a valid number.";
  }
  if (/nonce|replacement fee|underpriced/i.test(message)) {
    return "Your wallet has a pending transaction. Wait a moment and try again.";
  }

  const friendlyContracts: Array<[RegExp, string]> = [
    [/Campaign: NGO cannot donate/i, "The NGO wallet cannot donate to its own campaign."],
    [/Campaign: deadline passed/i, "This deadline has already passed."],
    [/Campaign: invalid status/i, "This action is not available for the campaign right now."],
    [/Campaign: caller is not the NGO/i, "Only the NGO wallet can do this."],
    [/Campaign: caller is not a donor/i, "Only donors in this campaign can do this."],
    [/Campaign: previous not approved/i, "The previous milestone must be approved first."],
    [/Campaign: not submittable/i, "This milestone is not ready for a new proof."],
    [/Campaign: milestone deadline passed/i, "This milestone deadline has passed."],
    [/Campaign: not submitted/i, "Submit proof before asking the oracle to review it."],
    [/Campaign: veto period active/i, "The 24-hour review window is still active."],
    [/Campaign: not in veto phase/i, "Voting is not open for this milestone right now."],
    [/Campaign: already voted/i, "This wallet already voted no for this review."],
    [/Campaign: refund not available/i, "Refunds are not available for this campaign yet."],
    [/Campaign: refunded/i, "This wallet already claimed its refund."],
    [/Factory: milestone percent too small/i, "Each milestone must receive at least 1% after the bootstrap split."],
    [/Factory: milestone percentages must sum to 100/i, "Milestone percentages must add up to 100%."],
    [/Factory: 2-5 milestones required/i, "Create between 2 and 5 milestones."],
    [/Factory: bootstrap must be 1-15/i, "Bootstrap must be between 1% and 15%."],
    [/Proof storage is not configured/i, "Proof storage is not configured on Vercel."],
    [/NGO wallet signature is required/i, "Please sign the proof request with the NGO wallet."],
    [/Only the campaign NGO can submit proof/i, "Only the campaign NGO wallet can submit proof to the oracle."],
    [/Stored proof metadata does not match/i, "The stored proof does not match the on-chain proof. Capture and submit fresh proof."],
    [/Oracle proof does not match/i, "The oracle can only review the proof URL stored on-chain."],
  ];

  for (const [pattern, text] of friendlyContracts) {
    if (pattern.test(message)) return text;
  }

  const revert = message.match(/(?:execution reverted:|reverted with reason string)\s*['"]?([^'"]+)/i);
  const cleaned = (revert?.[1] || message).replace(/^Error:\s*/i, "").trim();
  return cleaned.length > 180 ? fallback : cleaned;
}

export function useWallet(): WalletState {
  const { address, chainId, isConnected, isConnecting, isReconnecting } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [error, setError] = useState<string | null>(null);

  const readonlyProvider = useMemo(() => {
    if (!READONLY_SEPOLIA_RPC) return null;
    return new ethers.JsonRpcProvider(READONLY_SEPOLIA_RPC);
  }, []);

  const walletProvider = useMemo(() => {
    if (!walletClient) return null;
    return new ethers.BrowserProvider(
      walletClient.transport as unknown as ethers.Eip1193Provider
    );
  }, [walletClient]);

  useEffect(() => {
    let active = true;

    async function loadSigner() {
      if (!walletProvider || !walletClient?.account.address) {
        setSigner(null);
        return;
      }
      const nextSigner = await walletProvider.getSigner(walletClient.account.address);
      if (active) setSigner(nextSigner);
    }

    loadSigner().catch((err) => {
      console.error(err);
      setError("Could not load wallet signer.");
    });

    return () => {
      active = false;
    };
  }, [walletProvider, walletClient?.account.address]);

  const connect = async () => {
    setError(null);
    openConnectModal?.();
  };

  const switchToSepolia = async () => {
    try {
      await switchChainAsync({ chainId: SEPOLIA_CHAIN_ID });
    } catch (err) {
      console.error(err);
      setError("Could not switch to Sepolia.");
    }
  };

  const account = isConnected && address ? address : null;

  return {
    account,
    provider: chainId === SEPOLIA_CHAIN_ID && walletProvider ? walletProvider : readonlyProvider,
    signer,
    chainId: chainId ?? null,
    isConnecting: isConnecting || isReconnecting,
    isWrongNetwork: !!account && chainId !== SEPOLIA_CHAIN_ID,
    error,
    connect,
    disconnect: () => disconnect(),
    switchToSepolia,
  };
}

function cleanDescription(description: string) {
  return description.replace(/\[PROFILE_CID:.*?\]/g, "").trim();
}

function toCampaignInfo(address: string, factoryAddress: string, info: CampaignRow): CampaignInfo {
  return {
    address,
    factoryAddress,
    ngoAddress: info.ngoAddress,
    title: info.title,
    description: cleanDescription(info.description),
    ngoName: info.ngoName,
    goalAmount: info.goalAmount,
    raisedAmount: info.raisedAmount,
    campaignDeadline: Number(info.campaignDeadline),
    bootstrapPercent: Number(info.bootstrapPercent),
    status: Number(info.status),
    milestoneCount: Number(info.milestoneCount),
  };
}

async function readCampaign(
  provider: ethers.AbstractProvider,
  factoryAddress: string,
  campaignAddress: string
) {
  const contract = new ethers.Contract(campaignAddress, CAMPAIGN_ABI, provider);
  return toCampaignInfo(campaignAddress, factoryAddress, await contract.getCampaign());
}

export function useAllCampaigns(provider: ethers.AbstractProvider | null) {
  const [campaigns, setCampaigns] = useState<CampaignInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!provider) {
      setCampaigns([]);
      setError("Sepolia RPC is not configured. Add VITE_SEPOLIA_RPC_URL or connect a Sepolia wallet.");
      setLoading(false);
      return;
    }

    if (FACTORY_ADDRESSES.length === 0) {
      setCampaigns([]);
      setError("No active factory is configured. Check VITE_FACTORY_ADDRESS.");
      setLoading(false);
      return;
    }

    try {
      const results = await Promise.all(
        FACTORY_ADDRESSES.map(async (factoryAddress) => {
          try {
            const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
            const addresses: string[] = await factory.getAllCampaigns();
            const rows = await Promise.allSettled(
              addresses.map((address) => readCampaign(provider, factoryAddress, address))
            );

            return {
              ok: true,
              campaigns: rows.flatMap((row) => row.status === "fulfilled" ? [row.value] : []),
            };
          } catch (err) {
            console.error("Could not read factory:", factoryAddress, err);
            return { ok: false, campaigns: [] };
          }
        })
      );
      const loaded = results.flatMap((result) => result.campaigns);
      const failedFactories = results.filter((result) => !result.ok).length;

      const deduped = Array.from(
        new Map(loaded.map((campaign) => [campaign.address.toLowerCase(), campaign])).values()
      );
      setCampaigns(deduped);
      if (failedFactories === results.length) {
        setError("Could not read any configured factory. Check VITE_FACTORY_ADDRESSES and the Sepolia RPC.");
      }
    } catch (err) {
      console.error(err);
      setError("Could not load campaigns. Check the Sepolia RPC URL.");
      setCampaigns([]);
    } finally {
      setLoading(false);
    }
  }, [provider]);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  return { campaigns, loading, error, refetch: fetchCampaigns };
}

export function useCampaign(
  provider: ethers.AbstractProvider | null,
  address: string | undefined,
  account?: string | null
) {
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
      const info = toCampaignInfo(address, "", await contract.getCampaign());
      if (account) {
        info.userDonation = await contract.getDonation(account);
      }
      setCampaign(info);

      const rows = await contract.getAllMilestones();
      setMilestones(
        await Promise.all(
          rows.map(async (milestone: MilestoneRow, id: number) => {
            let vetoInfo: VetoRow = {
              donorCount: 0n,
              currentVetoVotes: 0n,
              voterHasVetoed: false,
              vetoEndsAt: milestone.vetoEndsAt,
            };

            try {
              vetoInfo = await contract.getVetoInfo(id, account || ethers.ZeroAddress);
            } catch {
              // Older deployed campaigns do not expose getVetoInfo yet.
            }

            let aiReview: AIReviewInfo | undefined;
            try {
              const review: AIReviewRow = await contract.getAIReview(id);
              aiReview = {
                exists: review.exists,
                approved: review.approved,
                summary: review.summary,
                reviewedAt: Number(review.reviewedAt),
              };
            } catch {
              // Older deployed campaigns do not store AI review summaries.
            }

            return {
              id,
              title: milestone.title,
              description: milestone.description,
              fundPercent: Number(milestone.fundPercent),
              deadline: Number(milestone.deadline),
              status: Number(milestone.status),
              evidenceUrl: milestone.evidenceUrl,
              vetoEndsAt: Number(vetoInfo.vetoEndsAt || milestone.vetoEndsAt),
              donorCount: Number(vetoInfo.donorCount),
              vetoVotes: Number(vetoInfo.currentVetoVotes),
              hasVetoed: vetoInfo.voterHasVetoed,
              aiReview,
            };
          })
        )
      );
    } catch (err) {
      console.error(err);
      setCampaign(null);
      setMilestones([]);
    } finally {
      setLoading(false);
    }
  }, [provider, address, account]);

  useEffect(() => {
    fetchCampaign();
  }, [fetchCampaign]);

  return { campaign, milestones, loading, refetch: fetchCampaign };
}
