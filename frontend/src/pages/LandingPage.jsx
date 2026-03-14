import { useNavigate } from "react-router-dom";

function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={{ color: "var(--text)", background: "var(--bg)", minHeight: "100vh" }}>
      
      {/* --- NAVIGATION BAR --- */}
      <nav style={{ 
        position: "sticky",
        top: 0,
        zIndex: 10,
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center", 
        padding: "18px 48px", 
        background: "rgba(12,15,20,0.85)",
        backdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(255,255,255,0.05)"
      }}>
        <div style={{ fontSize: "24px", fontWeight: "800", letterSpacing: "2px" }}>
          INN<span style={{ color: "var(--accent)" }}>GO</span>
        </div>
        <div style={{ display: "flex", gap: "14px", alignItems: "center" }}>
          <button 
            onClick={() => navigate("/search")} 
            style={{ ...ghostButton, padding: "10px 16px" }}
          >
            Explore Hotels
          </button>
          <button 
            onClick={() => navigate("/admin-login")} 
            style={{ ...ghostButton, padding: "10px 16px", borderColor: "#f87171", color: "#fecdd3" }}
          >
            Admin Login
          </button>
          <button 
            onClick={() => navigate("/staff-login")} 
            style={{ ...ghostButton, padding: "10px 16px", borderColor: "var(--accent)", color: "var(--accent)" }}
          >
            Owner Login
          </button>
        </div>
      </nav>

      {/* --- HERO SECTION --- */}
      <header style={{ 
        position: "relative",
        padding: "140px 24px 160px",
        overflow: "hidden",
        minHeight: "100vh",
        backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.75) 100%), url('https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1920&q=80')",
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat"
      }}>
        <div style={{ position: "relative", maxWidth: "960px", margin: "0 auto", textAlign: "center" }}>
          <p style={{ letterSpacing: "6px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px" }}>Smart Hospitality AI Platform</p>
          <h1 style={{ fontSize: "64px", lineHeight: "1.05", margin: "0 0 20px 0" }}>
            Build the stay you’d pin forever.
          </h1>
          <p style={{ fontSize: "20px", color: "var(--muted)", margin: "0 0 32px 0", maxWidth: "760px", marginInline: "auto" }}>
            A luxury-grade booking experience with AI-driven pricing, concierge chat, and stunning storytelling for your independent hotels.
          </p>
          <div style={{ display: "flex", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
            <button 
              onClick={() => navigate("/register-hotel")} 
            >
              Register Hotel
            </button>
            <button 
              onClick={() => navigate("/search")} 
              style={ghostButton}
            >
              Preview Guest Experience
            </button>
          </div>
        </div>
      </header>

      {/* --- VALUE PROP / FEATURES SECTION --- */}
      <section style={{ padding: "80px 50px", maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <p style={{ letterSpacing: "5px", textTransform: "uppercase", color: "var(--muted)", margin: "0 0 6px 0" }}>Why InnGo</p>
          <h2 style={{ fontSize: "36px", margin: 0 }}>Designed for Boutique Originals</h2>
        </div>
        
        <div style={{ 
          display: "grid", 
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", 
          gap: "26px"
        }}>
          
          {/* Feature 1 */}
          <div style={featureCardStyle}>
            <div style={iconStyle}>📈</div>
            <h3 style={featureTitleStyle}>AI Yield Management</h3>
            <p style={featureTextStyle}>
              Dynamic pricing that senses demand and length-of-stay patterns, ensuring you never leave money on the table.
            </p>
          </div>

          {/* Feature 2 */}
          <div style={featureCardStyle}>
            <div style={iconStyle}>🤖</div>
            <h3 style={featureTitleStyle}>Concierge Chat</h3>
            <p style={featureTextStyle}>
              An always-on AI receptionist that answers questions, checks live inventory, and confirms bookings instantly.
            </p>
          </div>

          {/* Feature 3 */}
          <div style={featureCardStyle}>
            <div style={iconStyle}>💎</div>
            <h3 style={featureTitleStyle}>Luxury Storytelling</h3>
            <p style={featureTextStyle}>
              Rich imagery, crafted copy, and immersive layouts so your property feels premium before guests arrive.
            </p>
          </div>

        </div>
      </section>

    </div>
  );
}

// --- REUSABLE STYLES ---
const ghostButton = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.18)",
  color: "var(--text)",
  borderRadius: "999px",
  padding: "10px 18px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "border-color 0.2s ease, transform 0.15s ease",
};

const featureCardStyle = {
  padding: "26px",
  background: "rgba(23,27,35,0.82)",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.06)",
  boxShadow: "0 20px 50px rgba(0,0,0,0.35)"
};

const iconStyle = {
  fontSize: "32px",
  marginBottom: "14px"
};

const featureTitleStyle = {
  fontSize: "22px",
  fontWeight: "700",
  marginBottom: "10px",
  marginTop: "0"
};

const featureTextStyle = {
  fontSize: "15px",
  color: "var(--muted)",
  lineHeight: "1.6"
};

export default LandingPage;
