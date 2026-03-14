
import { useEffect, useState, useMemo } from "react";
import toast, { Toaster } from "react-hot-toast";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { 
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer 
} from 'recharts';
// 🚨 NEW FRONTEND IMPORTS
import { io } from "socket.io-client";

function StaffDashboard() {
  const navigate = useNavigate();
  
  // --- STATE ---
  const [activeTab, setActiveTab] = useState("analytics"); // 'analytics' or 'pricing'
  const [loading, setLoading] = useState(true);
  
  // Analytics State
  const [analytics, setAnalytics] = useState(null);
  const [period, setPeriod] = useState("30");
  const [bookings, setBookings] = useState([]);
  const [bookingsLoading, setBookingsLoading] = useState(true);
  
  // Pricing State
  const [recommendations, setRecommendations] = useState([]);
  const [pricingLoading, setPricingLoading] = useState(false);

  // --- DATA FETCHING ---
  useEffect(() => {
    if (activeTab === "analytics") {
      fetchAnalytics();
      fetchBookings();
    } else if (activeTab === "pricing") {
      fetchPricingRecommendations();
    }
  }, [activeTab, period]);
useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) return;

    // Connect to the backend socket
    const socket = io("http://localhost:3000");

    // Extract the hotel_id from the JWT token so we know which room to join
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      socket.emit("join_hotel_room", payload.hotel_id);
    } catch (e) {
      console.error("Invalid token format");
    }

    // LISTEN for the booking event from the server
    socket.on("new_booking_alert", (data) => {
      // 1. Play a notification sound! (Optional, but awesome for presentations)
      window.speechSynthesis.speak(new SpeechSynthesisUtterance("New booking received."));
      
      // 2. Show a beautiful toast popup
  toast.success(
        <div>
          <strong>🛎️ New Booking Alert!</strong><br/>
          {data.guest_name} booked the <strong>{data.room_type}</strong> room for {data.nights} night(s).<br/>
          <span style={{fontSize: "12px", color: "gray"}}>Ref: {data.ref}</span>
        </div>, 
        { duration: 8000, position: 'top-right' }
      );

      // 3. MAGIC: Instantly re-fetch the analytics so the revenue charts jump up live!
      fetchAnalytics(); 
      fetchBookings();
    });

    // Cleanup on unmount
    return () => socket.disconnect();
  }, []); // Only runs once on mount

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const config = { headers: { Authorization: `Bearer ${token}` } };
      const res = await axios.get(`http://localhost:3000/api/staff/analytics?period=${period}`, config);
      setAnalytics(res.data);
    } catch (err) {
      console.error(err);
      if (err.response?.status === 401) navigate("/staff-login");
    } finally {
      setLoading(false);
    }
  };

  const fetchPricingRecommendations = async () => {
    setPricingLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(`http://localhost:3000/api/pricing/recommendations?days=7`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecommendations(res.data.recommendations || []);
    } catch (err) {
      console.error("Failed to fetch recommendations:", err);
    } finally {
      setPricingLoading(false);
    }
  };

  const fetchBookings = async () => {
    setBookingsLoading(true);
    try {
      const token = localStorage.getItem("token");
      if (!token) {
        setBookings([]);
        return;
      }
      const res = await axios.get("http://localhost:3000/api/staff/bookings", {
        headers: { Authorization: `Bearer ${token}` }
      });
      setBookings(res.data || []);
    } catch (err) {
      console.error("Failed to fetch bookings:", err);
      if (err.response?.status === 401) navigate("/staff-login");
    } finally {
      setBookingsLoading(false);
    }
  };

  const handleApplyPrice = async (roomId, newPrice, targetDate) => {
    try {
      const token = localStorage.getItem("token");
      await axios.post("http://localhost:3000/api/pricing/apply", {
        room_id: roomId,
        new_price: newPrice,
        target_date: targetDate
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert("✅ New price successfully applied to the database!");
      fetchPricingRecommendations(); // Refresh list
    } catch (err) {
      alert("❌ Error applying price: " + err.message);
    }
  };

  // --- CHART DATA PREP ---
  const revenueTrendData = useMemo(() => {
    if (!analytics?.revenue_trend) return [];
    const revenueMap = {};
    analytics.revenue_trend.forEach(item => {
      const cleanDate = item.date.trim().replace(/\s+/g, ' '); 
      revenueMap[cleanDate] = Number(item.daily_revenue);
    });
    const filledData = [];
    const days = parseInt(period) > 30 ? 30 : parseInt(period) || 30; 
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const month = d.toLocaleString('en-US', { month: 'short' });
      const day = d.getDate().toString().padStart(2, '0');
      const dateStr = `${month} ${day}`;
      filledData.push({ date: dateStr, daily_revenue: revenueMap[dateStr] || 0 });
    }
    return filledData;
  }, [analytics?.revenue_trend, period]);

// Fix: Only show full-screen loading if we don't have analytics data yet!
  const hotelTitle = analytics?.hotel?.hotel_name || bookings[0]?.hotel_name || "Hotel";

  if (loading && !analytics && activeTab === "analytics") return <div style={{ padding: "40px" }}>Loading Dashboard...</div>;

  return (
    <div style={{ 
      fontFamily: "'Poppins','Inter',system-ui,sans-serif", 
      background: "radial-gradient(circle at 20% 20%, rgba(59,130,246,0.12), transparent 25%), radial-gradient(circle at 80% 0%, rgba(16,185,129,0.14), transparent 22%), #0b1021",
      minHeight: "100vh",
      color: "#e5e7eb"
    }}>
      {/* 🚨 THIS IS THE MAGIC CONTAINER THAT SHOWS THE POPUPS! */}
      <Toaster position="top-right" reverseOrder={false} />
      {/* --- TOP NAVIGATION BAR --- */}
      <header style={{ 
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        background: "rgba(15,23,42,0.7)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        color: "white",
        padding: "18px 40px",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        boxShadow: "0 10px 30px rgba(0,0,0,0.35)"
      }}>
        <div>
          <p style={{ margin: 0, fontSize: "12px", letterSpacing: "0.2em", color: "#9ca3af" }}>LIVE OPERATIONS</p>
          <h2 style={{ margin: "2px 0 0 0", display: "flex", alignItems: "center", gap: "10px", letterSpacing: "0.02em", fontWeight: 700 }}>
            🏨 {hotelTitle} — Command Center
          </h2>
        </div>
        
        <div style={{ display: "flex", gap: "12px" }}>
          <button 
            onClick={() => setActiveTab("analytics")} 
            style={activeTab === "analytics" ? activeNavStyle : defaultNavStyle}
          >
            📊 Analytics
          </button>
          
          <button 
            onClick={() => setActiveTab("pricing")} 
            style={activeTab === "pricing" ? activeNavStyle : defaultNavStyle}
          >
            ⚡ AI Pricing
          </button>
          
          <button 
            onClick={() => navigate("/rooms")} 
            style={{...defaultNavStyle, backgroundColor: "#10b981", color: "white", borderColor: "#10b981"}}
          >
            🛏️ Manage Rooms
          </button>

          <button 
            onClick={() => { localStorage.removeItem("token"); navigate("/staff-login"); }} 
            style={{...defaultNavStyle, color: "#fca5a5", borderColor: "#fca5a5"}}
          >
            Logout
          </button>
        </div>
      </header>

      <main style={{ padding: "36px 40px 60px", maxWidth: "1400px", margin: "0 auto" }}>
        
        {/* ==========================================
            TAB 1: ANALYTICS DASHBOARD
            ========================================== */}
        {activeTab === "analytics" && analytics && (
          <div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "20px" }}>
              <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ 
                padding: "10px 14px", 
                borderRadius: "10px", 
                border: "1px solid rgba(255,255,255,0.12)", 
                background: "rgba(255,255,255,0.06)",
                color: "white",
                boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                backdropFilter: "blur(8px)"
              }}>
                <option value="7">Last 7 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
              </select>
            </div>

            {/* KEY METRICS SECTION */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: "18px", marginBottom: "30px" }}>
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>💰 Total Revenue</div>
                <div style={metricValueStyle}>₹{(analytics.summary.total_revenue || 0).toLocaleString()}</div>
                <div style={metricChangeStyle(analytics.comparison.revenue_change_percent)}>
                  {analytics.comparison.revenue_change_percent > 0 ? '↑' : analytics.comparison.revenue_change_percent < 0 ? '↓' : '−'} {analytics.comparison.revenue_change_percent}% vs last period
                </div>
              </div>

              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>🛏️ Occupancy Rate</div>
                <div style={metricValueStyle}>{analytics.key_metrics.occupancy_rate}%</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>{analytics.summary.confirmed_bookings} confirmed bookings</div>
              </div>

              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>📊 RevPAR</div>
                <div style={metricValueStyle}>₹{Number(analytics.key_metrics.revpar).toLocaleString()}</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>Revenue per available room</div>
              </div>

              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>💵 ADR</div>
                <div style={metricValueStyle}>₹{Number(analytics.key_metrics.adr).toLocaleString()}</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>Average daily rate</div>
              </div>

              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>📅 ALOS</div>
                <div style={metricValueStyle}>{analytics.key_metrics.alos}</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>Avg Length of Stay (Nights)</div>
              </div>

              {/* CANCELLATION RATE CARD */}
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>❌ Cancellation Rate</div>
                <div style={metricValueStyle}>{analytics.key_metrics.cancellation_rate}%</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
                  {analytics.summary.cancelled_bookings} cancelled bookings
                </div>
              </div>

              {/* AVAILABLE ROOMS TODAY */}
              <div style={metricCardStyle}>
                <div style={metricLabelStyle}>🏨 Rooms Available Today</div>
                <div style={metricValueStyle}>{analytics.summary.available_rooms ?? "—"}</div>
                <div style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>Remaining inventory right now</div>
              </div>
            </div>

            {/* CHARTS SECTION */}
            <div style={{ ...cardStyle, height: "400px", marginBottom: "20px" }}>
              <h3 style={{ marginTop: 0, color: "#e5e7eb" }}>Revenue Trend ({period} Days)</h3>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenueTrendData} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{fontSize: 12}} tickMargin={10} />
                  <YAxis tickFormatter={(val) => `₹${val}`} tick={{fontSize: 12}} />
                  <Tooltip formatter={(value) => `₹${value}`} />
                  <Line type="monotone" dataKey="daily_revenue" stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* ALERTS & RECOMMENDATIONS */}
            <div style={cardStyle}>
              <h3 style={{ marginTop: 0, color: "#e5e7eb" }}>💡 AI Insights & Recommendations</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                {parseFloat(analytics.key_metrics.occupancy_rate) < 70 && (
                  <div style={alertStyle("warning")}> 
                    <strong>⚠️ Low Occupancy</strong>
                    <p>Your occupancy is {analytics.key_metrics.occupancy_rate}%. Consider running a discount campaign to fill empty rooms.</p>
                  </div>
                )}

           
                {parseFloat(analytics.key_metrics.cancellation_rate) > 20 && (
                  <div style={alertStyle("danger")}> 
                    <strong>🚨 High Cancellation Rate!</strong>
                    <p>
                      Your cancellation rate has hit {analytics.key_metrics.cancellation_rate}% 
                      ({analytics.summary.cancelled_bookings} cancelled bookings). 
                      Consider making your refund policy stricter or offering non-refundable discounted rates.
                    </p>
                  </div>
                )}

                {parseFloat(analytics.key_metrics.repeat_guest_rate) > 20 && (
                  <div style={alertStyle("success")}> 
                    <strong>✅ Great Guest Loyalty</strong>
                    <p>{analytics.key_metrics.repeat_guest_rate}% of your bookings are repeat customers. Excellent work!</p>
                  </div>
                )}

                {parseFloat(analytics.comparison.revenue_change_percent) > 5 && (
                  <div style={alertStyle("success")}> 
                    <strong>✅ Revenue is Growing</strong>
                    <p>Revenue is up {analytics.comparison.revenue_change_percent}% compared to the previous period!</p>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "30px" }}>
              <div style={{ ...cardStyle, height: "350px", display: "flex", flexDirection: "column" }}>
                <h3 style={{ marginTop: 0, color: "#e5e7eb" }}>Revenue by Room Type</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.revenue_by_room_type || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                    <XAxis dataKey="room_type" />
                    <YAxis />
                    <Tooltip formatter={(value) => `₹${value}`} />
                    <Bar dataKey="revenue" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ ...cardStyle, height: "350px", display: "flex", flexDirection: "column" }}>
                <h3 style={{ marginTop: 0, color: "#e5e7eb" }}>Bookings by Day of Week</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={analytics.peak_days || []}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day_of_week" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="bookings" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* RECENT BOOKINGS WITH ID LINKS */}
            <div style={{ ...cardStyle, marginTop: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                <h3 style={{ margin: 0, color: "#e5e7eb" }}>Recent Bookings</h3>
                {bookingsLoading && <span style={{ color: "#6b7280", fontSize: "12px" }}>Loading…</span>}
              </div>
              {bookings.length === 0 ? (
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
                        <th style={th}>Check-In</th>
                        <th style={th}>Check-Out</th>
                        <th style={th}>Status</th>
                        <th style={th}>Payment</th>
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
                            {b.license_file_path ? (
                              <a href={`http://localhost:3000/${b.license_file_path}`} target="_blank" rel="noreferrer">View ID</a>
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
        )}


        {/* ==========================================
            TAB 2: AI PRICING OPTIMIZER
            ========================================== */}
        {activeTab === "pricing" && (
          <div>
            <div style={{ marginBottom: "30px" }}>
              <h2 style={{ marginTop: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                ⚡ AI Yield Management
              </h2>
              <p style={{ color: "#4b5563", marginTop: "5px" }}>
                The AI automatically analyzes occupancy, seasonality, and booking velocity to suggest optimal daily rates.
              </p>
            </div>

            {pricingLoading ? (
              <p>Calculating real-time market recommendations...</p>
            ) : recommendations.length === 0 ? (
              <div style={{ ...cardStyle, textAlign: "center", padding: "60px 20px" }}>
                <h3 style={{ margin: 0, color: "#4b5563" }}>All prices are perfectly optimized.</h3>
                <p style={{ color: "#9ca3af" }}>Check back later for new demand fluctuations.</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
                {recommendations.map((rec, index) => (
                  <div key={index} style={{...cardStyle, borderTop: "4px solid #2563eb"}}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "15px" }}>
                      <span style={{ fontWeight: "bold", fontSize: "18px" }}>{rec.room_type || `Room ID: ${rec.room_id}`}</span>
                      <span style={{ backgroundColor: "#e0e7ff", color: "#1d4ed8", padding: "4px 8px", borderRadius: "4px", fontSize: "12px", fontWeight: "bold" }}>
                        {new Date(rec.target_date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    
                    <div style={{ display: "flex", alignItems: "center", gap: "15px", marginBottom: "15px", backgroundColor: "#f9fafb", padding: "12px", borderRadius: "8px" }}>
                      <div>
                        <div style={{ fontSize: "12px", color: "#6b7280" }}>Base Price</div>
                        <div style={{ fontSize: "18px", color: "#9ca3af", textDecoration: "line-through" }}>₹{rec.current_price || rec.base_price}</div>
                      </div>
                      <div style={{ fontSize: "24px" }}>➡️</div>
                      <div>
                        <div style={{ fontSize: "12px", color: "#2563eb", fontWeight: "bold" }}>AI Recommended</div>
                        <div style={{ fontSize: "24px", color: "#111827", fontWeight: "bold" }}>₹{rec.recommended_price}</div>
                      </div>
                    </div>

                    <div style={{ fontSize: "14px", color: "#4b5563", marginBottom: "20px", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                      <span>💡</span>
                      <span>{rec.reason || "Algorithm detected sudden demand spike for these dates."}</span>
                    </div>

                    <button 
                      onClick={() => handleApplyPrice(rec.room_id, rec.recommended_price, rec.target_date)}
                      style={{ width: "100%", padding: "12px", backgroundColor: "#2563eb", color: "white", border: "none", borderRadius: "6px", fontWeight: "bold", cursor: "pointer", transition: "background-color 0.2s" }}
                      onMouseOver={(e) => e.target.style.backgroundColor = "#1d4ed8"}
                      onMouseOut={(e) => e.target.style.backgroundColor = "#2563eb"}
                    >
                      Accept & Surge Price
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      
    </div>
  );
}

// --- STYLES ---
const defaultNavStyle = {
  background: "rgba(255,255,255,0.06)",
  color: "#cbd5f5",
  border: "1px solid rgba(255,255,255,0.16)",
  padding: "10px 16px",
  borderRadius: "10px",
  cursor: "pointer",
  fontWeight: "600",
  fontSize: "14px",
  transition: "all 0.2s",
  boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
  backdropFilter: "blur(6px)"
};

const activeNavStyle = {
  ...defaultNavStyle,
  background: "linear-gradient(135deg,#60a5fa,#a78bfa)",
  color: "white",
  borderColor: "transparent",
  boxShadow: "0 14px 30px rgba(96,165,250,0.35)"
};

const cardStyle = { 
  background: "linear-gradient(145deg, rgba(255,255,255,0.08), rgba(255,255,255,0.04))", 
  borderRadius: "16px", 
  padding: "24px", 
  boxShadow: "0 25px 60px rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.08)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)"
};
const metricCardStyle = { 
  ...cardStyle, 
  padding: "20px",
  boxShadow: "0 20px 50px rgba(0,0,0,0.3)" 
};
const metricLabelStyle = { fontSize: "12px", color: "#9ca3af", fontWeight: "700", textTransform: "uppercase", marginBottom: "6px", letterSpacing: "0.08em" };
const metricValueStyle = { fontSize: "30px", fontWeight: "800", color: "#f8fafc" };

const metricChangeStyle = (value) => ({
  fontSize: "12px",
  color: value > 0 ? "#22c55e" : value < 0 ? "#f87171" : "#9ca3af",
  fontWeight: "700",
  marginTop: "8px",
});

const th = { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.08)", fontSize: "13px", color: "#cbd5e1" };
const td = { padding: "10px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "14px", color: "#e2e8f0" };



const alertStyle = (type) => ({
  backgroundColor: type === "danger" ? "rgba(248,113,113,0.1)" : type === "warning" ? "rgba(251,191,36,0.12)" : "rgba(16,185,129,0.12)",
  border: `1px solid ${type === "danger" ? "rgba(248,113,113,0.35)" : type === "warning" ? "rgba(251,191,36,0.4)" : "rgba(16,185,129,0.35)"}`,
  padding: "16px",
  borderRadius: "10px",
  color: type === "danger" ? "#fecdd3" : type === "warning" ? "#fef3c7" : "#d1fae5",
});
export default StaffDashboard;
