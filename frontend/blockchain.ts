import { useCallback, useEffect, useMemo, useState } from "react";
import { getDefaultConfig, useConnectModal } from "@rainbow-me/rainbowkit";
import { ethers } from "ethers";
import { http } from "wagmi";
import { useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";

const env = import.meta.env;

export const FACTORY_ADDRESS = (
  env.VITE_FACTORY_ADDRESS ||
  "0x9F2F3AEF7960eBf8f578d7174FB8f3135394b398"
).trim();

const LEGACY_FACTORY_ADDRESSES = [
  "0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470",
  "0x6A837595E2592d699d48eB2DAcF47Df9493035d2",
];

function uniqueAddresses(addresses: string[]) {
  const seen = new Set<string>();

  return addresses.map((address) => address.trim()).filter((address) => {
    if (!ethers.isAddress(address)) return false;

    const key = address.toLowerCase();
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

export const FACTORY_ADDRESSES = uniqueAddresses([
  FACTORY_ADDRESS,
  ...(env.VITE_FACTORY_ADDRESSES?.split(",") || LEGACY_FACTORY_ADDRESSES),
]);

export const BLOCK_EXPLORER_URL =
  env.VITE_BLOCK_EXPLORER_URL ||
  "https://sepolia.etherscan.io";

export const READONLY_SEPOLIA_RPC =
  env.VITE_SEPOLIA_RPC_URL ||
  "https://ethereum-sepolia-rpc.publicnode.com";

export const WALLETCONNECT_PROJECT_ID = (
  env.VITE_WALLETCONNECT_PROJECT_ID ||
  "clearfund-development"
).trim();

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
  "In Veto",
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
  "function getVetoInfo(uint256,address) view returns (uint256 donorCount,uint256 currentVetoVotes,bool voterHasVetoed,uint256 vetoEndsAt)",
  "function donations(address) view returns (uint256)",
  "event DonationReceived(address indexed, uint256)",
  "event CampaignStarted()",
  "event MilestoneSubmitted(uint256 indexed, string)",
  "event OracleDecision(uint256 indexed, bool)",
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

export const wagmiConfig = getDefaultConfig({
  appName: "ClearFund",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [sepolia],
  transports: { [sepolia.id]: http(READONLY_SEPOLIA_RPC) },
});

export function formatEth(value: bigint, maxDecimals = 4): string {
  const num = Number(ethers.formatEther(value));
  if (!Number.isFinite(num)) return "0";

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(num);
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
    if (!provider) return;
    setLoading(true);
    setError(null);

    try {
      const loaded = (
        await Promise.all(
          FACTORY_ADDRESSES.map(async (factoryAddress) => {
            try {
              const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
              const addresses: string[] = await factory.getAllCampaigns();
              const rows = await Promise.allSettled(
                addresses.map((address) => readCampaign(provider, factoryAddress, address))
              );

              return rows.flatMap((row) => row.status === "fulfilled" ? [row.value] : []);
            } catch (err) {
              console.error("Could not read factory:", factoryAddress, err);
              return [];
            }
          })
        )
      ).flat();

      const deduped = Array.from(
        new Map(loaded.map((campaign) => [campaign.address.toLowerCase(), campaign])).values()
      );
      setCampaigns(deduped);
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
