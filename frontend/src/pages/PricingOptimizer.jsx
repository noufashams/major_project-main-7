import { useState, useEffect } from "react";
import axios from "axios";

function PricingOptimizer() {
  const [recommendations, setRecommendations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [daysAhead, setDaysAhead] = useState(7);
  
  // These now use keys like "room_id-date" (e.g., "5-2026-12-25")
  const [appliedPrices, setAppliedPrices] = useState({});
  const [ignoredPrices, setIgnoredPrices] = useState({});

  useEffect(() => {
    fetchRecommendations();
  }, [daysAhead]);

  const fetchRecommendations = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const response = await axios.get(
        `http://localhost:3000/api/pricing/recommendations?days=${daysAhead}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      setRecommendations(response.data.recommendations);
    } catch (err) {
      console.error("Failed to fetch recommendations:", err);
    } finally {
      setLoading(false);
    }
  };

  // TWEAK 1: Added targetDate as a parameter
  const handleApplyPrice = async (roomId, newPrice, targetDate) => {
    try {
      const token = localStorage.getItem("token");
      await axios.post(
        "http://localhost:3000/api/pricing/apply",
        // TWEAK 2: Sending target_date to the backend
        { room_id: roomId, new_price: newPrice, target_date: targetDate },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      // TWEAK 3: Update local state using both Room ID and Date
      const applyKey = `${roomId}-${targetDate}`;
      setAppliedPrices({ ...appliedPrices, [applyKey]: true });
      alert("✅ Price applied successfully!");

      // TWEAK 4: Removed setTimeout anti-pattern

      await fetchRecommendations();
    } catch (err) {
      alert("❌ Failed to apply price: " + err.message);
    }
  };

  const handleIgnorePrice = (roomId, targetDate) => {
    const ignoreKey = `${roomId}-${targetDate}`;
    setIgnoredPrices({ ...ignoredPrices, [ignoreKey]: true });
  };

  if (loading) return <div style={{ padding: "20px" }}>Loading recommendations...</div>;

  return (
    <div style={{ padding: "40px" }}>
      <h1>📊 Pricing Optimizer</h1>

      <div style={{ marginBottom: "20px" }}>
        <label>Show recommendations for next:</label>
        <select
          value={daysAhead}
          onChange={(e) => setDaysAhead(parseInt(e.target.value))}
          style={{ marginLeft: "10px", padding: "8px" }}
        >
          <option value={7}>7 days</option>
          <option value={14}>14 days</option>
          <option value={30}>30 days</option>
        </select>
      </div>

      {recommendations.length === 0 ? (
        <p>No recommendations available</p>
      ) : (
        <div>
          {recommendations.map((rec, idx) => {
            // Check state using the unique room + date key
            const uniqueKey = `${rec.room_id}-${rec.date}`;
            const isIgnored = ignoredPrices[uniqueKey];
            const isApplied = appliedPrices[uniqueKey];

            if (isIgnored) return null;

            return (
              <div
                key={idx}
                style={{
                  border: "1px solid #150707",
                  padding: "20px",
                  marginBottom: "15px",
                  borderRadius: "8px",
                  backgroundColor: "#f9f9f9",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                  {/* Left column */}
                  <div>
                    <h3>{rec.room_type}</h3>
                    <p>
                      <strong>Date:</strong> {rec.date}
                    </p>
                    <p>
                      <strong>Base Price:</strong> ₹{rec.base_price}
                    </p>
                    <p style={{ fontSize: "18px", fontWeight: "bold", color: "#28a745" }}>
                      <strong>Recommended Price:</strong> ₹{rec.calculated_price}
                    </p>
                    <p style={{ color: "#007bff" }}>
                      <strong>Increase:</strong> ₹{rec.price_increase} (+{rec.price_increase_percent}%)
                    </p>
                  </div>

                  {/* Right column - Factors */}
                  <div>
                    <h4>Factors Affecting Price:</h4>
                    <ul style={{ listStyle: "none", padding: 0 }}>
                      {rec.reasons.map((reason, i) => (
                        <li key={i} style={{ padding: "5px 0", borderBottom: "1px solid #eee" }}>
                          ✓ {reason}
                        </li>
                      ))}
                    </ul>

                    <div style={{ marginTop: "15px" }}>
                      <p>
                        <strong>Current Occupancy:</strong> {rec.factors.occupancy_rate}%
                      </p>
                      <p>
                        <strong>Days Until Check-in:</strong> {rec.factors.days_until}
                      </p>
                      <p>
                        <strong>Weekend:</strong> {rec.factors.is_weekend ? "Yes" : "No"}
                      </p>
                      <p>
                        <strong>Holiday:</strong> {rec.factors.is_holiday ? "Yes" : "No"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ marginTop: "15px", display: "flex", gap: "10px" }}>
                  <button
                    // TWEAK 5: Pass the target date to the handler
                    onClick={() => handleApplyPrice(rec.room_id, rec.calculated_price, rec.date)}
                    disabled={isApplied}
                    style={{
                      padding: "10px 20px",
                      backgroundColor: isApplied ? "#ccc" : "#28a745",
                      color: "white",
                      border: "none",
                      borderRadius: "5px",
                      cursor: isApplied ? "not-allowed" : "pointer",
                      fontSize: "14px",
                    }}
                  >
                    {isApplied ? "✓ Applied" : "Apply Price"}
                  </button>

                  <button
                    onClick={() => handleIgnorePrice(rec.room_id, rec.date)}
                    style={{
                      padding: "10px 20px",
                      backgroundColor: "#6c757d",
                      color: "white",
                      border: "none",
                      borderRadius: "5px",
                      cursor: "pointer",
                      fontSize: "14px",
                    }}
                  >
                    Ignore
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PricingOptimizer;