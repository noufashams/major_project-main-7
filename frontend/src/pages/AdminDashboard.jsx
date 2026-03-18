import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function AdminDashboard() {
  const [pending, setPending] = useState([]);
  const [verified, setVerified] = useState([]);
  const [view, setView] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const token = localStorage.getItem("adminToken");

  const fetchPending = async () => {
    if (!token) {
      navigate("/admin-login", { replace: true });
      return;
    }
    try {
      setLoading(true);
      const res = await axios.get("http://localhost:3000/api/admin/hotels/pending", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPending(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load pending hotels");
      if (err.response?.status === 401 || err.response?.status === 403) {
        localStorage.removeItem("adminToken");
        navigate("/admin-login", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const fetchVerified = async () => {
    if (!token) {
      navigate("/admin-login", { replace: true });
      return;
    }
    try {
      setLoading(true);
      const res = await axios.get("http://localhost:3000/api/admin/hotels/verified", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setVerified(res.data || []);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load verified hotels");
      if (err.response?.status === 401 || err.response?.status === 403) {
        localStorage.removeItem("adminToken");
        navigate("/admin-login", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
    fetchVerified();
  }, []);

  const verifyHotel = async (hotel_id) => {
    try {
      await axios.post(`http://localhost:3000/api/admin/hotels/${hotel_id}/verify`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPending((prev) => prev.filter(h => h.hotel_id !== hotel_id));
    } catch (err) {
      alert(err.response?.data?.message || "Verification failed");
    }
  };

  const deleteHotel = async (hotel_id) => {
    if (!window.confirm("Remove this hotel from the platform? This cannot be undone.")) return;
    try {
      await axios.delete(`http://localhost:3000/api/admin/hotels/${hotel_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPending((prev) => prev.filter(h => h.hotel_id !== hotel_id));
    } catch (err) {
      alert(err.response?.data?.message || "Delete failed");
    }
  };

  const logout = () => {
    localStorage.removeItem("adminToken");
    navigate("/admin-login", { replace: true });
  };

  return (
    <div style={{
      minHeight: "100vh",
      padding: "32px 20px",
      backgroundImage: "linear-gradient(150deg, rgba(8,12,24,0.82), rgba(10,16,28,0.68)), url('https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=2000&q=80&sat=-10')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      color: "#e5e7eb",
      fontFamily: "'Inter', system-ui, sans-serif"
    }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <p style={{ margin: 0, letterSpacing: "0.12em", fontSize: "11px", color: "#cbd5e1" }}>ADMIN</p>
            <h1 style={{ margin: "4px 0 0", fontSize: "30px", color: "#f8fafc" }}>Hotels</h1>
            <p style={{ margin: "4px 0 0", color: "#cbd5e1" }}>{pending.length} pending • {verified.length} verified</p>
          </div>
          <button onClick={logout} style={secondaryButton}>Logout</button>
        </header>

        <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
          <button onClick={() => setView("pending")} style={{ ...secondaryButton, background: view==="pending"?"rgba(34,197,94,0.18)":"rgba(255,255,255,0.10)", borderColor: view==="pending"?"rgba(34,197,94,0.6)":"rgba(255,255,255,0.18)" }}>Pending</button>
          <button onClick={() => setView("verified")} style={{ ...secondaryButton, background: view==="verified"?"rgba(59,130,246,0.18)":"rgba(255,255,255,0.10)", borderColor: view==="verified"?"rgba(59,130,246,0.6)":"rgba(255,255,255,0.18)" }}>Verified</button>
        </div>

        {error && (
          <div style={{
            background: "rgba(248,113,113,0.14)",
            border: "1px solid rgba(248,113,113,0.35)",
            borderRadius: "12px",
            padding: "12px",
            marginBottom: "12px",
            color: "#fecdd3"
          }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ color: "#e5e7eb" }}>Loading hotels...</div>
        ) : view === "pending" ? (
          pending.length === 0 ? (
            <div style={cardStyle}>
              <p style={{ margin: 0, color: "#cbd5e1" }}>No hotels waiting for verification.</p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: "12px" }}>
              {pending.map(hotel => (
                <div key={hotel.hotel_id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                    <div>
                      <h3 style={{ margin: "0 0 4px", color: "#f8fafc" }}>{hotel.hotel_name}</h3>
                      <p style={{ margin: 0, color: "#cbd5e1" }}>{hotel.location}</p>
                      <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: "13px" }}>{hotel.contact_email} • {hotel.contact_phone}</p>
                      {hotel.license_file_path && (
                        <a href={`http://localhost:3000/${hotel.license_file_path}`} target="_blank" rel="noreferrer" style={{ color: "#93c5fd", fontWeight: 700, display: "inline-block", marginTop: "6px" }}>
                          View License
                        </a>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: "10px" }}>
                      <button onClick={() => verifyHotel(hotel.hotel_id)} style={primaryButton}>Verify</button>
                      <button onClick={() => deleteHotel(hotel.hotel_id)} style={dangerButton}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <div style={{ display: "grid", gap: "12px" }}>
            {verified.length === 0 ? (
              <div style={cardStyle}>
                <p style={{ margin: 0, color: "#cbd5e1" }}>No verified hotels found.</p>
              </div>
            ) : verified.map(hotel => (
              <div key={hotel.hotel_id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "flex-start" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px", color: "#f8fafc" }}>{hotel.hotel_name}</h3>
                    <p style={{ margin: 0, color: "#cbd5e1" }}>{hotel.location}</p>
                    <p style={{ margin: "6px 0 0", color: "#94a3b8", fontSize: "13px" }}>{hotel.contact_email} • {hotel.contact_phone}</p>
                    <p style={{ margin: "4px 0 0", color: "#22c55e", fontWeight: 700 }}>Verified</p>
                  </div>
                  <button onClick={() => deleteHotel(hotel.hotel_id)} style={dangerButton}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const primaryButton = {
  padding: "10px 16px",
  background: "linear-gradient(135deg, #22c55e, #16a34a)",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontWeight: 700,
  boxShadow: "0 10px 26px rgba(34,197,94,0.3)"
};

const dangerButton = {
  padding: "10px 16px",
  background: "linear-gradient(135deg, #f87171, #dc2626)",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontWeight: 700,
  boxShadow: "0 10px 26px rgba(239,68,68,0.3)"
};

const secondaryButton = {
  padding: "10px 16px",
  background: "rgba(255,255,255,0.10)",
  color: "#e5e7eb",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "10px",
  cursor: "pointer",
  fontWeight: 700
};

const cardStyle = {
  background: "rgba(255,255,255,0.10)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "14px",
  padding: "16px",
  boxShadow: "0 16px 40px rgba(0,0,0,0.32)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)"
};

export default AdminDashboard;
