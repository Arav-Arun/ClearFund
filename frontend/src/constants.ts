// ── Environment config ──

const env = import.meta.env;

export const FACTORY_ADDRESS = (
  env.VITE_FACTORY_ADDRESS ||
  "0x6A837595E2592d699d48eB2DAcF47Df9493035d2"
).trim();

export const BLOCK_EXPLORER_URL =
  env.VITE_BLOCK_EXPLORER_URL ||
  "https://sepolia.etherscan.io";

export const READONLY_SEPOLIA_RPC =
  env.VITE_SEPOLIA_RPC_URL ||
  "https://rpc.ankr.com/eth_sepolia";

export const SEPOLIA_CHAIN_ID = 11155111;

// ── Status labels ──

export const CAMPAIGN_STATUS = [
  "Accepting Donations",
  "In Progress",
  "Completed",
  "Cancelled",
] as const;

export const MILESTONE_STATUS = [
  "Pending",
  "Submitted",
  "Approved",
  "Rejected",
] as const;

// ── ABIs (human-readable format) ──

export const FACTORY_ABI = [
  // Write
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

  // Read
  "function getAllCampaigns() view returns (address[])",
  "function getCampaignCount() view returns (uint256)",

  // Events
  "event CampaignCreated(address indexed, address indexed, string)",
] as const;

export const CAMPAIGN_ABI = [
  // Write
  "function donate() payable",
  "function submitMilestone(uint256, string) external",
  "function vote(uint256, bool) external",
  "function refund() external",

  // Read — campaign info
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

  // Read — milestones
  `function getAllMilestones() view returns (
    tuple(
      string title,
      string description,
      uint256 fundPercent,
      uint256 deadline,
      uint8 status,
      string evidenceUrl,
      uint256 votesFor,
      uint256 votesAgainst,
      uint256 submissionCount
    )[]
  )`,

  // Read — donations
  "function getDonation(address) view returns (uint256)",
  "function donations(address) view returns (uint256)",

  // Events
  "event DonationReceived(address indexed, uint256)",
  "event MilestoneSubmitted(uint256 indexed, string)",
  "event VoteCast(address indexed, uint256 indexed, bool)",
  "event FundsReleased(uint256 indexed, uint256)",
  "event MilestoneRejected(uint256 indexed)",
] as const;
