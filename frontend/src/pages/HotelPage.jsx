
import React from "react";
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import { useRef } from "react";

function HotelPage() {
  const { slug } = useParams();
  const [hotel, setHotel] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState([]);
  const [ratingForm, setRatingForm] = useState({ rating: 5, guest_name: "", comment: "" });
  const [bookingRating, setBookingRating] = useState({ rating: 0, guest_name: "", comment: "" });
  const [ratingHotelId, setRatingHotelId] = useState(null);
  const [licenseFile, setLicenseFile] = useState(null);
  // NEW: The Memory Bucket
  const [chatState, setChatState] = useState({});
  // 1. Date Selection State
  const [checkIn, setCheckIn] = useState(new Date().toISOString().split("T")[0]);
  const [checkOut, setCheckOut] = useState("");

  // 2. Booking Form State (Replaces the prompt alerts)
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [bookingDetails, setBookingDetails] = useState({
    guestName: "",
    guestEmail: "",
    guestPhone: "",
    numRooms: 1,
    adults: 2,
    children: 0,
    payOnArrival: false
  });

  // 4. Payment Simulation State
  const [showPayment, setShowPayment] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  // Manage Booking States
  const [showLookup, setShowLookup] = useState(false);
  const [lookupRef, setLookupRef] = useState("");
  const [lookupPhone, setLookupPhone] = useState("");
  const [foundBooking, setFoundBooking] = useState(null);
  // lightbox state (room id + photo index)
  const [lightbox, setLightbox] = useState({ roomId: null, index: 0 });


  // 3. AI Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { sender: "ai", text: "Hi! I'm the AI Receptionist. How can I help you with your booking?" }
  ]);
  const [isRecording, setIsRecording] = useState(false);
  const [canUseSpeech, setCanUseSpeech] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(false);
  const recognitionRef = useRef(null);
  const synthRef = useRef(window.speechSynthesis || null);

  // 4. Voice State
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speakingMsgIndex, setSpeakingMsgIndex] = useState(null);
  const [spokenWordIndex, setSpokenWordIndex] = useState(-1);

  const colors = {
    // base palette for glass cards
    cardBg: "rgba(255,255,255,0.88)",
    border: "rgba(15,18,32,0.08)",
    text: "#0b1220",
    muted: "#334155",
    accent: "#b2832f"
  };

  const buildEmbedSrc = () => {
    // If the owner gave a full embed URL, use it directly
    if (hotel?.google_maps_url && hotel.google_maps_url.includes("embed")) {
      return hotel.google_maps_url;
    }
    // Fallback: build an embed link from the provided URL or location text
    const q = encodeURIComponent(hotel?.google_maps_url || `${hotel?.hotel_name || ""} ${hotel?.address || hotel?.location || ""}`);
    return `https://www.google.com/maps?q=${q}&output=embed`;
  };

  useEffect(() => {
    fetchHotelData();
  }, [slug, checkIn, checkOut]);

  // Set up Web Speech API availability
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.lang = "en-US";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      recognitionRef.current = rec;
      setCanUseSpeech(true);
    }
  }, []);

  const speak = (text) => {
    if (!ttsEnabled || !synthRef.current || !text) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 1;
    synthRef.current.cancel();
    synthRef.current.speak(utter);
  };

  const renderStars = (value) => {
    const v = Math.round(value || 0);
    return (
      <span style={{ color: "#b2832f", letterSpacing: "2px", fontSize: "20px" }}>
        {"★".repeat(v).padEnd(5, "☆")}
      </span>
    );
  };

  const RatingStars = ({ value, onChange }) => (
    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={() => onChange(n)}
          style={{
            cursor: "pointer",
            fontSize: "22px",
            color: n <= value && value > 0 ? colors.accent : "#cbd5e1"
          }}
        >
          ★
        </span>
      ))}
    </div>
  );

  const fetchHotelData = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (checkIn) params.set("check_in", checkIn);
      if (checkOut) params.set("check_out", checkOut);
      if (checkIn) params.set("date", checkIn);
      const res = await axios.get(`http://localhost:3000/api/hotels/${slug}?${params.toString()}`);
      setHotel(res.data.hotel);
      setRooms(res.data.rooms);
      setRatings(res.data.ratings || []);
    } catch (err) {
      console.error(err);
      alert("Failed to load hotel details.");
    } finally {
      setLoading(false);
    }
  };

  const submitBookingRating = async () => {
    const targetHotelId = ratingHotelId || foundBooking?.hotel_id || hotel?.hotel_id;
    if (!bookingRating.rating || !targetHotelId) {
      console.warn("Rating submit blocked", { rating: bookingRating.rating, targetHotelId, foundBooking });
      alert("Missing booking or rating.");
      return;
    }
    try {
      const payload = {
        rating: bookingRating.rating,
        guest_name: bookingRating.guest_name,
        comment: bookingRating.comment
      };
      await axios.post(`http://localhost:3000/api/hotels/${targetHotelId}/ratings`, payload, {
        headers: { "Content-Type": "application/json" }
      });
      alert("Thanks for your feedback!");
      setBookingRating({ rating: 5, guest_name: "", comment: "" });
    } catch (err) {
      const msg = err.response?.data?.message || err.message || "Failed to submit rating";
      alert(msg);
    }
  };

  // Handles input changes for the booking form
  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setBookingDetails(prev => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };
  const handleLookupBooking = async () => {
    try {
      const res = await axios.post("http://localhost:3000/api/guest/lookup-booking", {
        booking_ref: lookupRef,
        guest_phone: lookupPhone
      });
      setFoundBooking(res.data);
      setRatingHotelId(res.data.hotel_id || hotel?.hotel_id || null);
    } catch (err) {
      alert("❌ " + (err.response?.data?.message || "Booking not found."));
      setFoundBooking(null);
      setRatingHotelId(null);
    }
  };

  const handleCancelBooking = async () => {
    // Double check with the user before destroying their booking
    if (!window.confirm("Are you sure you want to cancel your booking? This cannot be undone.")) {
      return;
    }

    try {
      await axios.post("http://localhost:3000/api/guest/cancel-booking", {
        booking_ref: foundBooking.booking_ref,
        guest_phone: lookupPhone // We reuse the phone number they typed into the lookup input
      });

      alert("✅ Booking cancelled successfully.");

      // Refresh the lookup receipt so it turns RED and says "CANCELLED"
      handleLookupBooking();

      // Refresh the hotel availability so the calendar immediately shows the room as free again!
      fetchHotelData();

    } catch (err) {
      alert("❌ " + (err.response?.data?.message || "Failed to cancel booking."));
    }
  };
  // Submits the actual booking
  const processRealBooking = async () => {
    if (!checkIn || !checkOut) {
      alert("Please select both Check-In and Check-Out dates at the top of the page.");
      return;
    }
    if (!bookingDetails.guestName || !bookingDetails.guestPhone || !bookingDetails.guestEmail) {
      alert("Please enter your name, email, and phone number.");
      return;
    }

    try {
      const form = new FormData();
      form.append("hotel_id", hotel.hotel_id);
      form.append("room_id", selectedRoomId);
      form.append("guest_name", bookingDetails.guestName);
      form.append("guest_email", bookingDetails.guestEmail);
      form.append("guest_phone", bookingDetails.guestPhone);
      form.append("check_in", checkIn);
      form.append("check_out", checkOut);
      form.append("number_of_rooms", bookingDetails.numRooms);
      form.append("adults", bookingDetails.adults);
      form.append("children", bookingDetails.children);
      form.append("pay_on_arrival", bookingDetails.payOnArrival ? "true" : "false");
      // Tag source & device for analytics
      form.append("booking_source", "web");
      const ua = navigator.userAgent || "";
      const isMobile = /Mobi|Android/i.test(ua);
      form.append("device", isMobile ? "mobile" : "desktop");
      if (licenseFile) form.append("license_file", licenseFile);

      const res = await axios.post("http://localhost:3000/api/bookings", form, {
        headers: { "Content-Type": "multipart/form-data" }
      });

      alert(`✅ Booking Confirmed!\n\nYour Reference is: ${res.data.booking_ref}\n\nPlease save this to manage your booking later.`);

      setSelectedRoomId(null);
      setBookingDetails({ guestName: "", guestEmail: "", guestPhone: "", numRooms: 1, adults: 2, children: 0, payOnArrival: false });
      setLicenseFile(null);

      setShowPayment(false);
      setIsProcessing(false);

      fetchHotelData(); // Refresh availability

    } catch (err) {
      setIsProcessing(false); // Stop spinner if it fails
      alert("❌ Booking Failed: " + (err.response?.data?.message || err.message));
    }
  };

  const handleProceedToPayment = () => {
    if (!checkIn || !checkOut || !bookingDetails.guestName || !bookingDetails.guestPhone || !bookingDetails.guestEmail) {
      alert("Please fill in all details.");
      return;
    }
    if (bookingDetails.payOnArrival) {
      processRealBooking();
    } else {
      setShowPayment(true);
    }
  };

  const handleSimulatePayment = () => {
    setIsProcessing(true); // Start the loading spinner

    // Wait exactly 2.5 seconds to make it feel real, then book the room
    setTimeout(() => {
      processRealBooking();
    }, 2500);
  };
  // const handleSendMessage = async () => {
  //   if (!chatInput.trim()) return;

  //   const newHistory = [...chatHistory, { sender: "user", text: chatInput }];
  //   setChatHistory(newHistory);
  //   setChatInput("");

  //   try {
  //     const res = await axios.post("http://localhost:3000/api/guest/query", {
  //       hotel_id: hotel.hotel_id,
  //       query_text: chatInput,
  //       history: newHistory
  //     });

  //     setChatHistory([...newHistory, { sender: "ai", text: res.data.reply }]);
  //   } catch (err) {
  //     setChatHistory([...newHistory, { sender: "ai", text: "Sorry, I am having trouble connecting to the front desk right now." }]);
  //   }
  // };
  // =====================
  // VOICE HELPERS
  // =====================
  const startListening = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Voice recognition is not supported in this browser. Please use Chrome."); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setIsListening(true);
    recognition.onerror = () => setIsListening(false);
    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join("");
      setChatInput(transcript);
    };
    // Auto-send when user stops speaking
    recognition.onend = () => {
      setIsListening(false);
      setTimeout(() => {
        // Use a ref-captured value so we can read the latest chatInput
        setChatInput(prev => { 
          if (prev.trim()) handleSendMessage(prev);
          return prev;
        });
      }, 200);
    };
    recognition.start();
    recognitionRef.current = recognition;
  };

  const stopListening = () => {
    recognitionRef.current?.stop();
    setIsListening(false);
  };

  const speakText = (text, msgIndex) => {
    if (!text || isSpeaking || !ttsEnabled) return;
    if (!window.speechSynthesis) { console.warn("Speech synthesis not supported"); return; }

    window.speechSynthesis.cancel(); // stop any current speech
    const words = text.split(/\s+/);
    const utterance = new SpeechSynthesisUtterance(text);

    // Pick a female English voice if available
    const voices = window.speechSynthesis.getVoices();
    const femaleVoice = voices.find(v =>
      v.lang.startsWith("en") && /female|zira|hazel|susan|samantha|victoria/i.test(v.name)
    ) || voices.find(v => v.lang.startsWith("en"));
    if (femaleVoice) utterance.voice = femaleVoice;
    utterance.rate = 1.0;
    utterance.pitch = 1.0;

    setIsSpeaking(true);
    setSpeakingMsgIndex(msgIndex);
    setSpokenWordIndex(0);

    utterance.onboundary = (event) => {
      if (event.name === "word") {
        // Count which word we're at by the char index
        const spoken = text.slice(0, event.charIndex + event.charLength);
        const wordIdx = spoken.trim().split(/\s+/).length - 1;
        setSpokenWordIndex(wordIdx);
      }
    };

    utterance.onend = () => {
      setIsSpeaking(false);
      setSpeakingMsgIndex(null);
      setSpokenWordIndex(-1);
    };

    utterance.onerror = () => {
      setIsSpeaking(false);
      setSpeakingMsgIndex(null);
      setSpokenWordIndex(-1);
    };

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setSpeakingMsgIndex(null);
    setSpokenWordIndex(-1);
  };

  const handleSendMessage = async () => {
    if (!chatInput.trim()) return;

    const newHistory = [...chatHistory, { sender: "user", text: chatInput }];
    setChatHistory(newHistory);
    setChatInput("");

    try {
      // Send the query AND the memory state to the backend
      const res = await axios.post("http://localhost:3000/api/guest/query", {
        hotel_id: hotel.hotel_id,
        query_text: chatInput,
        check_in: checkIn,
        check_out: checkOut,
        chatState: chatState // Pass memory
      });

      // Save the updated memory state!
      setChatState(res.data.chatState);

      // Add the AI's response to the chat window
      const newAiMsgIndex = newHistory.length; // index of the new AI message
      setChatHistory([...newHistory, { sender: "ai", text: res.data.reply }]);

      // Auto-speak the AI response (only if TTS is enabled)
      speakText(res.data.reply, newAiMsgIndex);

      // THE MAGIC HANDOFF:
      // THE MAGIC HANDOFF:
      if (res.data.intent === "TRIGGER_CHECKOUT") {
        // Ensure dates are set (fallback to today/tomorrow so checkout won't block)
        const today = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(today.getDate() + 1);
        const safeCheckIn = checkIn || today.toISOString().split("T")[0];
        const safeCheckOut = checkOut || tomorrow.toISOString().split("T")[0];
        setCheckIn(safeCheckIn);
        setCheckOut(safeCheckOut);

        // 1. Auto-fill the background booking form with the AI's collected data
        setBookingDetails({
          guestName: res.data.chatState.guest_name,
          guestEmail: res.data.chatState.guest_email || "",
          guestPhone: res.data.chatState.guest_phone,
          // Map the new slots! Default to 1 room, 2 adults, 0 children if somehow missed
          numRooms: res.data.chatState.num_rooms || 1,
          adults: res.data.chatState.adults || 2,
          children: res.data.chatState.children || 0,
          payOnArrival: res.data.chatState.pay_on_arrival ?? false
        });
        setSelectedRoomId(res.data.chatState.room_id);

        // 🚨 FIX: WIPE THE MEMORY BUCKET CLEAN SO IT FORGETS THIS BOOKING!
        setChatState({});

        // 2. Wait 2 seconds so they can read the final message, then pop the payment!
        setTimeout(() => {
          setIsChatOpen(false); // Close the chat window
          setShowPayment(true); // POP THE PAYMENT MODAL!
        }, 2000);
      }

    } catch (err) {
      setChatHistory([...newHistory, { sender: "ai", text: "Sorry, I am having trouble connecting to the front desk right now." }]);
    }
  };
  if (loading || !hotel) return <div style={{ padding: "50px", textAlign: "center" }}>Loading property details...</div>;

  return (
    <div style={{
      fontFamily: "system-ui, sans-serif",
      color: colors.text,
      backgroundImage: "linear-gradient(180deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.25) 60%, rgba(255,255,255,0.3) 100%), url('https://images.unsplash.com/photo-1540541338287-41700207dee6?auto=format&fit=crop&w=2000&q=80')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "fixed",
      minHeight: "100vh"
    }}>

      {/* WHITE-LABEL HERO SECTION */}
      <header style={{ backgroundColor: "rgba(255,255,255,0.55)", backdropFilter: "blur(10px)", color: colors.text, padding: "60px 20px", textAlign: "center", borderBottom: `1px solid ${colors.border}` }}>
        <button
          onClick={() => setShowLookup(true)}
          style={{ position: "absolute", top: "20px", right: "20px", background: "rgba(255,255,255,0.35)", color: colors.text, border: `1px solid ${colors.border}`, padding: "8px 16px", borderRadius: "10px", cursor: "pointer", backdropFilter: "blur(6px)" }}
        >
          🔍 Manage Booking
        </button>
        <h1 style={{
          fontSize: "48px",
          margin: "0 0 10px 0",
          color: "#f8fafc",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          textShadow: "0 2px 10px rgba(0,0,0,0.35)"
        }}>
          {hotel.hotel_name}
        </h1>
        <p style={{ fontSize: "18px", color: "#111827", margin: "0" }}>📍 {hotel.location} | {hotel.address}</p>
        {hotel.contact_phone && (
          <p style={{ margin: "6px 0 0 0", color: "#111827", fontWeight: 700 }}>
            📞 <a href={`tel:${hotel.contact_phone}`} style={{ color: "#111827", textDecoration: "none" }}>{hotel.contact_phone}</a>
          </p>
        )}
        <p style={{ margin: "8px 0 0 0", color: "#111827", fontSize: "16px", fontWeight: 700 }}>
          ⭐ {Number(hotel.avg_rating || 0).toFixed(1)} ({hotel.rating_count || 0} reviews)
        </p>
      </header>

      <main style={{ maxWidth: "1000px", margin: "40px auto", padding: "0 20px" }}>
        {/* Map */}
        {hotel.google_maps_url && (
          <section style={{ background: "rgba(255,255,255,0.78)", padding: "16px", borderRadius: "16px", border: "1px solid rgba(0,0,0,0.05)", marginBottom: "24px", backdropFilter: "blur(16px)", boxShadow: "0 24px 60px rgba(0,0,0,0.14)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
              <h2 style={{ margin: 0, color: colors.text }}>Location</h2>
              <a href={hotel.google_maps_url} target="_blank" rel="noreferrer" style={{ color: colors.accent, fontWeight: "600" }}>Open in Google Maps</a>
            </div>
            <div style={{ position: "relative", paddingBottom: "56.25%", height: 0, overflow: "hidden", borderRadius: "8px", border: "1px solid #e5e7eb" }}>
              <iframe
                title="Hotel map"
                src={buildEmbedSrc()}
                style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", border: 0 }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          </section>
        )}

        {/* Ratings removed from public view; now only after booking lookup */}

        {/* DATE PICKER */}
        <div style={{ backgroundColor: "rgba(255,255,255,0.78)", padding: "24px", borderRadius: "16px", boxShadow: "0 18px 40px rgba(0,0,0,0.12)", border: "1px solid rgba(0,0,0,0.05)", marginBottom: "30px", display: "flex", gap: "20px", alignItems: "center", flexWrap: "wrap", backdropFilter: "blur(12px)" }}>
          <div>
            <label style={labelStyle}>Check-In Date</label>
            <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} min={new Date().toISOString().split("T")[0]} style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Check-Out Date</label>
            <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} min={checkIn} style={inputStyle} />
          </div>
          <div style={{ alignSelf: "flex-end", paddingBottom: "10px", color: "#6b7280", fontSize: "14px" }}>
            *Prices adjust dynamically based on your selected dates.
          </div>
        </div>

        {/* ROOMS LIST */}
        <h2>Available Rooms</h2>
        <div style={{ display: "grid", gap: "20px" }}>
          {rooms.map((room) => (
            <div key={room.room_id} style={{ backgroundColor: "rgba(255,255,255,0.78)", padding: "24px", borderRadius: "18px", border: "1px solid rgba(0,0,0,0.05)", backdropFilter: "blur(16px)", boxShadow: "0 24px 60px rgba(0,0,0,0.14)" }}>

              {/* Room Header Info */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: "0 0 8px 0", fontSize: "24px", color: colors.text }}>{room.room_type}</h3>
                  <p style={{ margin: 0, color: colors.text }}>
                    <span style={{ fontSize: "24px", fontWeight: "bold", color: colors.accent }}>₹{room.price_per_night}</span> <span style={{ color: colors.muted }}>/ night</span>
                  </p>
                  {room.capacity && (
                    <p style={{ margin: "2px 0 0 0", fontSize: "14px", color: colors.muted }}>
                      Capacity: {room.capacity} {room.capacity === 1 ? 'person' : 'persons'}
                    </p>
                  )}
                  {typeof room.available_rooms !== "undefined" && (
                    <p style={{ margin: "2px 0 0 0", fontSize: "14px", color: "#16a34a", fontWeight: 600 }}>
                      {room.available_rooms} room{room.available_rooms === 1 ? "" : "s"} available
                    </p>
                  )}
                </div>

                {selectedRoomId !== room.room_id && (
                  <button onClick={() => setSelectedRoomId(room.room_id)} style={primaryButtonStyle}>
                    Book Room
                  </button>
                )}
              </div>

              {/* description, amenities and pictures */}
              {room.description && (
                <p style={{ margin: "12px 0", color: colors.muted }}>{room.description}</p>
              )}
              <div style={{ margin: "8px 0" }}>
                {(() => {
                  const list = [...(room.amenities || [])];
                  ["Veg Food", "Non-Veg Food"].forEach(tag => {
                    if (!list.includes(tag)) list.push(tag);
                  });
                  return list.map((a, i) => (
                    <span
                      key={i}
                      style={{
                        display: "inline-block",
                        backgroundColor: "#e5e7eb",
                        padding: "4px 8px",
                        borderRadius: "12px",
                        margin: "0 6px 6px 0",
                        fontSize: "13px",
                        color: "#374151"
                      }}
                    >
                      {a}
                    </span>
                  ));
                })()}
              </div>
              {room.pictures && room.pictures.length > 0 && (
                <div style={{ position: "relative", marginTop: "10px" }}>
                  <img
                    src={room.pictures[0].picture_url}
                    alt="Room"
                    onClick={() => setLightbox({ roomId: room.room_id, index: 0 })}
                    style={{
                      width: "200px",
                      height: "130px",
                      objectFit: "cover",
                      borderRadius: "10px",
                      cursor: "pointer",
                      border: `1px solid ${colors.border}`
                    }}
                  />
                  {room.pictures.length > 1 && (
                    <span style={{
                      position: "absolute",
                      bottom: "4px",
                      right: "4px",
                      backgroundColor: "rgba(0,0,0,0.6)",
                      color: "white",
                      padding: "2px 6px",
                      borderRadius: "12px",
                      fontSize: "12px",
                      zIndex: 1
                    }}>
                      +{room.pictures.length - 1}
                    </span>
                  )}
                </div>
              )}
              {selectedRoomId === room.room_id && (
                <div style={{ marginTop: "16px" }}>
                  <div>
                    <label style={labelStyle}>Full Name</label>
                    <input type="text" name="guestName" value={bookingDetails.guestName} onChange={handleInputChange} placeholder="John Doe" style={{ ...inputStyle, width: "100%" }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Email</label>
                    <input type="email" name="guestEmail" value={bookingDetails.guestEmail} onChange={handleInputChange} placeholder="you@example.com" style={{ ...inputStyle, width: "100%" }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Phone Number</label>
                    <input type="tel" name="guestPhone" value={bookingDetails.guestPhone} onChange={handleInputChange} placeholder="+91 9876543210" style={{ ...inputStyle, width: "100%" }} />
                  </div>
                  <div>
                    <label style={labelStyle}>Upload ID / License (optional)</label>
                    <input
                      type="file"
                      accept=".jpg,.jpeg,.png,.pdf"
                      onChange={(e) => setLicenseFile(e.target.files?.[0] || null)}
                      style={{ ...inputStyle, width: "100%" }}
                    />
                    <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "#6b7280" }}>Accepted: JPG, PNG, PDF</p>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px", marginBottom: "24px" }}>
                    <div>
                      <label style={labelStyle}>Rooms</label>
                      <select name="numRooms" value={bookingDetails.numRooms} onChange={handleInputChange} style={{ ...inputStyle, width: "100%" }}>
                        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Adults</label>
                      <select name="adults" value={bookingDetails.adults} onChange={handleInputChange} style={{ ...inputStyle, width: "100%" }}>
                        {[1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div>
                      <label style={labelStyle}>Children</label>
                      <select name="children" value={bookingDetails.children} onChange={handleInputChange} style={{ ...inputStyle, width: "100%" }}>
                        {[0, 1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                    <input
                      type="checkbox"
                      name="payOnArrival"
                      checked={bookingDetails.payOnArrival}
                      onChange={handleInputChange}
                      style={{ width: "18px", height: "18px" }}
                    />
                    <label style={{ color: colors.text, fontWeight: 600 }}>Pay on arrival</label>
                  </div>

                  <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
                    <button onClick={() => setSelectedRoomId(null)} style={secondaryButtonStyle}>Cancel</button>
                    <button onClick={handleProceedToPayment} style={{ ...primaryButtonStyle, padding: "12px 32px" }}>Confirm Booking</button>
                  </div>
                </div>
              )}            </div>
          ))}
        </div>
      </main>

      {/* lightbox overlay */}
      {lightbox.roomId !== null && (() => {
        const room = rooms.find(r => r.room_id === lightbox.roomId);
        if (!room) return null;
        const pics = room.pictures || [];
        const pic = pics[lightbox.index];
        return (
          <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(0,0,0,0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000
          }} onClick={() => setLightbox({ roomId: null, index: 0 })}>
            <button onClick={e => { e.stopPropagation(); setLightbox(prev => ({ roomId: prev.roomId, index: (prev.index - 1 + pics.length) % pics.length })) }} style={{ position: "absolute", left: 20, fontSize: 30, color: "white", background: "none", border: "none", cursor: "pointer" }}>&larr;</button>
            <img src={pic.picture_url} alt="Large" style={{ maxWidth: "90%", maxHeight: "90%", borderRadius: "6px" }} onClick={e => e.stopPropagation()} />
            <button onClick={e => { e.stopPropagation(); setLightbox(prev => ({ roomId: prev.roomId, index: (prev.index + 1) % pics.length })) }} style={{ position: "absolute", right: 20, fontSize: 30, color: "white", background: "none", border: "none", cursor: "pointer" }}>&rarr;</button>
          </div>
        );
      })()}

      {/* FLOATING AI CHATBOT WIDGET */}
      <div style={{ position: "fixed", bottom: "20px", right: "20px", zIndex: 1000 }} >
        {isChatOpen ? (
          <div style={{ width: "350px", height: "500px", backgroundColor: "white", borderRadius: "12px", boxShadow: "0 10px 25px rgba(0,0,0,0.2)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            <div style={{ backgroundColor: "#1f2937", color: "white", padding: "16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: "bold" }}>AI Receptionist</span>
              <button onClick={() => setIsChatOpen(false)} style={{ background: "none", border: "none", color: "white", cursor: "pointer", fontSize: "20px" }}>×</button>
            </div>

            <div style={{ flex: 1, padding: "16px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", backgroundColor: "#f3f4f6" }}>
              {chatHistory.map((msg, i) => {
                const isActiveSpeech = speakingMsgIndex === i && msg.sender === "ai";
                const words = msg.text.split(/\s+/);
                return (
                  <div key={i} style={{ alignSelf: msg.sender === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                    <div
                      style={{
                        backgroundColor: msg.sender === "user" ? "#2563eb" : "#e5e7eb",
                        color: msg.sender === "user" ? "white" : "black",
                        padding: "10px 14px",
                        borderRadius: "8px",
                        lineHeight: "1.6"
                      }}
                    >
                      {msg.sender === "ai"
                        ? words.map((word, wi) => (
                          <span
                            key={wi}
                            style={{
                              backgroundColor: isActiveSpeech && wi === spokenWordIndex
                                ? "#facc15"
                                : "transparent",
                              color: isActiveSpeech && wi === spokenWordIndex
                                ? "#1a1a1a"
                                : "inherit",
                              borderRadius: "3px",
                              padding: "0 1px",
                              transition: "background-color 0.15s"
                            }}
                          >
                            {word}{" "}
                          </span>
                        ))
                        : msg.text
                      }
                    </div>
                    {msg.sender === "ai" && (
                      <button
                        onClick={() => isActiveSpeech ? stopSpeaking() : speakText(msg.text, i)}
                        title={isActiveSpeech ? "Stop" : "Listen"}
                        style={{
                          marginTop: "4px",
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "16px",
                          opacity: 0.65
                        }}
                      >
                        {isActiveSpeech ? "⏹️" : "🔊"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ padding: "12px", borderTop: "1px solid #e5e7eb", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", background: "#f8fafc" }}>
              {/* Mic toggle */}
              <button
                onClick={() => (isListening ? stopListening() : startListening())}
                title={isListening ? "Stop listening" : "Start voice input"}
                style={{
                  padding: "10px 12px",
                  backgroundColor: isListening ? "#ef4444" : "#0f172a",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontSize: "18px",
                  transition: "background-color 0.2s, transform 0.1s",
                  animation: isListening ? "pulse 1s infinite" : "none"
                }}
              >
                {isListening ? "■" : "🎤"}
              </button>

              {/* TTS toggle */}
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#475569", cursor: "pointer", whiteSpace: "nowrap" }}>
                <input
                  type="checkbox"
                  checked={ttsEnabled}
                  onChange={(e) => setTtsEnabled(e.target.checked)}
                  style={{ cursor: "pointer" }}
                />
                🔊 Read replies
              </label>

              {/* Text input */}
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={isListening ? "Listening..." : "Ask about rooms or book..."}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "10px",
                  border: isListening ? "2px solid #ef4444" : "1px solid #cbd5e1",
                  background: "white",
                  color: "#0b1220",
                  boxShadow: "0 6px 16px rgba(15,23,42,0.08)",
                  transition: "border-color 0.2s, box-shadow 0.2s"
                }}
              />

              {/* Send */}
              <button
                onClick={handleSendMessage}
                style={{
                  padding: "12px 16px",
                  backgroundColor: "#2563eb",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  fontWeight: 600,
                  boxShadow: "0 10px 20px rgba(37,99,235,0.25)"
                }}
              >
                Send
              </button>
            </div>
            <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.5} }`}</style>
          </div>
        ) : (
          <button
            onClick={() => setIsChatOpen(true)}
            style={{ width: "60px", height: "60px", borderRadius: "30px", backgroundColor: "#2563eb", color: "white", border: "none", boxShadow: "0 4px 12px rgba(37,99,235,0.4)", cursor: "pointer", fontSize: "24px", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            💬
          </button>
        )}
      </div>
      {/* SIMULATED PAYMENT MODAL */}
      {showPayment && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0,0,0,0.6)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 9999 }}>
          <div style={{ backgroundColor: "white", padding: "30px", borderRadius: "12px", width: "400px", boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0 }}>Secure Checkout</h3>
              {!isProcessing && <button onClick={() => setShowPayment(false)} style={{ border: "none", background: "none", cursor: "pointer", fontSize: "18px" }}>❌</button>}
            </div>

            <div style={{ backgroundColor: "#f3f4f6", padding: "15px", borderRadius: "8px", marginBottom: "20px", textAlign: "center" }}>
              <p style={{ margin: 0, color: "#6b7280", fontSize: "14px" }}>Total Amount Due</p>
              {/* In a real app, you would calculate Price * Nights * Rooms here */}
              <h2 style={{ margin: "5px 0 0 0", color: "#111827" }}>Proceed to Pay</h2>
            </div>

            <label style={labelStyle}>Card Number (Simulated)</label>
            <input type="text" placeholder="XXXX XXXX XXXX XXXX" defaultValue="4242 4242 4242 4242" disabled={isProcessing} style={{ ...inputStyle, width: "100%", marginBottom: "15px", fontFamily: "monospace" }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "15px", marginBottom: "24px" }}>
              <div>
                <label style={labelStyle}>Expiry</label>
                <input type="text" placeholder="MM/YY" defaultValue="12/26" disabled={isProcessing} style={{ ...inputStyle, width: "100%" }} />
              </div>
              <div>
                <label style={labelStyle}>CVV</label>
                <input type="password" placeholder="123" defaultValue="123" disabled={isProcessing} style={{ ...inputStyle, width: "100%" }} />
              </div>
            </div>

            <button
              onClick={handleSimulatePayment}
              disabled={isProcessing}
              style={{ ...primaryButtonStyle, width: "100%", padding: "14px", backgroundColor: isProcessing ? "#9ca3af" : "#10b981", fontSize: "16px" }}
            >
              {isProcessing ? "🔄 Processing Payment..." : "🔒 Pay Securely"}
            </button>
            <p style={{ textAlign: "center", fontSize: "12px", color: "#9ca3af", marginTop: "15px" }}>
              Test Mode • No real money will be charged
            </p>
          </div>
        </div>
      )}
      {/* LOOKUP BOOKING MODAL */}
      {showLookup && (
        <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", backgroundColor: "rgba(0,0,0,0.6)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 }}>
          <div style={{
            backgroundColor: "rgba(255,255,255,0.82)",
            padding: "30px",
            borderRadius: "16px",
            width: "420px",
            maxWidth: "90%",
            color: "#0b1220",
            fontFamily: "'Poppins','Inter','Segoe UI',sans-serif",
            fontSize: "15px",
            lineHeight: "1.6",
            boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.35)",
            backdropFilter: "blur(18px)",
            WebkitBackdropFilter: "blur(18px)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ margin: 0, color: "#0b1220", letterSpacing: "0.4px", fontWeight: 700 }}>Find Your Booking</h3>
              <button type="button" onClick={() => { setShowLookup(false); setFoundBooking(null); }} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px" }}>❌</button>
            </div>

            {!foundBooking ? (
              <div>
                <label style={labelStyle}>Booking Reference (e.g., BK-123456)</label>
                <input type="text" value={lookupRef} onChange={e => setLookupRef(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: "15px" }} />

                <label style={labelStyle}>Phone Number</label>
                <input type="text" value={lookupPhone} onChange={e => setLookupPhone(e.target.value)} style={{ ...inputStyle, width: "100%", marginBottom: "20px" }} />

                <button type="button" onClick={handleLookupBooking} style={{ ...primaryButtonStyle, width: "100%" }}>Search</button>
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "16px",
                alignItems: "start"
              }}>
                <div style={{
                  backgroundColor: "rgba(255,255,255,0.7)",
                  padding: "20px",
                  borderRadius: "12px",
                  color: "#0b1220",
                  fontSize: "15px",
                  lineHeight: "1.7",
                  border: "1px solid rgba(15,18,32,0.08)",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.1)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)"
                }}>
                  <h4 style={{ margin: "0 0 15px 0", color: "#0a0f1f", fontSize: "17px", letterSpacing: "0.25px" }}>Booking Receipt</h4>
                  <p style={{ margin: "6px 0", color: "#1f2937" }}><strong style={{ color: "#0b1220" }}>Status:</strong> <span style={{ color: foundBooking.booking_status === 'confirmed' ? '#0ea5e9' : '#e11d48', fontWeight: 700 }}>{foundBooking.booking_status.toUpperCase()}</span></p>
                  <p style={{ margin: "6px 0", color: "#1f2937" }}><strong style={{ color: "#0b1220" }}>Payment:</strong> <span style={{ color: (foundBooking.payment_status || '').toLowerCase() === 'paid' ? '#16a34a' : '#f59e0b', fontWeight: 700 }}>{(foundBooking.payment_status || 'pending').toUpperCase()}</span></p>
                  <p style={{ margin: "6px 0", color: "#1f2937" }}><strong style={{ color: "#0b1220" }}>Guest:</strong> {foundBooking.guest_name}</p>
                  <p style={{ margin: "6px 0", color: "#1f2937" }}><strong style={{ color: "#0b1220" }}>Room:</strong> {foundBooking.room_type} ({foundBooking.number_of_rooms} room/s)</p>
                  <p style={{ margin: "6px 0", color: "#1f2937" }}><strong style={{ color: "#0b1220" }}>Check-in:</strong> {new Date(foundBooking.check_in_date).toLocaleDateString()}</p>
                  <p style={{ margin: "6px 0 12px 0", color: "#1f2937" }}><strong style={{ color: "#0b1220" }}>Check-out:</strong> {new Date(foundBooking.check_out_date).toLocaleDateString()}</p>
                  {foundBooking.booking_status === 'confirmed' && (
                    <button type="button"
                      onClick={handleCancelBooking}
                      style={{ ...secondaryButtonStyle, width: "100%", marginTop: "15px", color: "#dc2626", borderColor: "#fca5a5", backgroundColor: "#fef2f2" }}
                    >
                      ⚠️ Cancel Booking
                    </button>
                  )}

                  <button type="button" onClick={() => setFoundBooking(null)} style={{ ...secondaryButtonStyle, width: "100%", marginTop: "10px" }}>Close Receipt</button>
                  <button type="button" onClick={() => { setFoundBooking(null); setRatingHotelId(null); }} style={{ ...secondaryButtonStyle, width: "100%", marginTop: "15px" }}>Back to Search</button>
                </div>

                <div style={{
                  backgroundColor: "rgba(255,255,255,0.7)",
                  padding: "20px",
                  borderRadius: "12px",
                  color: "#0b1220",
                  fontSize: "15px",
                  lineHeight: "1.6",
                  border: "1px solid rgba(15,18,32,0.08)",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.1)",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)"
                }}>
                  <h4 style={{ margin: "0 0 10px 0", color: "#0a0f1f", fontSize: "16px" }}>Rate Your Stay</h4>
                  <RatingStars
                    value={bookingRating.rating}
                    onChange={(v) => setBookingRating((f) => ({ ...f, rating: v }))}
                  />
                  <div style={{ height: "10px" }} />
                  <label style={labelStyle}>Name (optional)</label>
                  <input
                    value={bookingRating.guest_name}
                    onChange={(e) => setBookingRating((f) => ({ ...f, guest_name: e.target.value }))}
                    style={{ ...inputStyle, width: "100%", marginBottom: "10px" }}
                    placeholder="Anonymous"
                  />
                  <label style={labelStyle}>Comment (optional)</label>
                  <textarea
                    value={bookingRating.comment}
                    onChange={(e) => setBookingRating((f) => ({ ...f, comment: e.target.value }))}
                    style={{ ...inputStyle, width: "100%", minHeight: "70px" }}
                    placeholder="Share your experience"
                  />
                  <button type="button" onClick={submitBookingRating} style={{ ...primaryButtonStyle, width: "100%", marginTop: "10px" }}>
                    Submit Rating
                  </button>
                  {foundBooking.booking_status && foundBooking.booking_status.toLowerCase() !== 'confirmed' && (
                    <p style={{ color: "#9ca3af", fontSize: "12px", marginTop: "8px" }}>
                      Note: Rating is saved even if booking is not confirmed.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- REUSABLE STYLES ---
const labelStyle = {
  display: "block",
  fontSize: "14px",
  fontWeight: "bold",
  marginBottom: "8px",
  color: "#0b1220"
};

const inputStyle = {
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid #d1d5db",
  boxSizing: "border-box",
  backgroundColor: "#ffffff",
  color: "#0b1220"
};

const primaryButtonStyle = {
  padding: "10px 20px",
  backgroundColor: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: "6px",
  fontSize: "16px",
  fontWeight: "bold",
  cursor: "pointer"
};

const secondaryButtonStyle = {
  padding: "10px 20px",
  backgroundColor: "white",
  color: "#4b5563",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  fontSize: "16px",
  fontWeight: "bold",
  cursor: "pointer"
};

export default HotelPage;
