import { useNavigate } from "react-router-dom";
import { useEffect, useState, useRef } from "react";

function LandingPage() {
  const navigate = useNavigate();
  const [showFeatures, setShowFeatures] = useState(false);
  const featuresRef = useRef(null);

  // Reveal features when the section enters the viewport
  useEffect(() => {
    const target = featuresRef.current;
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShowFeatures(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.2 }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  const backgroundImage = "url('https://images.unsplash.com/photo-1445019980597-93fa8acb246c?auto=format&fit=crop&w=1920&q=80')";

  return (
    <div style={{
      color: "var(--text)",
      minHeight: "100vh",
      backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.65) 50%, rgba(0,0,0,0.75) 100%), ${backgroundImage}`,
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "fixed"
    }}>
      
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
        padding: "120px 24px 120px",
        overflow: "hidden",
        minHeight: "75vh",
        backgroundImage: "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.35) 40%, rgba(0,0,0,0.1) 100%)"
      }}>
        <div style={{ position: "relative", maxWidth: "960px", margin: "0 auto", textAlign: "center", transform: "translateY(10vh)" }}>
          <p style={{ letterSpacing: "6px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px", fontFamily: "'Playfair Display','Cinzel','Georgia',serif" }}>SMART HOSPITALITY AI PLATFORM</p>
          <h1 style={{ fontSize: "48px", lineHeight: "1.08", margin: "0 0 18px 0", textTransform: "uppercase", fontFamily: "'Playfair Display','Cinzel','Georgia',serif", letterSpacing: "0.5px" }}>
            BUILD THE STAY YOU’D PIN FOREVER
          </h1>
          <p style={{ fontSize: "16px", color: "var(--muted)", margin: "0 0 32px 0", maxWidth: "760px", marginInline: "auto", textTransform: "none", letterSpacing: "1px", fontFamily: "'Playfair Display','Cinzel','Georgia',serif" }}>
            STOP PAYING 25% OTA COMMISSIONS
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
      <section
        ref={featuresRef}
        style={{
          padding: "80px 50px",
          paddingTop: "200px",
          maxWidth: "1200px",
          margin: "0 auto",
          opacity: showFeatures ? 1 : 0,
          transform: showFeatures ? "translateY(0)" : "translateY(40px)",
          transition: "opacity 0.5s ease, transform 0.5s ease"
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "40px" }}>
          <p style={{ letterSpacing: "5px", textTransform: "uppercase", color: "#cbd5e1", margin: "0 0 6px 0", fontSize: "20px", fontWeight: 800 }}>Why InnGo</p>
          <h2 style={{ 
            fontSize: "14px",
            margin: 0,
            color: "#cbd5e1",
            lineHeight: 1.35,
            letterSpacing: "5px",
            textTransform: "uppercase",
            fontFamily: "'Playfair Display','Cinzel','Georgia',serif",
            fontWeight: 600
          }}>
            The all in one operating system for independent botique hotels. Get your own white labeled direct booking engine, powered by ai yield management
          </h2>
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
  background: "rgba(12,16,26,0.72)",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.10)",
  boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
  backdropFilter: "blur(12px)"
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
