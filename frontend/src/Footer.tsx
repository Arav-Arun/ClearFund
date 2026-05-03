import { Link } from "react-router-dom";
import { FACTORY_ADDRESS, BLOCK_EXPLORER_URL } from "./constants";

export default function Footer() {
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
        
        <div className="flex gap-8">
          <a 
            href={`${BLOCK_EXPLORER_URL}/address/${FACTORY_ADDRESS}`} 
            target="_blank" 
            rel="noreferrer"
            className="font-bold text-sm uppercase tracking-wider hover:underline"
          >
            Contract
          </a>
          <a 
            href="https://github.com/Arav-Arun/ImpactFund" 
            target="_blank" 
            rel="noreferrer"
            className="font-bold text-sm uppercase tracking-wider hover:underline"
          >
            Source
          </a>
        </div>
      </div>
      
      <div className="text-center mt-12 pt-8 border-t border-[#3c4043] text-xs text-muted">
        © {new Date().getFullYear()} ClearFund. Built for transparency.
      </div>
    </footer>
  );
}
