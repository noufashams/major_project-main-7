import { useEffect, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function StaffBookings() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    fetchBookings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBookings = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        navigate("/staff-login");
        return;
      }
      const res = await axios.get("http://localhost:3000/api/staff/bookings", {
        headers: { Authorization: `Bearer ${token}` },
        params: {
          date_from: fromDate || undefined,
          date_to: toDate || undefined
        }
      });
      setBookings(res.data || []);
    } catch (err) {
      if (err.response?.status === 401) navigate("/staff-login");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setFromDate("");
    setToDate("");
    fetchBookings();
  };

  const markPaid = async (bookingId) => {
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        navigate("/staff-login");
        return;
      }
      await axios.post(`http://localhost:3000/api/staff/bookings/${bookingId}/mark-paid`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchBookings();
    } catch (err) {
      alert(err.response?.data?.message || "Failed to mark as paid");
    }
  };

  const th = {
    textAlign: "left",
    padding: "10px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    color: "#9ca3af",
    fontSize: "13px",
    letterSpacing: "0.02em"
  };

  const td = {
    padding: "10px 8px",
    borderBottom: "1px solid rgba(255,255,255,0.05)",
    color: "#e5e7eb",
    fontSize: "14px"
  };

  return (
    <div style={{
      fontFamily: "'Poppins','Inter',system-ui,sans-serif",
      background: "#0b1021",
      minHeight: "100vh",
      color: "#e5e7eb",
      padding: "32px 24px"
    }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
        <div>
          <p style={{ margin: 0, fontSize: "12px", letterSpacing: "0.2em", color: "#9ca3af" }}>LIVE OPERATIONS</p>
          <h2 style={{ margin: "2px 0 0 0", letterSpacing: "0.02em", fontWeight: 700 }}>📓 Bookings</h2>
        </div>
        <div style={{ display: "flex", gap: "10px" }}>
          <button
            onClick={() => navigate("/dashboard")}
            style={{ padding: "10px 14px", background: "transparent", color: "#e5e7eb", border: "1px solid rgba(255,255,255,0.12)", borderRadius: "10px", cursor: "pointer" }}
          >
            ← Back to Dashboard
          </button>
          <button
            onClick={() => { localStorage.removeItem("token"); navigate("/staff-login"); }}
            style={{ padding: "10px 14px", background: "transparent", color: "#fca5a5", border: "1px solid #fca5a5", borderRadius: "10px", cursor: "pointer" }}
          >
            Logout
          </button>
        </div>
      </header>

      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "16px", padding: "18px", boxShadow: "0 18px 40px rgba(0,0,0,0.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
          <h3 style={{ margin: 0, color: "#e5e7eb" }}>All Bookings</h3>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#e5e7eb" }}
            />
            <span style={{ color: "#9ca3af", fontSize: "12px" }}>to</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              style={{ padding: "8px 10px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.06)", color: "#e5e7eb" }}
            />
            <button onClick={fetchBookings} style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.12)", color: "white", cursor: "pointer" }}>Filter</button>
            <button onClick={handleClear} style={{ padding: "8px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", background: "transparent", color: "#9ca3af", cursor: "pointer" }}>Clear</button>
            {loading && <span style={{ color: "#9ca3af", fontSize: "12px" }}>Loading…</span>}
          </div>
        </div>

        {bookings.length === 0 && !loading ? (
          <p style={{ color: "#9ca3af", margin: 0 }}>No bookings yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Ref</th>
                  <th style={th}>Guest</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Room</th>
                  <th style={th}>Rooms</th>
                  <th style={th}>Check-In</th>
                  <th style={th}>Check-Out</th>
                  <th style={th}>Status</th>
                  <th style={th}>Payment</th>
                  <th style={th}>Actions</th>
                  <th style={th}>ID</th>
                </tr>
              </thead>
              <tbody>
                {bookings.map((b) => (
                  <tr key={b.booking_id}>
                    <td style={td}>{b.booking_ref || b.booking_id}</td>
                    <td style={td}>{b.guest_name}</td>
                    <td style={td}>{b.guest_phone}</td>
                    <td style={td}>{b.room_type}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{b.number_of_rooms || 1}</td>
                    <td style={td}>{new Date(b.check_in_date).toLocaleDateString()}</td>
                    <td style={td}>{new Date(b.check_out_date).toLocaleDateString()}</td>
                    <td style={td}>{b.booking_status}</td>
                    <td style={td}>
                      <span style={{
                        display: "inline-block",
                        padding: "4px 10px",
                        borderRadius: "999px",
                        fontWeight: 700,
                        fontSize: "12px",
                        color: (b.payment_status || "pending").toLowerCase() === "paid" ? "#166534" : "#854d0e",
                        backgroundColor: (b.payment_status || "pending").toLowerCase() === "paid" ? "rgba(22,101,52,0.12)" : "rgba(133,77,14,0.14)"
                      }}>
                        {(b.payment_status || "pending").toUpperCase()}
                      </span>
                    </td>
                    <td style={td}>
                      {(b.payment_status || "").toLowerCase() !== "paid" && (
                        <button
                          onClick={() => markPaid(b.booking_id)}
                          style={{ padding: "6px 10px", borderRadius: "8px", border: "1px solid #10b981", background: "rgba(16,185,129,0.12)", color: "#10b981", cursor: "pointer", fontWeight: 700 }}
                        >
                          Mark Paid
                        </button>
                      )}
                    </td>
                    <td style={td}>
                      {b.license_file_path ? (
                        <a href={`http://localhost:3000/${b.license_file_path}`} target="_blank" rel="noreferrer" style={{ color: "#93c5fd" }}>View ID</a>
                      ) : (
                        <span style={{ color: "#9ca3af" }}>None</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default StaffBookings;
