import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { READONLY_SEPOLIA_RPC, SEPOLIA_CHAIN_ID } from "./constants";
import type { WalletState } from "./types";

declare global {
  interface Window {
    ethereum?: ethers.Eip1193Provider & {
      on: (event: string, cb: () => void) => void;
      removeListener: (event: string, cb: () => void) => void;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export function useWallet(): WalletState {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.AbstractProvider | null>(null);
  const [signer, setSigner] = useState<ethers.JsonRpcSigner | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initReadonly = useCallback(() => {
    const p = new ethers.JsonRpcProvider(READONLY_SEPOLIA_RPC);
    setProvider(p);
  }, []);

  const sync = useCallback(async () => {
    if (!window.ethereum) {
      initReadonly();
      return;
    }

    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      const accounts = await browserProvider.send("eth_accounts", []);

      const network = await browserProvider.getNetwork();
      setChainId(Number(network.chainId));

      if (accounts.length > 0) {
        const s = await browserProvider.getSigner();
        setAccount(accounts[0]);
        setProvider(browserProvider);
        setSigner(s);
      } else {
        setAccount(null);
        setSigner(null);
        initReadonly();
      }
    } catch (err: unknown) {
      console.error(err);
      initReadonly();
    }
  }, [initReadonly]);

  useEffect(() => {
    sync();

    const handleAccountsChanged = () => sync();
    const handleChainChanged = () => sync();

    if (window.ethereum) {
      window.ethereum.on("accountsChanged", handleAccountsChanged);
      window.ethereum.on("chainChanged", handleChainChanged);
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
        window.ethereum.removeListener("chainChanged", handleChainChanged);
      }
    };
  }, [sync]);

  const connect = async () => {
    if (!window.ethereum) {
      setError("Please install MetaMask to connect.");
      return;
    }
    setIsConnecting(true);
    setError(null);
    try {
      const browserProvider = new ethers.BrowserProvider(window.ethereum);
      await browserProvider.send("eth_requestAccounts", []);
      await sync();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setIsConnecting(false);
    }
  };

  const disconnect = () => {
    setAccount(null);
    setSigner(null);
    initReadonly();
  };

  const switchToSepolia = async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${SEPOLIA_CHAIN_ID.toString(16)}` }],
      });
    } catch (err: unknown) {
      console.error("Failed to switch network:", err);
    }
  };

  const isWrongNetwork = !!account && chainId !== SEPOLIA_CHAIN_ID;

  return {
    account,
    provider,
    signer,
    chainId,
    isConnecting,
    isWrongNetwork,
    error,
    connect,
    disconnect,
    switchToSepolia,
  };
}
