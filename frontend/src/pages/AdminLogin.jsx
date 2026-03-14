import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const submit = async () => {
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    try {
      const res = await axios.post("http://localhost:3000/api/admin/login", { email, password });
      localStorage.setItem("adminToken", res.data.token);
      navigate("/admin-dashboard");
    } catch (err) {
      setError(err.response?.data?.message || "Login failed");
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px",
      fontFamily: "'Inter', system-ui, sans-serif",
      backgroundImage: "linear-gradient(150deg, rgba(8,12,24,0.8), rgba(17,24,39,0.7)), url('https://images.unsplash.com/photo-1496417263034-38ec4f0b665a?auto=format&fit=crop&w=1600&q=80&sat=-12')",
      backgroundSize: "cover",
      backgroundPosition: "center"
    }}>
      <div style={{
        width: "100%",
        maxWidth: "420px",
        background: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.22)",
        borderRadius: "16px",
        boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        padding: "28px",
        color: "#e5e7eb"
      }}>
        <div style={{ textAlign: "center", marginBottom: "18px" }}>
          <p style={{ margin: 0, letterSpacing: "0.2em", fontSize: "12px", color: "#cbd5e1" }}>ADMIN ACCESS</p>
          <h2 style={{ margin: "6px 0 6px", color: "#fff" }}>Verify Hotels</h2>
          <p style={{ margin: 0, color: "#cbd5e1" }}>Sign in to approve newly registered hotels.</p>
        </div>

        {error && (
          <div style={{
            color: "#fecdd3",
            marginBottom: "14px",
            padding: "12px",
            backgroundColor: "rgba(248,113,113,0.14)",
            borderRadius: "10px",
            border: "1px solid rgba(248,113,113,0.35)"
          }}>
            {error}
          </div>
        )}

        <label style={label}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={input}
        />

        <label style={{ ...label, marginTop: "12px" }}>Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={input}
        />

        <button onClick={submit} style={primary}>Login</button>
      </div>
    </div>
  );
}

const label = { color: "#e5e7eb", fontWeight: 700, fontSize: "13px", letterSpacing: "0.02em", display: "block", marginBottom: "6px" };
const input = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.22)",
  background: "rgba(255,255,255,0.10)",
  color: "#f8fafc",
  marginBottom: "10px"
};
const primary = {
  marginTop: "12px",
  width: "100%",
  padding: "12px",
  background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
  color: "white",
  border: "none",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: 800,
  boxShadow: "0 14px 30px rgba(124,58,237,0.32)"
};

export default AdminLogin;
