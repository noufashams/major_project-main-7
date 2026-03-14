import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function StaffLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleLogin = async () => {
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }

    try {
      const res = await axios.post(
        "http://localhost:3000/api/staff/login",
        { email, password }
      );

      localStorage.setItem("token", res.data.token);
      localStorage.setItem("email", email);
      navigate("/dashboard");
    } catch (err) {
      console.error(err);
      setError(err.response?.data?.message || "Login failed");
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter") handleLogin();
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px",
      fontFamily: "'Inter', system-ui, sans-serif",
      backgroundColor: "#0b1220",
      backgroundImage: "linear-gradient(160deg, rgba(6,10,18,0.80), rgba(10,16,28,0.62)), url('https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=2000&q=80&sat=-10')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat"
    }}>
      <div style={{
        width: "100%",
        maxWidth: "420px",
        background: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.24)",
        borderRadius: "18px",
        boxShadow: "0 22px 60px rgba(0,0,0,0.35)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        padding: "28px",
        color: "#e5e7eb"
      }}>
        <div style={{ 
          textAlign: "center", 
          marginBottom: "18px",
          background: "url('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1400&q=80&sat=-12') center/cover",
          borderRadius: "14px",
          padding: "40px 14px",
          border: "1px solid rgba(255,255,255,0.18)"
        }}>
          <p style={{ margin: 0, letterSpacing: "0.18em", fontSize: "11px", color: "#cbd5e1" }}>STAFF PORTAL</p>
          <h2 style={{ margin: "6px 0 4px", color: "#fff", letterSpacing: "0.01em" }}>Sign in</h2>
          <p style={{ margin: 0, color: "#d1d5db", fontSize: "14px" }}>Access your hotel command center</p>
        </div>

        {error && (
          <div style={{ 
            color: "#fecdd3", 
            marginBottom: "14px",
            padding: "12px",
            backgroundColor: "rgba(248,113,113,0.12)",
            borderRadius: "10px",
            border: "1px solid rgba(248,113,113,0.35)"
          }}>
            {error}
          </div>
        )}

        <label style={{ color: "#e5e7eb", fontWeight: 700, fontSize: "13px", letterSpacing: "0.02em", display: "block", marginBottom: "6px" }}>Email</label>
        <input
          type="email"
          placeholder="you@hotel.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyPress={handleKeyPress}
          style={{
            width: "100%",
            padding: "12px 14px",
            marginBottom: "14px",
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: "10px",
            boxSizing: "border-box",
            backgroundColor: "rgba(255,255,255,0.12)",
            color: "#f8fafc"
          }}
        />

        <label style={{ color: "#e5e7eb", fontWeight: 700, fontSize: "13px", letterSpacing: "0.02em", display: "block", marginBottom: "6px" }}>Password</label>
        <input
          type="password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyPress={handleKeyPress}
          style={{
            width: "100%",
            padding: "12px 14px",
            marginBottom: "18px",
            border: "1px solid rgba(255,255,255,0.22)",
            borderRadius: "10px",
            boxSizing: "border-box",
            backgroundColor: "rgba(255,255,255,0.12)",
            color: "#f8fafc"
          }}
        />

        <button
          onClick={handleLogin}
          style={{
            width: "100%",
            padding: "12px",
            background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
            color: "white",
            border: "none",
            borderRadius: "10px",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: "700",
            letterSpacing: "0.01em",
            boxShadow: "0 18px 40px rgba(124,58,237,0.32)"
          }}
        >
          Login
        </button>

        <div style={{ marginTop: "14px", textAlign: "center", color: "#d1d5db", fontSize: "14px" }}>
          <p style={{ margin: 0 }}>Don't have an account? 
            <a 
              href="/register-hotel" 
              style={{ color: "#93c5fd", marginLeft: "6px", textDecoration: "none", fontWeight: 700 }}
            >
              Register here
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default StaffLogin;
