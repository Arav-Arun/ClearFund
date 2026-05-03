// Shared TypeScript types for ClearFund

export interface CampaignInfo {
  address: string;
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
  votesFor: bigint;
  votesAgainst: bigint;
  submissionCount: number;
}

import type { ethers } from "ethers";

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
