import dotenv from "dotenv";
dotenv.config();

// HuggingFace Inference API Configuration (optional LLM fallback)
const HF_API_TOKEN = process.env.HUGGINGFACE_API_TOKEN;
const HF_MODEL = process.env.HF_MODEL || "meta-llama/Llama-2-7b-chat-hf";
// HF recommends using the router endpoint (api-inference is deprecated)
const HF_FALLBACK_MODEL = process.env.HF_FALLBACK_MODEL || "bigscience/bloomz-560m"; // open by default
const HF_EMERGENCY_OPEN_MODEL = "gpt2"; // last-resort open model

// Soft circuit-breaker so we don't spam logs if HF keeps failing
let hfDisabledUntil = 0;
const HF_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes

// --- CACHE UTILITIES ---
const cache = new Map();

function setCache(key, value, ttlMs = 1000 * 60 * 5) {
  const expires = Date.now() + ttlMs;
  cache.set(key, { value, expires });
}

function getCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function buildFallbackReply(hotelContext) {
  if (!hotelContext) return "I can help with rooms, prices, and availability. Ask away!";
  const roomLines = (hotelContext.rooms || [])
    .map(r => `${r.type}: ₹${r.price}/night (${r.available} available)`)
    .join(" • ");
  return `I'm here to help with ${hotelContext.hotel_name || "this hotel"}. ${roomLines ? "Options: " + roomLines + "." : ""} Ask anything or tell me which room you want to book.`;
}

// Simple Levenshtein distance for fuzzy room matching
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function findClosestRoom(query, rooms = []) {
  const q = query.toLowerCase().trim();
  let best = null;
  let bestScore = 0;
  for (const room of rooms) {
    const name = (room.type || "").toLowerCase();
    if (!name) continue;
    if (q.includes(name) || name.includes(q)) {
      return room;
    }
    const dist = levenshtein(q, name);
    const maxLen = Math.max(q.length, name.length) || 1;
    const score = 1 - dist / maxLen; // 1 = exact match
    if (score > bestScore) {
      bestScore = score;
      best = room;
    }
  }
  return bestScore >= 0.5 ? best : null; // allow minor typos like "seluxe" -> "deluxe"
}

async function fetchWithTimeout(url, options, timeoutMs = 6000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function callLLM(query, hotelContext, attempt = 1, modelOverride = null) {
  if (!HF_API_TOKEN) return null;
  if (Date.now() < hfDisabledUntil) return null;

  const modelToUse = modelOverride || HF_MODEL;

  const hotelInfo = hotelContext
    ? `Hotel: ${hotelContext.hotel_name || "Unknown"} (${hotelContext.location || "Unknown"})`
    : "Hotel: (not provided)";

  const roomInfo = (hotelContext?.rooms || [])
    .map(r => `${r.type}: ₹${r.price}/night (${r.available} available)`)
    .join(", ");

  const datesInfo = hotelContext?.target_check_in
    ? `Dates: ${hotelContext.target_check_in || "N/A"} to ${hotelContext.target_check_out || "N/A"}`
    : "Dates: not selected";

  const systemContext = `You are a concise, friendly hotel assistant. Use only the facts provided.\n${hotelInfo}\n${datesInfo}\nRooms: ${roomInfo || "No room data"}\nKeep answers short (1-3 sentences) and helpful.`;

  const prompt = `${systemContext}\n\nGuest: ${query}\nAssistant:`;

  const body = {
    inputs: prompt,
    parameters: {
      max_new_tokens: 180,
      temperature: 0.5,
      top_p: 0.95,
      return_full_text: false
    },
    options: {
      wait_for_model: false,
      use_cache: true
    }
  };

  try {
    const apiUrl = `https://router.huggingface.co/models/${modelToUse}`;

    const resp = await fetchWithTimeout(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }, 6000);

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`HuggingFace API error ${resp.status}: ${text}`);

      // If model not found or gated, try the fallback(s)
      if ((resp.status === 404 || resp.status === 403) && attempt === 1 && HF_FALLBACK_MODEL) {
        console.warn(`Retrying with fallback model: ${HF_FALLBACK_MODEL}`);
        return await callLLM(query, hotelContext, attempt + 1, HF_FALLBACK_MODEL);
      }
      if ((resp.status === 404 || resp.status === 403) && attempt === 2) {
        console.warn(`Retrying with open model: ${HF_EMERGENCY_OPEN_MODEL}`);
        return await callLLM(query, hotelContext, attempt + 1, HF_EMERGENCY_OPEN_MODEL);
      }

      // After retries, disable HF for a while to prevent log spam
      if (attempt >= 2) {
        hfDisabledUntil = Date.now() + HF_COOLDOWN_MS;
        console.warn(`Disabling HuggingFace calls for 30 minutes due to repeated ${resp.status}`);
      }
      return null;
    }

    const data = await resp.json();
    let reply = "";
    if (Array.isArray(data)) {
      reply = data[0]?.generated_text || "";
    } else if (data?.generated_text) {
      reply = data.generated_text;
    } else if (data?.choices?.length) {
      reply = data.choices[0].message?.content || data.choices[0].text || "";
    }
    if (!reply) return null;

    return { intent: "general_llm", response: reply };
  } catch (err) {
    console.error("HuggingFace fetch failed:", err.message);
    return null;
  }
}

// // --- RULE-BASED RESPONSES (no API needed) ---
// // function getRuleBasedResponse(query, hotelContext) {
// //   const normalized = query.trim().toLowerCase();

// //   // ✅ BOOKING WITH DETAILS (highest priority)
// //   // Pattern: "DELUXE 17-02-2026 2 NIGHTS" or "book deluxe room for 17-02-2026 2 nights"
// //   if (hotelContext && hotelContext.rooms) {
// //     // Try to extract booking details
// //     const datePattern = /(\d{1,2}[-\/]\d{1,2}[-\/]\d{4})/;
// //     const nightsPattern = /(\d+)\s*nights?/i;
// //     const dateMatch = query.match(datePattern);
// //     const nightsMatch = query.match(nightsPattern);

// //     // Find room type mentioned
// //     let roomType = null;
// //     for (const room of hotelContext.rooms) {
// //       if (normalized.includes(room.type.toLowerCase())) {
// //         roomType = room.type;
// //         break;
// //       }
// //     }

// //     // If we found room type AND (date OR nights), it's a booking request
// //     if (roomType && (dateMatch || nightsMatch)) {
// //       const checkInDate = dateMatch ? dateMatch[1] : "TBD";
// //       const nights = nightsMatch ? nightsMatch[1] : "TBD";
// //       return {
// //         intent: "booking_details_received",
// //         response: `Great! I have these booking details:\n• Room Type: ${roomType}\n• Check-in: ${checkInDate}\n• Nights: ${nights}\n\nPlease confirm your full name and phone number to complete the booking.`,
// //         bookingDetails: {
// //           room_type: roomType,
// //           check_in_date: checkInDate,
// //           nights: nights
// //         }
// //       };
// //     }

// //     // ✅ NAME AND PHONE CONFIRMATION (high priority)
// //     // Pattern: "NAME PHONENUMBER" like "RAMAN 9876543210" or "John Doe, 9876543210"
// //     const phonePattern = /(\d{10}|\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/;
// //     const phoneMatch = query.match(phonePattern);
// //     if (phoneMatch) {
// //       // Extract name (everything before phone or comma)
// //       const nameMatch = query.match(/^([a-zA-Z\s]+)/);
// //       const guestName = nameMatch ? nameMatch[1].trim() : null;
      
// //       if (guestName && guestName.length > 2) {
// //         return {
// //           intent: "booking_confirmation_ready",
// //           response: `Perfect! I have your contact details:\n• Name: ${guestName}\n• Phone: ${phoneMatch[0]}\n\nYour booking will be confirmed shortly. Thank you!`,
// //           guestDetails: {
// //             name: guestName,
// //             phone: phoneMatch[0]
// //           }
// //         };
// //       }
// //     }

// //     // Price queries with specific room type
// //     const priceKeywords = ["price", "cost", "rate", "how much", "charge"];
// //     for (const room of hotelContext.rooms) {
// //       const roomName = (room.type || "").toLowerCase();
// //       if (roomName && normalized.includes(roomName) && priceKeywords.some(k => normalized.includes(k))) {
// //         return {
// //           intent: "pricing",
// //           response: `The ${room.type} room costs ₹${room.price} per night. We have ${room.available} rooms available. Would you like to book?`
// //         };
// //       }
// //     }

// //     // General availability check
// //     if (normalized.includes("available") || (normalized.includes("room") && normalized.includes("have"))) {
// //       const availableCount = hotelContext.rooms.reduce((sum, r) => sum + r.available, 0);
// //       return {
// //         intent: "availability",
// //         response: `We have ${availableCount} rooms available across our ${hotelContext.rooms.length} room types. Our rates range from ₹${Math.min(...hotelContext.rooms.map(r => r.price))} to ₹${Math.max(...hotelContext.rooms.map(r => r.price))} per night.`
// //       };
// //     }
// //   }

// //   // Booking intent (generic, no details yet)
// //   if (normalized.includes("book") || normalized.includes("reserve")) {
// //     return {
// //       intent: "booking",
// //       response: "I'd be happy to help you book a room! Please tell me: 1) Your preferred room type, 2) Check-in date (DD-MM-YYYY), and 3) How many nights."
// //     };
// //   }

// //   // Welcome
// //   if (normalized.includes("hello") || normalized.includes("hi") || normalized.includes("help")) {
// //     return {
// //       intent: "greeting",
// //       response: "Hello! I'm your hotel assistant. I can help you with room availability, pricing, bookings, and other inquiries. How can I assist you?"
// //     };
// //   }

// //   return null; // No rule matched
// // }

// function getRuleBasedResponse(query, hotelContext) {
//   const normalized = query.trim().toLowerCase();

//   if (!hotelContext || !hotelContext.rooms) return null;

//   const datesInfo = `(Selected Dates: ${hotelContext.target_check_in} to ${hotelContext.target_check_out})`;

//   // ✅ NAME AND PHONE CONFIRMATION (Completes the booking)
//   const phonePattern = /(\d{10}|\d{3}[-.\s]?\d{3}[-.\s]?\d{4})/;
//   const phoneMatch = query.match(phonePattern);
//   if (phoneMatch) {
//     const nameMatch = query.match(/^([a-zA-Z\s]+)/);
//     const guestName = nameMatch ? nameMatch[1].trim() : null;
    
//     if (guestName && guestName.length > 2) {
//       return {
//         intent: "booking_confirmation_ready",
//         response: `Perfect! Processing your reservation now...`,
//         guestDetails: { name: guestName, phone: phoneMatch[0] }
//       };
//     }
//   }

//   // ✅ ROOM SELECTION (Starts the booking)
//   let selectedRoom = null;
//   for (const room of hotelContext.rooms) {
//     if (normalized.includes(room.type.toLowerCase())) {
//       selectedRoom = room;
//       break;
//     }
//   }

//   // If they mention a room AND "book", ask for details
//   if (selectedRoom && (normalized.includes("book") || normalized.includes("reserve"))) {
//     if (selectedRoom.available <= 0) {
//       return {
//         intent: "booking_failed",
//         response: `I'm so sorry, but the ${selectedRoom.type} is fully booked for your selected dates ${datesInfo}. Please select a different date or room type.`
//       };
//     }

//     return {
//       intent: "booking_details_received",
//       response: `Excellent choice! You've selected the ${selectedRoom.type} room ${datesInfo}. The dynamically adjusted price for these dates is ₹${selectedRoom.price} per night.\n\nPlease reply with your FULL NAME and PHONE NUMBER to secure this booking.`,
//       bookingDetails: {
//         room_type: selectedRoom.type,
//         check_in_date: hotelContext.target_check_in,
//         nights: "Selected via calendar"
//       }
//     };
//   }

//   // ✅ PRICING QUERIES
//   const priceKeywords = ["price", "cost", "rate", "how much", "charge"];
//   if (selectedRoom && priceKeywords.some(k => normalized.includes(k))) {
//     return {
//       intent: "pricing",
//       response: `Based on your selected dates ${datesInfo}, the ${selectedRoom.type} room is currently ₹${selectedRoom.price} per night. We have ${selectedRoom.available} available. Would you like to book it?`
//     };
//   }

//   // ✅ GENERAL AVAILABILITY
//   if (normalized.includes("available") || (normalized.includes("room") && normalized.includes("have"))) {
//     const availableRoomsText = hotelContext.rooms
//       .map(r => `• ${r.type}: ${r.available > 0 ? `₹${r.price}/night` : 'Sold Out'}`)
//       .join("\n");

//     return {
//       intent: "availability",
//       response: `Here is our live availability for your selected dates ${datesInfo}:\n${availableRoomsText}\n\nWhich room would you like to book?`
//     };
//   }

//   return null;
// }
// // --- MAIN FUNCTION ---
// export async function processGuestQuery(query, hotelContext = null, db = null, history = []) {
//   const normalized = query.trim().toLowerCase();

//   // 1. Try rule-based responses first (fast, no API call)
//   const ruleResponse = getRuleBasedResponse(query, hotelContext);
//   if (ruleResponse) {
//     setCache(`guestq:${normalized}:${hotelContext?.hotel_id || 'default'}`, ruleResponse);
//     return ruleResponse;
//   }

//   // 2. Simple yes/no responses (for booking confirmations)
//   if (normalized.includes("yes") || normalized.includes("confirm") || normalized.includes("proceed")) {
//     return {
//       intent: "confirmation",
//       response: "Perfect! Please provide your full name and phone number to complete the booking."
//     };
//   }

//   if (normalized.includes("no") || normalized.includes("cancel") || normalized.includes("decline")) {
//     return {
//       intent: "cancellation",
//       response: "No problem! Is there anything else I can help you with?"
//     };
//   }

//   // 3. CHECK CACHE
//   const cacheKey = `guestq:${normalized}:${hotelContext?.hotel_id || 'default'}`;
//   const cached = getCache(cacheKey);
//   if (cached) return cached;

//   // 4. For complex queries, use HuggingFace (optional, fallback to generic response if fails)
//   // Most hotel queries are handled by rule-based logic above, so we rarely reach here
//   try {
//     // Build context for the AI
//     const hotelInfo = hotelContext ? `Hotel: ${hotelContext.hotel_name} (${hotelContext.location})` : "";
//     const roomInfo = hotelContext?.rooms
//       ? hotelContext.rooms.map(r => `${r.type}: ₹${r.price}/night (${r.available} available)`).join(", ")
//       : "";

//     const systemContext = `You are a friendly hotel assistant. ${hotelInfo}
// Available rooms: ${roomInfo || "No room data available"}
// Be concise and helpful.`;

//     const prompt = `${systemContext}\n\nGuest: ${query}\nAssistant:`;

//     console.log(`🤖 Calling HuggingFace (${HF_MODEL})...`);

//     const response = await fetch(HF_API_URL, {
//       headers: { Authorization: `Bearer ${HF_API_TOKEN}` },
//       method: "POST",
//       body: JSON.stringify({
//         inputs: prompt,
//         parameters: {
//           max_new_tokens: 150,
//           temperature: 0.7,
//           top_p: 0.95
//         }
//       })
//     });

//     if (!response.ok) {
//       const errorText = await response.text();
//       console.error(`HuggingFace API Error (${response.status}):`, errorText);

//       // Fallback: return generic response instead of error
//       return {
//         intent: "general",
//         response: "I'm having trouble processing complex requests right now. Please try rephrasing or ask our staff for assistance."
//       };
//     }

//     const data = await response.json();
    
//     // Parse response
//     let aiResponse = "";
//     if (Array.isArray(data)) {
//       aiResponse = data[0]?.generated_text || "";
//       const assistantPart = aiResponse.split("Assistant:")?.pop()?.trim() || aiResponse;
//       aiResponse = assistantPart;
//     } else {
//       aiResponse = data.generated_text || "I couldn't generate a response.";
//     }

//     // Simple intent detection
//     let intent = "general";
//     const responseText = aiResponse.toLowerCase();
//     if (responseText.includes("book") || responseText.includes("reserve")) intent = "booking";
//     if (responseText.includes("price") || responseText.includes("cost")) intent = "pricing";
//     if (responseText.includes("available")) intent = "availability";

//     const result = {
//       intent,
//       response: aiResponse || "I'm not sure how to respond to that. Could you clarify?"
//     };

//     setCache(cacheKey, result);
//     return result;

//   } catch (err) {
//     console.error("HuggingFace API Error:", err.message);

//     // Final fallback: friendly generic response
//     return {
//       intent: "general",
//       response: "I'm having trouble with the AI service right now. Our staff is available 24/7 to assist you. How else can I help?"
//     };
//   }
// }
// ==========================================
// FILE: services/aiService.js
// 100% Rule-Based Slot Filling State Machine
// ==========================================

// ==========================================
// FILE: services/aiService.js
// 100% Rule-Based Slot Filling State Machine
// ==========================================



export async function processGuestQuery(query, hotelContext, currentState = {}) {
  const text = query.toLowerCase().trim();
  
  // 1. Expand the Memory Bucket!
  let state = {
    room_type: null,
    room_id: null,
    num_rooms: null,   // NEW
    adults: null,      // NEW
    children: null,    // NEW
    guest_name: null,
    guest_phone: null,
    fallback_hits: 0,
    ...currentState
  };

  let intent = "conversational";
  let response = "";

  // 2. Handle Cancellations / Reset
  if (text === "cancel" || text.includes("start over") || text.includes("nevermind")) {
    return {
       intent: "cancelled",
       response: "No problem, I've cleared your booking progress. What else can I help you with?",
       chatState: {} // Wipe memory
    };
  }

  // 3. Greeting Trap (Needs the datesProvided flag!)
  const isGreeting = ["hi", "hello", "hey", "help", "start"].includes(text);
  if (isGreeting && !state.room_type) {
     if (!hotelContext.datesProvided) {
         return { 
           intent: "greeting", 
           response: `Hello! Welcome to ${hotelContext.hotel_name}. To get started, please select your Check-in and Check-out dates on the calendar above!`, 
           chatState: state 
         };
     } else {
         return { 
           intent: "greeting", 
           response: `Hello! I see you are looking for dates. Shall I list the available rooms?`, 
           chatState: state 
         };
     }
  }

  // ==========================================
  // DATA EXTRACTION
  // ==========================================

  // Extract Room (with fuzzy match for typos)
  if (!state.room_type && hotelContext.rooms) {
    const matchedRoom = findClosestRoom(text, hotelContext.rooms);
    if (matchedRoom) {
      if (matchedRoom.available > 0) {
        state.room_type = matchedRoom.type;
        state.room_id = matchedRoom.room_id;
      } else {
        return { intent: "sold_out", response: `Sorry, the ${matchedRoom.type} is fully booked.`, chatState: state };
      }
    }
  }

  // Extract Number of Rooms (e.g. "2 rooms" or just "2")
  // if (state.room_type && !state.num_rooms) {
  //   const rmMatch = text.match(/(\d+)\s*room/i);
  //   if (rmMatch) state.num_rooms = parseInt(rmMatch[1]);
  //   else if (/^\d+$/.test(text)) state.num_rooms = parseInt(text);
  // }

  // // Extract Adults and Children (e.g. "2 adults and 1 child" or just "2")
  // if (state.num_rooms && state.adults === null) {
  //   const aMatch = text.match(/(\d+)\s*adult/i);
  //   const cMatch = text.match(/(\d+)\s*(child|kid)/i);
    
  //   if (aMatch) {
  //      state.adults = parseInt(aMatch[1]);
  //      state.children = cMatch ? parseInt(cMatch[1]) : 0;
  //   } 
  //   // If they just typed "2"
  //   else if (/^\d+$/.test(text)) {
  //      state.adults = parseInt(text);
  //      state.children = 0;
  //   }
  //   // If they typed "2 and 1"
  //   else if (text.match(/^(\d+)\s*(and|,|&)\s*(\d+)$/)) {
  //      const parts = text.match(/^(\d+)\s*(and|,|&)\s*(\d+)$/);
  //      state.adults = parseInt(parts[1]);
  //      state.children = parseInt(parts[3]);
  //   }
  // }
// Extract Number of Rooms (e.g. "2 rooms" or just "2")
  if (state.room_type && !state.num_rooms) {
    const rmMatch = text.match(/(\d+)\s*room/i);
    if (rmMatch) {
      state.num_rooms = parseInt(rmMatch[1]);
    } else if (/^\d+$/.test(text)) {
      state.num_rooms = parseInt(text);
    }
  }

  // Extract Adults and Children (e.g. "2 adults and 1 child" or just "2")
  if (state.num_rooms && state.adults === null) {
    const aMatch = text.match(/(\d+)\s*adult/i);
    const cMatch = text.match(/(\d+)\s*(child|kid)/i);
    
    if (aMatch) {
       state.adults = parseInt(aMatch[1]);
       state.children = cMatch ? parseInt(cMatch[1]) : 0;
    } 
    // 🚨 THE FIX: Only accept a raw number for adults if the Room count was ALREADY filled in a previous message!
    else if (currentState.num_rooms) {
       if (/^\d+$/.test(text)) {
         state.adults = parseInt(text);
         state.children = 0;
       }
       else if (text.match(/^(\d+)\s*(and|,|&)\s*(\d+)$/)) {
         const parts = text.match(/^(\d+)\s*(and|,|&)\s*(\d+)$/);
         state.adults = parseInt(parts[1]);
         state.children = parseInt(parts[3]);
       }
    }
  }
  // Extract Phone
  if (!state.guest_phone) {
    const phoneMatch = text.match(/(\d{10})/);
    if (phoneMatch) state.guest_phone = phoneMatch[0];
  }

  // Extract Name (allow even if phone already provided)
  if (state.adults !== null && !state.guest_name) {
    const hasLetters = /[a-zA-Z]/.test(text);
    const looksNumericList = /^(\d+\s*(and|,|&)\s*)*\d+$/i.test(text);
    if (hasLetters && !looksNumericList && !text.match(/(\d+)\s*room/) && !text.match(/(\d+)\s*adult/)) {
      let nameStr = text.replace(/^(my name is|i am|this is)\s*/i, "").trim();
      if (nameStr.length > 2 && !["yes", "no", "ok"].includes(nameStr.toLowerCase())) {
        state.guest_name = nameStr;
      }
    }
  }

  // ==========================================
  // THE STATE MACHINE (Asking Questions)
  // ==========================================
  
  if (!hotelContext.datesProvided && !state.room_type) {
     response = "Please select your Check-in and Check-out dates on the calendar above first!";
  }
  else if (!state.room_type) {
     const availRooms = hotelContext.rooms.filter(r => r.available > 0).map(r => `• ${r.type}`).join("\n");
     response = availRooms ? `For your dates we have:\n${availRooms}\n\nWhich room would you like?` : "We are sold out for those dates.";
  } 
  else if (!state.num_rooms) {
    response = `Excellent, the ${state.room_type}. How many rooms do you need? (e.g., "1 room")`;
  }
  else if (state.adults === null) {
    response = `Got it, ${state.num_rooms} room(s). How many adults and children? (e.g., "2 adults and 1 child" or just "2")`;
  }
  else if (!state.guest_name) {
    response = `Great. Could you please tell me your full name?`;
  } 
  else if (!state.guest_phone) {
    response = `Thanks, ${state.guest_name}. Lastly, I need your 10-digit phone number.`;
  } 
  else {
    // THE BUCKET IS FULL!
    if (["yes", "confirm", "proceed", "ok", "checkout"].some(w => text.includes(w))) {
      intent = "TRIGGER_CHECKOUT";
      response = "Perfect! I am generating your secure payment link now...";
    } else {
      response = `Here are your details:\n👤 Name: ${state.guest_name}\n📱 Phone: ${state.guest_phone}\n🛏️ Rooms: ${state.num_rooms}x ${state.room_type}\n👨‍👩‍👧 Guests: ${state.adults} Adults, ${state.children} Children\n\nShall I open the payment screen to confirm? (Reply 'Yes')`;
    }
  }

  // Purely deterministic fallback for idle chit-chat (HF disabled)
  // Only trigger when we have collected nothing yet; otherwise continue the booking Q&A flow.
  const noProgress =
    !state.room_type &&
    state.num_rooms === null &&
    state.adults === null &&
    !state.guest_name &&
    !state.guest_phone;

  if (intent === "conversational" && noProgress) {
    const fallbackCount = (state.fallback_hits || 0) + 1;
    state.fallback_hits = fallbackCount;

    let fallbackMsg;
    if (fallbackCount === 1) {
      fallbackMsg = buildFallbackReply(hotelContext);
    } else {
      fallbackMsg = `I can do any of these for ${hotelContext?.hotel_name || "this hotel"}:
• Check availability for your dates
• Recommend the best-value room
• List amenities and nearby spots
• Start a booking if you give dates and guest count
Tell me which you want, or share your check-in/check-out dates.`;
    }

    return { intent: "general_llm_fallback", response: fallbackMsg, chatState: state };
  }

  return { intent, response, chatState: state };
}
