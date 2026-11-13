import { useEffect, useRef } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Toaster } from "react-hot-toast";
import { EXPLORER, FACTORY_ADDRESS, useWallet } from "./chain";
import CampaignPage from "./CampaignPage";
import CreateCampaign from "./CreateCampaign";
import Home from "./Home";

export default function App() {
  const wallet = useWallet();

  return (
    <BrowserRouter>
      <ScrollManager />
      <Toaster position="bottom-right" toastOptions={{ className: "toast" }} />
      <Navbar />
      <div className="sheet">
        {wallet.wrongNetwork && (
          <p className="network-bar">
            Your wallet is on another network. ClearFund runs on Sepolia.{" "}
            <button className="link-button" onClick={wallet.switchToSepolia}>Switch to Sepolia</button>
          </p>
        )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/campaign/:address" element={<CampaignPage wallet={wallet} />} />
          <Route path="/new" element={<CreateCampaign wallet={wallet} />} />
        </Routes>
      </div>
      <Footer />
    </BrowserRouter>
  );
}

/// The router does not scroll by itself. A link with a hash (/#campaigns) lands on that section, even
/// when clicked again on the page it already shows; any other new page opens at the top. Back and
/// forward are left to the browser, which restores where the reader was.
function ScrollManager() {
  const { pathname, hash, key } = useLocation();
  const type = useNavigationType();
  const previous = useRef(pathname);
  useEffect(() => {
    const samePage = previous.current === pathname;
    previous.current = pathname;
    if (hash) {
      const target = document.getElementById(decodeURIComponent(hash.slice(1)));
      const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
      target?.scrollIntoView({ behavior: samePage && !calm ? "smooth" : "auto", block: "start" });
    } else if (type !== "POP" && !samePage) {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash, key, type]);
  return null;
}

function Navbar() {
  return (
    <header className="topbar">
      <nav className="nav">
        <Link to="/" className="wordmark">
          <img src="/clearfund-mark.svg" alt="" width="34" height="34" />
          ClearFund
        </Link>
        <div className="nav-links">
          <NavLink to="/#campaigns" end>Campaigns</NavLink>
          <NavLink to="/new">Start a campaign</NavLink>
          <ConnectButton showBalance={false} chainStatus="none" accountStatus="address" label="Connect wallet" />
        </div>
      </nav>
    </header>
  );
}

function Footer() {
  const contract = FACTORY_ADDRESS ? `${EXPLORER}/address/${FACTORY_ADDRESS}` : "";
  return (
    <footer className="footer">
      <div className="footer-brand">
        <span className="wordmark"><img src="/clearfund-mark.svg" alt="" width="34" height="34" />ClearFund</span>
        <p>Donations that wait for proof. Runs on the Sepolia testnet with test USDC, so no real money moves.</p>
      </div>
      <nav className="footer-cols" aria-label="Footer">
        <div>
          <h4>Give</h4>
          <Link to="/#campaigns">Campaigns</Link>
          <Link to="/new">Start a campaign</Link>
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Get test USDC</a>
        </div>
        <div>
          <h4>Check it</h4>
          <a href="https://github.com/Arav-Arun/ClearFund" target="_blank" rel="noreferrer">Source on GitHub</a>
          {contract && <a href={contract} target="_blank" rel="noreferrer">Factory contract</a>}
          <a href="https://github.com/Arav-Arun/ClearFund#threat-model" target="_blank" rel="noreferrer">Threat model</a>
        </div>
        <div>
          <h4>Made by</h4>
          <a href="https://aravarun.in" target="_blank" rel="noreferrer">Arav Arun</a>
        </div>
      </nav>
    </footer>
  );
}
