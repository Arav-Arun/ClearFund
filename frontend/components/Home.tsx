import { Link } from "react-router-dom";
import { CAMPAIGN_STATUS, formatEth, useAllCampaigns } from "../blockchain";
import type { WalletState } from "../blockchain";

function campaignTagClass(status: number) {
  if (status === 0) return "neo-tag-blue";
  if (status === 1) return "neo-tag-yellow";
  if (status === 2) return "neo-tag-green";
  return "neo-tag-red";
}

export default function Home({ wallet }: { wallet: WalletState }) {
  const { campaigns, loading, error } = useAllCampaigns(wallet.provider);

  const totalRaised = campaigns.reduce((acc, c) => acc + c.raisedAmount, 0n);
  const activeCount = campaigns.filter(c => c.status === 1).length;
  const completedCount = campaigns.filter(c => c.status === 2).length;

  return (
    <div className="page-container">
      <section className="text-center mb-16 pt-8">
        <h1 className="hero-headline">
          Donate with <br />
          <span className="hero-highlight">Accountability.</span> <br />
          Every Milestone <br />
          Verified.
        </h1>
        
        <div className="hero-description-box">
          <p className="text-secondary font-medium" style={{ fontSize: "16px" }}>
            Fund real-world impact on the blockchain. Your ETH stays locked 
            in escrow until NGOs prove progress, verified by the community 
            and smart contract logic.
          </p>
        </div>

        <div className="flex justify-center gap-6">
          {!wallet.account ? (
            <button className="neo-btn neo-btn-primary" style={{ padding: "14px 32px", fontSize: "16px" }} onClick={wallet.connect}>
              Connect Wallet to Start
            </button>
          ) : (
            <Link to="/create" className="neo-btn neo-btn-primary" style={{ padding: "14px 32px", fontSize: "16px" }}>
              + Create Campaign
            </Link>
          )}
          <a href="#active-campaigns" className="neo-btn neo-btn-outline" style={{ padding: "14px 32px", fontSize: "16px" }}>
            Explore Campaigns
          </a>
        </div>
      </section>

      <section className="mb-24" style={{ marginTop: "48px" }}>
        <h2 className="text-center font-extrabold text-3xl mb-12 uppercase tracking-tight" style={{ color: "var(--accent)" }}>
          How It Works
        </h2>
        <div className="how-it-works-grid">
          <div className="how-card">
            <span className="how-number">1</span>
            <h3 className="font-bold text-xl mb-3">1. Fund</h3>
            <p className="text-secondary">
              You donate ETH. It goes into a transparent smart contract, 
              not straight into the organiser's wallet.
            </p>
          </div>
          <div className="how-card">
            <span className="how-number">2</span>
            <h3 className="font-bold text-xl mb-3">2. Verify</h3>
            <p className="text-secondary">
              The NGO captures live progress evidence. ClearFund checks the proof
              with an AI Oracle and a public review window.
            </p>
          </div>
          <div className="how-card">
            <span className="how-number">3</span>
            <h3 className="font-bold text-xl mb-3">3. Release</h3>
            <p className="text-secondary">
              Funds unlock milestone by milestone. If the project fails, 
              donors can recover the locked balance.
            </p>
          </div>
        </div>
      </section>

      <section className="stats-grid mb-24">
        <div className="stat-box">
          <div className="stat-value">{campaigns.length}</div>
          <div className="stat-label">Campaigns</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{formatEth(totalRaised)} ETH</div>
          <div className="stat-label">Total Raised</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{activeCount}</div>
          <div className="stat-label">In Progress</div>
        </div>
        <div className="stat-box">
          <div className="stat-value">{completedCount}</div>
          <div className="stat-label">Completed</div>
        </div>
      </section>

      <section id="active-campaigns" style={{ paddingTop: "40px" }}>
        <div className="active-header-box mb-8">
          Active Campaigns
        </div>

        {loading ? (
          <div className="empty-state">
            <div className="stat-value" style={{ border: 'none', fontSize: "32px" }}>Loading Campaigns...</div>
            <p className="mt-4 text-secondary">Fetching data directly from the Ethereum Sepolia network</p>
          </div>
        ) : error ? (
          <div className="empty-state">
            <p className="font-bold text-2xl text-secondary">{error}</p>
            <p className="mt-2">The default public Sepolia RPC is set in frontend/blockchain.ts.</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="empty-state">
            <p className="font-bold text-2xl text-secondary">No campaigns found</p>
            <p className="mt-2">Be the first to start a movement with accountability.</p>
            <Link to="/create" className="neo-btn neo-btn-outline mt-6">Start a Campaign</Link>
          </div>
        ) : (
          <div className="campaign-grid">
            {campaigns.map((campaign) => {
              const progress = campaign.goalAmount > 0n
                ? Number(campaign.raisedAmount * 100n / campaign.goalAmount)
                : 0;

              return (
                <Link
                  key={campaign.address}
                  to={`/campaign/${campaign.address}`}
                  className="campaign-card"
                >
                  <div className="campaign-card-header">
                    <h3 className="campaign-card-title">{campaign.title}</h3>
                    <p className="campaign-card-ngo">by {campaign.ngoName}</p>
                  </div>
                  <div className="campaign-card-body">
                    <div className="flex justify-between items-center mb-6">
                      <span className={`neo-tag ${campaignTagClass(campaign.status)}`}>
                        {CAMPAIGN_STATUS[campaign.status] || "Unknown"}
                      </span>
                    </div>

                    <p className="text-secondary text-sm mb-6" style={{ minHeight: 60, lineHeight: 1.5 }}>
                      {(campaign.description || "No description provided.").slice(0, 120)}
                      {campaign.description.length > 120 ? "..." : ""}
                    </p>

                    <div className="neo-progress mb-3">
                      <div
                        className="neo-progress-bar"
                        style={{ width: `${Math.min(progress, 100)}%` }}
                      />
                    </div>
                    
                    <div className="flex justify-between items-end border-t border-[#3c4043] pt-4 mt-2">
                      <div>
                        <div className="stat-value" style={{ fontSize: "18px", border: "none", marginBottom: 0 }}>
                          {formatEth(campaign.raisedAmount)} ETH
                        </div>
                        <div className="stat-label">Raised of {formatEth(campaign.goalAmount)} ETH</div>
                      </div>
                      <div className="text-right">
                        <div className="stat-value" style={{ fontSize: "18px", border: "none", marginBottom: 0 }}>
                          {campaign.milestoneCount}
                        </div>
                        <div className="stat-label">Milestones</div>
                      </div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
