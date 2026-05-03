import { useEffect, useMemo, useState } from "react";
import { getDefaultConfig, useConnectModal } from "@rainbow-me/rainbowkit";
import { ethers } from "ethers";
import { http } from "wagmi";
import { useAccount, useDisconnect, useSwitchChain, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";
import { READONLY_SEPOLIA_RPC, SEPOLIA_CHAIN_ID, WALLETCONNECT_PROJECT_ID } from "./chain";
import type { WalletState } from "./types";

export const wagmiConfig = getDefaultConfig({
  appName: "ClearFund",
  projectId: WALLETCONNECT_PROJECT_ID,
  chains: [sepolia],
  transports: { [sepolia.id]: http(READONLY_SEPOLIA_RPC) },
});

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
    } catch (err: unknown) {
      console.error("Failed to switch network:", err);
      setError("Could not switch to Sepolia.");
    }
  };

  const account = isConnected && address ? address : null;
  const provider = walletProvider ?? readonlyProvider;
  const isWrongNetwork = !!account && chainId !== SEPOLIA_CHAIN_ID;

  return {
    account,
    provider,
    signer,
    chainId: chainId ?? null,
    isConnecting: isConnecting || isReconnecting,
    isWrongNetwork,
    error,
    connect,
    disconnect: () => disconnect(),
    switchToSepolia,
  };
}
