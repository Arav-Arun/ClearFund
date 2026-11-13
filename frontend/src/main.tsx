import { Component, StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "@rainbow-me/rainbowkit/styles.css";
import { RainbowKitProvider, lightTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { sepolia } from "wagmi/chains";
import "./index.css";
import App from "./App";
import { wagmiConfig } from "./chain";

const queryClient = new QueryClient();

/// A crash inside a wallet library (its modal renders outside the app) must not leave a blank page.
class Fallback extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="page" style={{ paddingTop: "6rem" }}>
        <p className="notice notice-warn">
          Something went wrong while showing this page. Your funds are safe in the escrow contracts.{" "}
          <button className="link-button" onClick={() => location.reload()}>Reload</button>
        </p>
      </main>
    );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fallback>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={sepolia} theme={lightTheme({ accentColor: "#3173ad", borderRadius: "large", fontStack: "system" })}>
          <App />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
    </Fallback>
  </StrictMode>
);
