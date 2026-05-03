import { Link } from "react-router-dom";
import { BLOCK_EXPLORER_URL, FACTORY_ADDRESS } from "../blockchain";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function Footer() {
  const contractUrl = BLOCK_EXPLORER_URL && FACTORY_ADDRESS
    ? `${BLOCK_EXPLORER_URL}/address/${FACTORY_ADDRESS}`
    : "";

  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="flex flex-col gap-2">
          <Link to="/" className="navbar-logo" style={{ fontSize: "24px" }}>
            CLEARFUND
          </Link>
          <p className="text-secondary text-sm">
            Milestone-gated donation escrow on Ethereum
          </p>
        </div>
        
        <div className="flex gap-6">
          <a 
            href="https://aravarun.xyz" 
            target="_blank" 
            rel="noreferrer"
            className="font-bold text-sm uppercase tracking-wider hover:underline"
          >
            My Portfolio
          </a>
          <a 
            href="https://github.com/Arav-Arun/ClearFund" 
            target="_blank" 
            rel="noreferrer"
            className="font-bold text-sm uppercase tracking-wider hover:underline"
          >
            Github Repo
          </a>
          {contractUrl && (
            <a
              href={contractUrl}
              target="_blank"
              rel="noreferrer"
              className="font-bold text-sm uppercase tracking-wider hover:underline"
            >
              Contracts
            </a>
          )}
        </div>
      </div>

      <div className="footer-contract">
        Active Sepolia factory:{" "}
        {contractUrl ? (
          <a
            href={contractUrl}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-accent font-bold"
          >
            {shortAddress(FACTORY_ADDRESS)}
          </a>
        ) : (
          <span className="font-mono text-muted">not configured</span>
        )}
      </div>
      
      <div className="text-center mt-8 pt-4 border-t border-[#3c4043] text-xs text-muted">
        © {new Date().getFullYear()} ClearFund. Built for transparency.
      </div>
    </footer>
  );
}
