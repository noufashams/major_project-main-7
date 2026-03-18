
import { useState, useEffect } from "react";
import axios from "axios";

function RoomManagement() {
  const [rooms, setRooms] = useState([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [loading, setLoading] = useState(true);
  const [roomTypeChoice, setRoomTypeChoice] = useState("custom");

  const [formData, setFormData] = useState({
    room_type: "",
    description: "",
    capacity: 2,
    price_per_night: 0,
    total_rooms: 1,
    amenities: [],
  });

  // State to hold selected image files
  const [pictures, setPictures] = useState([]);
  const [selectedAmenities, setSelectedAmenities] = useState([]);
  const roomTypeOptions = [
    "Standard Room",
    "Deluxe Room",
    "Superior Room",
    "Executive Room",
    "Suite",
    "Family Room",
    "Studio",
    "Villa",
    "Cottage"
  ];

  const amenityOptions = [
    "WiFi",
    "Air Conditioning",
    "TV",
    "Private Bathroom",
    "Bathtub",
    "Shower",
    "Minibar",
    "Room Service",
    "Safe",
    "Work Desk",
    "Breakfast Included",
    "Airport Shuttle",
    "Parking",
    "Laundry",
    "Gym Access",
    "Pool Access",
    "Coffee Maker",
    "Veg Food",
    "Non-Veg Food",
    "Housekeeping"
  ];

  useEffect(() => {
    fetchRooms();
  }, []);

  const fetchRooms = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem("token");
      const response = await axios.get(
        "http://localhost:3000/api/rooms",
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setRooms(response.data || []);
    } catch (err) {
      console.error("Error fetching rooms:", err);
    } finally {
      setLoading(false);
    }
  };

  // Function to handle file selection
  const handlePictureChange = (e) => {
    setPictures(e.target.files);
  };

  const handleAddRoom = async (e) => {
    e.preventDefault();

    if (!formData.room_type || !formData.description || !formData.price_per_night) {
      alert("Please fill all required fields");
      return;
    }

    try {
      const token = localStorage.getItem("token");

      // Use FormData to send files and text data together
      const data = new FormData();
      data.append("room_type", formData.room_type);
      data.append("description", formData.description);
      data.append("capacity", formData.capacity);
      data.append("price_per_night", formData.price_per_night);
      data.append("total_rooms", formData.total_rooms);
      
      // Append each selected amenity
      selectedAmenities.forEach(amenity => {
        data.append("amenities", amenity);
      });

      // Append each selected picture file
      for (let i = 0; i < pictures.length; i++) {
        data.append("room_images", pictures[i]);
      }

      if (editingRoom) {
        // Update existing room (without replacing images by default)
        data.append("replace_images", "false");
        await axios.put(`http://localhost:3000/api/rooms/${editingRoom.room_id}`, data, {
          headers: { 
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data"
          },
        });
        alert("✅ Room updated!");
      } else {
        // Create new room with images
        await axios.post("http://localhost:3000/api/rooms", data, {
          headers: { 
            Authorization: `Bearer ${token}`,
            "Content-Type": "multipart/form-data" // Important header for file uploads
          },
        });
        alert("✅ Room added with pictures!");
      }

      // Reset form and state
      setShowAddForm(false);
      setEditingRoom(null);
      setFormData({
        room_type: "", description: "", capacity: 2,
        price_per_night: 0, total_rooms: 1, amenities: [],
      });
      setSelectedAmenities([]);
      setPictures([]);

      // Refresh rooms list
      fetchRooms();
    } catch (err) {
      alert("Error: " + (err.response?.data?.message || err.message));
    }
  };

  const handleEditRoom = (room) => {
    setEditingRoom(room);
    setRoomTypeChoice(roomTypeOptions.includes(room.room_type) ? room.room_type : "custom");
    setFormData({
      room_type: room.room_type,
      description: room.description || "",
      capacity: room.capacity || 2,
      price_per_night: room.price_per_night,
      total_rooms: room.total_rooms,
      amenities: room.amenities || [],
    });
    setSelectedAmenities(room.amenities || []);
    // Note: We don't set pictures here for editing in this simple version
    setShowAddForm(true);
  };

  const handleDeleteRoom = async (roomId) => {
    if (!window.confirm("Are you sure you want to delete this room?")) return;
    try {
      const token = localStorage.getItem("token");
      await axios.delete(`http://localhost:3000/api/rooms/${roomId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      alert("✅ Room deleted!");
      fetchRooms();
    } catch (err) {
      alert("Error: " + err.message);
    }
  };

  if (loading) return <div style={{ padding: "20px", color: "#0f172a" }}>Loading rooms...</div>;

  return (
    <div style={{
      minHeight: "100vh",
      padding: "32px 20px",
      backgroundImage: "linear-gradient(140deg, rgba(8,12,24,0.75), rgba(10,16,28,0.60)), url('https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1800&q=80&sat=-10')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      color: "#e5e7eb",
      fontFamily: "'Inter', system-ui, sans-serif"
    }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
          <div>
            <p style={{ margin: 0, letterSpacing: "0.12em", fontSize: "11px", color: "#cbd5e1" }}>INVENTORY</p>
            <h1 style={{ margin: "4px 0 0", fontSize: "30px", color: "#f8fafc" }}>Room Management</h1>
            <p style={{ margin: "4px 0 0", color: "#cbd5e1" }}>{rooms.length} rooms in your property</p>
          </div>
          <button
            onClick={() => {
              setShowAddForm(!showAddForm);
              setEditingRoom(null);
              setRoomTypeChoice("custom");
              setFormData({
                room_type: "", description: "", capacity: 2,
                price_per_night: 0, total_rooms: 1, amenities: [],
              });
              setSelectedAmenities([]);
              setPictures([]);
            }}
            style={primaryButton}
          >
            {showAddForm ? "Cancel" : "＋ Add New Room"}
          </button>
        </header>

        {showAddForm && (
          <div style={cardStyle}>
            <h2 style={{ marginTop: 0, marginBottom: "12px", color: "#f8fafc" }}>{editingRoom ? "Edit Room" : "Add New Room"}</h2>
            <form onSubmit={handleAddRoom} style={{ display: "grid", gap: "14px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={labelStyle}>Room Name / Type *</label>
                  <select
                    value={roomTypeChoice}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRoomTypeChoice(val);
                      setFormData({ ...formData, room_type: val === "custom" ? "" : val });
                    }}
                    style={{ ...inputStyle, color: "#0f172a" }}
                  >
                    <option value="custom">Custom...</option>
                    {roomTypeOptions.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                  {roomTypeChoice === "custom" && (
                    <input
                      type="text"
                      value={formData.room_type}
                      onChange={(e) => setFormData({ ...formData, room_type: e.target.value })}
                      style={{ ...inputStyle, marginTop: "8px" }}
                      placeholder="Enter room name/type"
                      required
                    />
                  )}
                </div>
                <div>
                  <label style={labelStyle}>Price Per Night (₹) *</label>
                  <input type="number" min="0" value={formData.price_per_night} onChange={(e) => setFormData({ ...formData, price_per_night: parseInt(e.target.value) })} style={inputStyle} required />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <label style={labelStyle}>Guest Capacity *</label>
                  <input type="number" min="1" value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Total Rooms *</label>
                  <input type="number" min="1" value={formData.total_rooms} onChange={(e) => setFormData({ ...formData, total_rooms: parseInt(e.target.value) })} style={inputStyle} required />
                </div>
              </div>

              <div>
                <label style={labelStyle}>Description *</label>
                <textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} style={{...inputStyle, minHeight: "90px", fontFamily: "Inter"}} required />
              </div>

              <div>
                <label style={labelStyle}>Room Pictures (Max 5)</label>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handlePictureChange}
                  style={inputStyle}
                />
              </div>

              <div>
                <label style={labelStyle}>Amenities</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "8px" }}>
                  {amenityOptions.map((amenity) => {
                    const checked = selectedAmenities.includes(amenity);
                    return (
                      <label key={amenity} style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "7px 12px",
                        borderRadius: "12px",
                        cursor: "pointer",
                        border: `1px solid ${checked ? "rgba(96,165,250,0.8)" : "rgba(255,255,255,0.2)"}`,
                        background: checked ? "rgba(96,165,250,0.16)" : "rgba(255,255,255,0.08)",
                        color: "#f8fafc",
                        boxShadow: checked ? "0 8px 18px rgba(37,99,235,0.18)" : "none"
                      }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAmenities([...selectedAmenities, amenity]);
                            } else {
                              setSelectedAmenities(selectedAmenities.filter((a) => a !== amenity));
                            }
                          }}
                        />
                        {amenity}
                      </label>
                    );
                  })}
                </div>
              </div>

              <button type="submit" style={primaryButton}>
                {editingRoom ? "Update Room" : "Create Room"}
              </button>
            </form>
          </div>
        )}

        <h2 style={{ marginTop: "32px", color: "#0f172a" }}>Your Rooms ({rooms.length})</h2>
        {rooms.length === 0 ? (
          <p style={{ color: "#475569" }}>No rooms added yet. Click "Add New Room" to get started.</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px", marginTop: "12px" }}>
            {rooms.map((room) => (
              <div key={room.room_id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                  <div>
                    <h3 style={{ margin: "0 0 4px", color: "#0f172a" }}>{room.room_type}</h3>
                    <p style={{ margin: 0, color: "#93c5fd", fontWeight: 700 }}>₹{room.price_per_night} / night • Capacity {room.capacity}</p>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={() => handleEditRoom(room)} style={{...chipButton, backgroundColor: "#e0ecff", color: "#1d4ed8", borderColor: "#bfdbfe"}}>Edit</button>
                    <button onClick={() => handleDeleteRoom(room.room_id)} style={{...chipButton, backgroundColor: "#ffe4e6", color: "#b91c1c", borderColor: "#fecdd3"}}>Delete</button>
                  </div>
                </div>

                <p style={{ margin: "10px 0", color: "#cbd5e1" }}>{room.description}</p>

                {room.amenities && room.amenities.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "10px" }}>
                    {room.amenities.map((a, i) => (
                      <span key={i} style={amenityChip}>{a}</span>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: "10px", borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: "10px" }}>
                  <h4 style={{ margin: "0 0 8px", color: "#f8fafc" }}>Room Pictures</h4>
                  {room.pictures && room.pictures.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "8px", maxWidth: "260px" }}>
                      {room.pictures.slice(0, 4).map((pic) => (
                        <div key={pic.picture_id} style={{ position: "relative", overflow: "hidden", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.18)", boxShadow: "0 5px 10px rgba(0,0,0,0.18)", background: "rgba(255,255,255,0.06)" }}>
                          <img
                            src={pic.picture_url}
                            alt="Room"
                            style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", display: "block", maxHeight: "120px" }}
                          />
                        </div>
                      ))}
                      {room.pictures.length > 4 && (
                        <div style={{
                          position: "relative",
                          borderRadius: "6px",
                          border: "1px solid rgba(255,255,255,0.18)",
                          background: "rgba(255,255,255,0.08)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          height: "120px",
                          color: "#f8fafc",
                          fontWeight: 700,
                          boxShadow: "0 5px 10px rgba(0,0,0,0.18)"
                        }}>
                          +{room.pictures.length - 4} more
                        </div>
                      )}
                    </div>
                  ) : (
                    <p style={{color: "#94a3b8", margin: 0}}>No pictures added for this room.</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  marginTop: "5px",
  boxSizing: "border-box",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: "10px",
  backgroundColor: "rgba(255,255,255,0.08)",
  color: "#f8fafc",
  boxShadow: "0 6px 16px rgba(0,0,0,0.15)"
};

const labelStyle = {
  fontSize: "13px",
  fontWeight: 700,
  color: "#f8fafc",
  letterSpacing: "0.02em"
};

const primaryButton = {
  padding: "12px 20px",
  background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: "12px",
  cursor: "pointer",
  fontSize: "15px",
  fontWeight: "700",
  letterSpacing: "0.01em",
  boxShadow: "0 14px 30px rgba(124,58,237,0.28)"
};

const cardStyle = {
  background: "rgba(255,255,255,0.10)",
  border: "1px solid rgba(255,255,255,0.20)",
  borderRadius: "16px",
  padding: "20px",
  boxShadow: "0 20px 50px rgba(0,0,0,0.38)",
  backdropFilter: "blur(14px)",
  WebkitBackdropFilter: "blur(14px)"
};

const chipButton = {
  padding: "8px 12px",
  borderRadius: "10px",
  border: "1px solid rgba(255,255,255,0.2)",
  cursor: "pointer",
  fontWeight: 700,
  background: "rgba(255,255,255,0.08)",
  color: "#e5e7eb",
  boxShadow: "0 8px 18px rgba(0,0,0,0.18)"
};

const amenityChip = {
  display: "inline-block",
  backgroundColor: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255,255,255,0.20)",
  padding: "6px 10px",
  borderRadius: "10px",
  fontSize: "12px",
  color: "#f8fafc",
  boxShadow: "0 6px 14px rgba(0,0,0,0.18)"
};

export default RoomManagement;
