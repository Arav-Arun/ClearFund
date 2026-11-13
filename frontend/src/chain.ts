import { useEffect, useMemo, useState } from "react";
import { getDefaultConfig, useConnectModal } from "@rainbow-me/rainbowkit";
import { ethers } from "ethers";
import { fallback, http, useAccount, useSwitchChain, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";

const env = import.meta.env;

// A public endpoint behind the configured one, so a dead RPC provider cannot take the site down.
// A local chain gets no fallback: mixing it with real Sepolia would blend two different chains.
const PUBLIC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const CONFIGURED_RPC = String(env.VITE_SEPOLIA_RPC_URL || "").trim();
const RPC_URLS = /^http:\/\/(localhost|127\.0\.0\.1)/.test(CONFIGURED_RPC)
  ? [CONFIGURED_RPC]
  : [...new Set([CONFIGURED_RPC, PUBLIC_RPC].filter(Boolean))];

const LEGACY_FACTORY_ADDRESS = String(env.VITE_FACTORY_ADDRESS || "").trim();
export const V2_FACTORY_ADDRESS = String(env.VITE_FACTORY_V2_ADDRESS || "").trim();
export const FACTORY_ADDRESS = V2_FACTORY_ADDRESS || LEGACY_FACTORY_ADDRESS;
export const FACTORY_REGISTRIES = [
  ...(V2_FACTORY_ADDRESS ? [{ address: V2_FACTORY_ADDRESS, block: Number(env.VITE_FACTORY_V2_DEPLOY_BLOCK || 0), version: 2 }] : []),
  ...(LEGACY_FACTORY_ADDRESS ? [{ address: LEGACY_FACTORY_ADDRESS, block: Number(env.VITE_FACTORY_DEPLOY_BLOCK || 0), version: 1 }] : []),
];
export const USDC_ADDRESS = String(env.VITE_USDC_ADDRESS || "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238").trim();
export const EXPLORER = "https://sepolia.etherscan.io";
const SEPOLIA_CHAIN_ID = sepolia.id;

export const FACTORY_ABI = [
  "function isCampaign(address) view returns (bool)",
  "function protocolVersion() view returns (uint256)",
  "function campaignCount() view returns (uint256)",
  "function campaignsPage(uint256 offset, uint256 limit) view returns (address[])",
  "function createCampaign(tuple(string metadataCid, bytes32 metadataHash, uint256 goal, uint256 minimum, uint256 fundingDeadline) config, tuple(uint256 shareBps, uint256 deadline)[] milestones) returns (address)",
  "event CampaignCreated(address indexed campaign, address indexed creator)",
];

export const CAMPAIGN_ABI = [
  "function protocolVersion() view returns (uint256)",
  "function creator() view returns (address)",
  "function metadataCid() view returns (string)",
  "function metadataHash() view returns (bytes32)",
  "function goal() view returns (uint256)",
  "function minimum() view returns (uint256)",
  "function fundingDeadline() view returns (uint256)",
  "function status() view returns (uint8)",
  "function current() view returns (uint256)",
  "function raised() view returns (uint256)",
  "function activeRaised() view returns (uint256)",
  "function releasedBps() view returns (uint256)",
  "function creatorOwed() view returns (uint256)",
  "function contributionOf(address) view returns (uint256)",
  "function exited(address) view returns (bool)",
  "function claimOf(address) view returns (uint256)",
  "function canExit() view returns (bool)",
  "function isStalled() view returns (bool)",
  "function getMilestones() view returns (tuple(uint256 shareBps, uint256 deadline, uint256 reviewEndsAt, uint8 step, string proofCid, bytes32 proofHash)[])",
  "function donate(uint256 amount)",
  "function donateWithPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function start()",
  "function submitProof(string cid, bytes32 hash)",
  "function exit()",
  "function release()",
  "function withdraw()",
  "function cancel()",
  "event Donated(address indexed donor, uint256 amount)",
  "event Started()",
  "event ProofSubmitted(uint256 indexed milestone, string cid, bytes32 hash, uint256 reviewEndsAt)",
  "event Exited(address indexed donor, uint256 amount)",
  "event Released(uint256 indexed milestone, uint256 amount)",
  "event Withdrawn(uint256 amount)",
  "event Cancelled()",
  "error InvalidConfig()",
  "error NotCreator()",
  "error WrongStatus()",
  "error FundingClosed()",
  "error GoalExceeded()",
  "error CreatorCannotDonate()",
  "error AmountMismatch()",
  "error BelowMinimum()",
  "error NotSubmittable()",
  "error InvalidProof()",
  "error ReviewOpen()",
  "error CannotExit()",
  "error NothingToClaim()",
  "error NotCancellable()",
  "error TransferFailed()",
];

export const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function nonces(address) view returns (uint256)",
  "function name() view returns (string)",
  "function version() view returns (string)",
];

export const campaignInterface = new ethers.Interface(CAMPAIGN_ABI);

export const wagmiConfig = getDefaultConfig({
  appName: "ClearFund",
  appUrl: window.location.origin,
  appIcon: `${window.location.origin}/apple-touch-icon.png`,
  projectId: String(env.VITE_WALLETCONNECT_PROJECT_ID || "clearfund"),
  chains: [sepolia],
  transports: { [sepolia.id]: fallback(RPC_URLS.map((url) => http(url))) },
});

export const eventSources = RPC_URLS.map(url => {
  const request = new ethers.FetchRequest(url);
  request.timeout = 12_000;
  return new ethers.JsonRpcProvider(request, SEPOLIA_CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
});

export const readProvider = new ethers.FallbackProvider(
  eventSources.map((provider, i) => ({
    provider,
    priority: i + 1,
    weight: 1,
    stallTimeout: 2_500,
  })),
  SEPOLIA_CHAIN_ID,
  { quorum: 1 }
);

export interface Wallet {
  account: string | null;
  signer: ethers.Signer | null;
  wrongNetwork: boolean;
  connect: () => void;
  switchToSepolia: () => void;
}

export function useWallet(): Wallet {
  const { address, chainId, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient();
  const [signer, setSigner] = useState<ethers.Signer | null>(null);

  const browserProvider = useMemo(
    () => (walletClient ? new ethers.BrowserProvider(walletClient.transport as ethers.Eip1193Provider) : null),
    [walletClient]
  );

  useEffect(() => {
    let live = true;
    if (!browserProvider || !walletClient) {
      setSigner(null);
      return;
    }
    setSigner(null);
    browserProvider.getSigner(walletClient.account.address).then((next) => live && setSigner(next)).catch(() => live && setSigner(null));
    return () => {
      live = false;
    };
  }, [browserProvider, walletClient]);

  const account = isConnected && address ? address : null;
  return {
    account,
    signer,
    wrongNetwork: !!account && chainId !== SEPOLIA_CHAIN_ID,
    connect: () => openConnectModal?.(),
    switchToSepolia: () => switchChain({ chainId: SEPOLIA_CHAIN_ID }),
  };
}

// Signs an EIP-2612 permit so a donation takes one wallet confirmation instead of approve + donate.
export async function signPermit(signer: ethers.Signer, spender: string, amount: bigint) {
  const owner = await signer.getAddress();
  const usdc = new ethers.Contract(USDC_ADDRESS, USDC_ABI, readProvider);
  const [name, version, nonce] = await Promise.all([
    usdc.name(),
    usdc.version().catch(() => "2"),
    usdc.nonces(owner),
  ]);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 30 * 60);
  const signature = await signer.signTypedData(
    { name, version, chainId: SEPOLIA_CHAIN_ID, verifyingContract: USDC_ADDRESS },
    {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    { owner, spender, value: amount, nonce, deadline }
  );
  const { v, r, s } = ethers.Signature.from(signature);
  return { deadline, v, r, s };
}

const ERROR_MESSAGES: Record<string, string> = {
  InvalidConfig: "Check the form: milestone shares must add up to 100% and deadlines must follow each other.",
  NotCreator: "Only the campaign's creator can do this.",
  WrongStatus: "The campaign is not at that stage.",
  FundingClosed: "Donations are closed for this campaign.",
  GoalExceeded: "That would take the campaign past its goal. Give only what is left.",
  CreatorCannotDonate: "The creator wallet cannot donate to its own campaign.",
  AmountMismatch: "The token did not deliver the full amount, so the donation was refused.",
  BelowMinimum: "The campaign has not reached its minimum yet.",
  NotSubmittable: "This milestone is not waiting for proof, or its deadline has passed.",
  InvalidProof: "The proof upload is incomplete. Try again.",
  ReviewOpen: "The review window is still open.",
  CannotExit: "Withdrawals depend on the campaign version and its funding, review or cancellation state.",
  NothingToClaim: "There is nothing left to claim.",
  NotCancellable: "The campaign is on track, so only its creator can cancel it.",
  TransferFailed: "The USDC transfer failed.",
};

export function errorMessage(err: unknown, fallbackText = "Something went wrong.") {
  const e = err as { code?: string; data?: string; revert?: { name: string }; shortMessage?: string; message?: string };
  if (e?.code === "ACTION_REJECTED") return "You cancelled in your wallet.";
  if (e?.code === "INSUFFICIENT_FUNDS") return "This wallet needs a little Sepolia ETH for gas.";

  let name = e?.revert?.name;
  if (!name && typeof e?.data === "string") {
    try {
      name = campaignInterface.parseError(e.data)?.name;
    } catch {
      // Not one of the contract's errors.
    }
  }
  if (name && ERROR_MESSAGES[name]) return ERROR_MESSAGES[name];
  if (err instanceof Error && !e.shortMessage && err.message.length < 160) return err.message;
  return fallbackText;
}
