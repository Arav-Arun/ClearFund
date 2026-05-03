import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import type { WalletState } from "./types";

interface NavbarProps {
  wallet: WalletState;
}

export default function Navbar({ wallet }: NavbarProps) {
  const { account, connect, disconnect, isConnecting } = wallet;
  const [showProfile, setShowProfile] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowProfile(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
          <div className="relative" ref={dropdownRef} style={{ position: "relative" }}>
            <button
              className="neo-btn neo-btn-outline"
              onClick={() => setShowProfile(!showProfile)}
            >
              My Profile
            </button>
            {showProfile && (
              <div 
                className="absolute right-0 top-full mt-2 neo-card" 
                style={{ 
                  position: "absolute", 
                  right: 0, 
                  top: "calc(100% + 8px)", 
                  width: "240px", 
                  zIndex: 50, 
                  padding: "20px", 
                  background: "var(--bg-raised)" 
                }}
              >
                <div className="text-secondary text-xs mb-1 uppercase tracking-wider font-bold">Wallet Address</div>
                <div className="font-mono text-accent mb-6 font-bold text-lg">{account.slice(0,6)}...{account.slice(-4)}</div>
                <button
                  className="neo-btn neo-btn-danger w-full justify-center"
                  onClick={() => {
                    disconnect();
                    setShowProfile(false);
                  }}
                >
                  Logout
                </button>
              </div>
            )}
          </div>
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
