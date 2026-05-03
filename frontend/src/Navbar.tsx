import { Link } from "react-router-dom";
import type { WalletState } from "./types";

interface NavbarProps {
  wallet: WalletState;
}

export default function Navbar({ wallet }: NavbarProps) {
  const { account, connect, disconnect, isConnecting } = wallet;

  return (
    <nav className="navbar">
      <Link to="/" className="navbar-logo flex items-center gap-2">
        <img src="/clearFundLogo.png" alt="ClearFund Logo" style={{ width: 24, height: 24 }} />
        ClearFund
      </Link>

      <div className="navbar-links items-center">
        <Link to="/" className="navbar-link">Explore</Link>
        <Link to="/create" className="navbar-link">New Campaign</Link>

        {account ? (
          <button
            className="neo-btn neo-btn-outline"
            onClick={disconnect}
          >
            {account.slice(0,6)}...{account.slice(-4)} (Disconnect)
          </button>
        ) : (
          <button
            className="neo-btn neo-btn-primary"
            onClick={connect}
            disabled={isConnecting}
          >
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </div>
    </nav>
  );
}
