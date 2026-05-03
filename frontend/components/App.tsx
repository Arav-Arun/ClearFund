import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { useWallet } from "../blockchain";
import Navbar from "./Navbar";
import Footer from "./Footer";
import Home from "./Home";
import CampaignDetail from "./CampaignDetail";
import CreateCampaign from "./CreateCampaign";

function App() {
  const wallet = useWallet();

  return (
    <BrowserRouter>
      <Toaster position="bottom-right" />

      {wallet.isWrongNetwork && (
        <div style={{ background: 'var(--danger)', color: 'white', padding: '12px', textAlign: 'center', fontWeight: 'bold' }}>
          Wrong network. Please switch to Sepolia.
          <button
            className="neo-btn neo-btn-outline"
            style={{ marginLeft: 16, padding: '4px 12px', fontSize: 13, borderColor: 'white', color: 'white' }}
            onClick={wallet.switchToSepolia}
          >
            Switch to Sepolia
          </button>
        </div>
      )}

      <Navbar wallet={wallet} />
      <Routes>
        <Route path="/" element={<Home wallet={wallet} />} />
        <Route
          path="/campaign/:address"
          element={<CampaignDetail wallet={wallet} />}
        />
        <Route
          path="/create"
          element={<CreateCampaign wallet={wallet} />}
        />
      </Routes>
      <Footer />
    </BrowserRouter>
  );
}

export default App;
