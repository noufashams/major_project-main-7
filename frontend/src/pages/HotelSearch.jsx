import { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function HotelSearch() {
  const [query, setQuery] = useState("");
  const [hotels, setHotels] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState("");
  const [sortOption, setSortOption] = useState("relevance");
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem("favoriteHotels");
    return saved ? JSON.parse(saved) : [];
  });
  // Reviews modal
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [reviewHotel, setReviewHotel] = useState(null);
  const [reviewRatings, setReviewRatings] = useState([]);
  const [reviewFilter, setReviewFilter] = useState("all");
  const [loadingReviews, setLoadingReviews] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const loadLocations = async () => {
      try {
        const res = await axios.get("http://localhost:3000/api/hotels/locations");
        setLocations(res.data.locations || []);
      } catch (err) {
        console.error("Failed to load locations", err);
        // Fallback: we'll hydrate from search results later
      }
    };
    loadLocations();
  }, []);

  const handleSearch = async () => {
    const hasQuery = query.trim().length > 0;
    const hasLocation = selectedLocation.trim().length > 0;
    if (!hasQuery && !hasLocation) return;

    try {
      setLoadingSearch(true);
      const res = await axios.get("http://localhost:3000/api/hotels/search", {
        params: {
          q: hasQuery ? query : undefined,
          location: hasLocation ? selectedLocation : undefined,
        },
      });

      setHotels(res.data.results);
      setHasSearched(true);
      // If dropdown was empty (e.g., location fetch failed), hydrate from results
      if ((locations?.length || 0) === 0 && Array.isArray(res.data.results)) {
        const uniq = Array.from(new Set(res.data.results.map((h) => h.location).filter(Boolean)));
        setLocations(uniq);
      }

    } catch (err) {
      console.error(err);
      alert("Error fetching hotels");
    } finally {
      setLoadingSearch(false);
    }
  };

  const toggleFavorite = (hotel) => {
    const exists = favorites.includes(hotel.hotel_id);
    let updated;
    if (exists) {
      updated = favorites.filter((id) => id !== hotel.hotel_id);
    } else {
      updated = [...favorites, hotel.hotel_id];
    }
    setFavorites(updated);
    localStorage.setItem("favoriteHotels", JSON.stringify(updated));
  };

  const openReviews = async (hotel) => {
    setReviewHotel(hotel);
    setReviewModalOpen(true);
    setReviewFilter("all");
    setLoadingReviews(true);
    try {
      // Reuse the hotel detail endpoint to hydrate ratings
      const res = await axios.get(`http://localhost:3000/api/hotels/${hotel.slug}`);
      setReviewRatings(res.data.ratings || []);
    } catch (err) {
      console.error("Failed to load reviews", err);
      setReviewRatings([]);
    } finally {
      setLoadingReviews(false);
    }
  };

  const sortedFilteredHotels = [...hotels].sort((a, b) => {
    const ra = Number(a.avg_rating || 0);
    const rb = Number(b.avg_rating || 0);
    if (sortOption === "rating_desc") return rb - ra;
    if (sortOption === "reviews_desc") return (b.rating_count || 0) - (a.rating_count || 0);
    if (sortOption === "price_asc") return (Number(a.min_price || 0)) - (Number(b.min_price || 0));
    if (sortOption === "price_desc") return (Number(b.min_price || 0)) - (Number(a.min_price || 0));
    return 0; // relevance (as returned)
  });

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      backgroundColor: "#111827",
      backgroundImage: "linear-gradient(125deg, rgba(0,0,0,0.04), rgba(0,0,0,0.12)), url('https://images.unsplash.com/photo-1512453979798-5ea266f8880c?auto=format&fit=crop&w=2000&q=80')",
      backgroundSize: "cover",
      backgroundPosition: "center center",
      backgroundRepeat: "no-repeat",
      backgroundBlendMode: "overlay",
      color: "#f8fafc",
      padding: "48px 20px"
    }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <p style={{ letterSpacing: "6px", textTransform: "uppercase", color: "#fde68a", marginBottom: "8px", fontSize: "12px", fontWeight: 700 }}>Moodboard</p>
          <h1 style={{ fontSize: "40px", margin: 0, color: "#fff7ed", letterSpacing: "1px", textShadow: "0 6px 20px rgba(0,0,0,0.35)" }}>FIND YOUR ROOMS</h1>
          <p style={{ marginTop: "8px", color: "#f1f5f9", fontSize: "15px" }}>Save, share, and book hotels that match your vibe.</p>
        </div>

        <div style={{
          background: "rgba(0,0,0,0.38)",
          border: "1px solid rgba(255,255,255,0.16)",
          borderRadius: "18px",
          padding: "16px",
          display: "flex",
          gap: "10px",
          flexWrap: "wrap",
          alignItems: "center",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)"
        }}>
          <input
            placeholder="Search by city or hotel"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              padding: "12px 14px",
              flex: "1 1 260px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(0,0,0,0.35)",
              color: "#f8fafc"
            }}
          />
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              padding: "12px 14px",
              minWidth: "200px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.16)",
              background: "rgba(0,0,0,0.35)",
              color: "#f8fafc"
            }}
          >
            <option value="">Select location</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
          <button
            onClick={handleSearch}
            style={{
              padding: "12px 22px",
              borderRadius: "12px",
              background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
              color: "white",
              border: "none",
              cursor: "pointer",
              boxShadow: "0 12px 28px rgba(124,58,237,0.32)"
            }}
          >
            Search
          </button>
        </div>

        <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "13px", color: "#cbd5e1" }}>Sort:</span>
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value)}
              style={{
                padding: "8px 10px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.16)",
                background: "rgba(0,0,0,0.32)",
                color: "#f8fafc"
              }}
            >
              <option value="rating_desc">Highest Rated</option>
              <option value="reviews_desc">Most Reviewed</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>
        </div>
        <div style={{ marginTop: "20px", display: "grid", gap: "14px" }}>
          {loadingSearch && sortedFilteredHotels.length === 0 && (
            <div style={{ display: "grid", gap: "12px" }}>
              {[1,2,3].map(i => (
                <div key={i} style={{
                  background: "rgba(0,0,0,0.32)",
                  border: "1px solid rgba(255,255,255,0.20)",
                  borderRadius: "16px",
                  padding: "14px",
                  display: "grid",
                  gridTemplateColumns: "110px 1fr",
                  gap: "14px",
                  backdropFilter: "blur(16px)"
                }}>
                  <div style={{ width: "110px", height: "110px", borderRadius: "12px", background: "rgba(255,255,255,0.12)" }} />
                  <div>
                    <div style={{ height: "18px", width: "160px", background: "rgba(255,255,255,0.10)", borderRadius: "6px", marginBottom: "8px" }} />
                    <div style={{ height: "14px", width: "100px", background: "rgba(255,255,255,0.08)", borderRadius: "6px", marginBottom: "6px" }} />
                    <div style={{ height: "14px", width: "120px", background: "rgba(255,255,255,0.08)", borderRadius: "6px" }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loadingSearch && sortedFilteredHotels.length === 0 && hasSearched && (
            <div style={{
              background: "rgba(0,0,0,0.32)",
              border: "1px solid rgba(255,255,255,0.20)",
              borderRadius: "16px",
              padding: "18px",
              textAlign: "center",
              color: "#cbd5e1",
              backdropFilter: "blur(16px)"
            }}>
              <p style={{ margin: 0, fontWeight: 600 }}>No hotels match your filters.</p>
              <p style={{ margin: "6px 0 0" }}>Try broadening your search or another city.</p>
            </div>
          )}

          {sortedFilteredHotels.map((hotel) => (
            <div
              key={hotel.hotel_id}
              style={{
                background: "rgba(0,0,0,0.32)",
                border: "1px solid rgba(255,255,255,0.20)",
                borderRadius: "16px",
                padding: "14px",
                display: "grid",
                gridTemplateColumns: "110px 1fr",
                gap: "14px",
                cursor: "pointer",
                boxShadow: "0 18px 46px rgba(0,0,0,0.40)",
                backdropFilter: "blur(18px)",
                WebkitBackdropFilter: "blur(18px)"
              }}
              onClick={() => navigate(`/hotel/${hotel.slug}`)}
            >
              <div style={{ width: "110px", height: "110px", borderRadius: "12px", overflow: "hidden", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)" }}>
                {hotel.preview_image ? (
                  <img
                    src={hotel.preview_image}
                    alt="Hotel preview"
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#94a3b8", fontSize: "12px" }}>
                    No image
                  </div>
                )}
              </div>
              <div>
                <h3 style={{ margin: "0 0 4px 0", fontSize: "20px", color: "#f8fafc" }}>{hotel.hotel_name}</h3>
                <p style={{ margin: 0, color: "#cbd5e1" }}>{hotel.location}</p>
                <p style={{ margin: "6px 0 4px 0", color: "#f8fafc", fontWeight: 700 }}>
                  From ₹{hotel.min_price ? Number(hotel.min_price).toFixed(0) : "—"} / night
                </p>
                <p style={{ margin: "6px 0 6px 0", color: "#fbbf24", fontSize: "14px", fontWeight: 600, display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                  <span>⭐ {Number(hotel.avg_rating || 0).toFixed(1)} ({hotel.rating_count || 0} reviews)</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); openReviews(hotel); }}
                    style={{
                      border: "1px solid rgba(255,255,255,0.32)",
                      background: "rgba(96,165,250,0.16)",
                      color: "#dbeafe",
                      borderRadius: "999px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: "12px",
                      boxShadow: "0 8px 18px rgba(37,99,235,0.25)"
                    }}
                  >
                    View reviews
                  </button>
                </p>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "6px" }}>
                  {Number(hotel.avg_rating || 0) >= 4.5 && (
                    <span style={badgeStyle("#22c55e", "rgba(34,197,94,0.14)")}>High Rated</span>
                  )}
                  {hotel.rating_count > 20 && (
                    <span style={badgeStyle("#38bdf8", "rgba(56,189,248,0.14)")}>Popular</span>
                  )}
                  {!hotel.preview_image && (
                    <span style={badgeStyle("#f97316", "rgba(249,115,22,0.14)")}>No image</span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFavorite(hotel); }}
                    style={{
                      border: "1px solid rgba(255,255,255,0.2)",
                      background: favorites.includes(hotel.hotel_id) ? "rgba(248,113,113,0.18)" : "rgba(255,255,255,0.08)",
                      color: favorites.includes(hotel.hotel_id) ? "#fecdd3" : "#e5e7eb",
                      borderRadius: "999px",
                      padding: "4px 10px",
                      cursor: "pointer",
                      fontWeight: 700
                    }}
                  >
                    {favorites.includes(hotel.hotel_id) ? "♥ Liked" : "♡ Like"}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Reviews modal */}
        {reviewModalOpen && (
          <div style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.65)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 2000
          }}>
            <div style={{
              width: "620px",
              maxHeight: "80vh",
              overflow: "hidden",
              background: "#0f172a",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: "16px",
              boxShadow: "0 24px 60px rgba(0,0,0,0.5)",
              display: "flex",
              flexDirection: "column"
            }}>
              <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center", color: "#e2e8f0" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{reviewHotel?.hotel_name || "Reviews"}</div>
                  <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                    {reviewHotel?.location} • {reviewRatings.length} review{reviewRatings.length === 1 ? "" : "s"}
                  </div>
                </div>
                <button onClick={() => setReviewModalOpen(false)} style={{ background: "none", border: "none", color: "#e2e8f0", cursor: "pointer", fontSize: "20px" }}>×</button>
              </div>

              <div style={{ padding: "12px 16px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <span style={{ fontSize: "13px", color: "#cbd5e1" }}>Filter by rating:</span>
                {["all", "5", "4", "3"].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => setReviewFilter(opt)}
                    style={{
                      padding: "6px 12px",
                      borderRadius: "12px",
                      border: `1px solid ${reviewFilter === opt ? "rgba(167,139,250,0.8)" : "rgba(255,255,255,0.18)"}`,
                      background: reviewFilter === opt ? "rgba(167,139,250,0.16)" : "rgba(255,255,255,0.06)",
                      color: "#e2e8f0",
                      cursor: "pointer",
                      fontWeight: 600
                    }}
                  >
                    {opt === "all" ? "All" : `${opt}★ & up`}
                  </button>
                ))}
              </div>

              <div style={{ flex: 1, overflowY: "auto", padding: "16px", background: "rgba(15,23,42,0.8)" }}>
                {loadingReviews && (
                  <p style={{ color: "#cbd5e1", margin: 0 }}>Loading reviews...</p>
                )}
                {!loadingReviews && reviewRatings.filter(r => {
                  const v = Number(r.rating || 0);
                  if (reviewFilter === "5") return v >= 5;
                  if (reviewFilter === "4") return v >= 4;
                  if (reviewFilter === "3") return v >= 3;
                  return true;
                }).map((r, idx) => (
                  <div key={idx} style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "12px",
                    padding: "12px",
                    color: "#e2e8f0",
                    marginBottom: "10px"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <strong>{r.guest_name || "Anonymous"}</strong>
                      <span style={{ color: "#fbbf24", fontWeight: 700 }}>★ {Number(r.rating || 0).toFixed(1)}</span>
                    </div>
                    {r.comment && <p style={{ margin: "8px 0 0", color: "#cbd5e1", lineHeight: 1.5 }}>{r.comment}</p>}
                  </div>
                ))}
                {!loadingReviews && reviewRatings.length === 0 && (
                  <p style={{ color: "#94a3b8", margin: 0 }}>No reviews yet.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default HotelSearch;

const pill = (active) => ({
  padding: "8px 12px",
  borderRadius: "999px",
  border: `1px solid ${active ? "rgba(96,165,250,0.8)" : "rgba(255,255,255,0.18)"}`,
  background: active ? "rgba(96,165,250,0.16)" : "rgba(255,255,255,0.08)",
  color: "#f8fafc",
  cursor: "pointer",
  fontWeight: 600,
  boxShadow: active ? "0 8px 18px rgba(37,99,235,0.18)" : "none"
});

const badgeStyle = (color, bg) => ({
  padding: "4px 10px",
  borderRadius: "999px",
  fontSize: "12px",
  color,
  background: bg,
  border: `1px solid ${bg.replace("0.14", "0.35")}`
});
