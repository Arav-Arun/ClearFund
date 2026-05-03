const env = import.meta.env;

export const FACTORY_ADDRESS = (
  env.VITE_FACTORY_ADDRESS ||
  "0x412A33fbcaa3Ac0f6E5a0255F9779aAB8E8e1470"
).trim();

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
  "function donations(address) view returns (uint256)",
  "event DonationReceived(address indexed, uint256)",
  "event CampaignStarted()",
  "event MilestoneSubmitted(uint256 indexed, string)",
  "event OracleDecision(uint256 indexed, bool)",
  "event VetoCast(address indexed, uint256 indexed)",
  "event FundsReleased(uint256 indexed, uint256)",
  "event CampaignCancelled()",
] as const;
