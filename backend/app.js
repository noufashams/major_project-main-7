import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import pg from "pg";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// 🚨 NEW WEBSOCKET IMPORTS
import { createServer } from "http";
import { Server } from "socket.io";

import { verifyToken } from "./middleware/auth.js";
import { processGuestQuery } from "./services/aiService.js";
import { 
  calculateOptimalPrice, 
  getPricingRecommendations, 
  applyRecommendedPrice 
} from "./services/pricingEngine.js";

// import { getComprehensiveAnalytics } from "./services/analyticsService.js";

const verifyAdmin = (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: "No token provided" });
  const token = header.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== "superadmin") {
      return res.status(403).json({ message: "Admins only" });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ message: "Invalid or expired token" });
  }
};


const app = express();
const port = 3000;

dotenv.config();


// 🚨 WRAP EXPRESS WITH HTTP & SOCKET.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    credentials: true
  }
});

// 🚨 WEBSOCKET LISTENER LOGIC
io.on("connection", (socket) => {
  console.log("🟢 Live Dashboard Connected:", socket.id);

  // When a hotel owner logs in, they join a private "room" just for their hotel
  socket.on("join_hotel_room", (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    console.log(`🔒 Dashboard subscribed to live updates for Hotel ID: ${hotelId}`);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Live Dashboard Disconnected");
  });
});

// Make 'io' available inside all our API routes!
app.set("io", io);
const db = new pg.Client({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT
});

db.connect()
  .then(() => console.log("✓ Database connected successfully"))
  .catch((err) => console.error("✗ Database connection failed:", err.message));

// Ensure admin verification flag exists
(async () => {
  try {
    await db.query("ALTER TABLE hotels ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false");
    await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_source VARCHAR(50) DEFAULT 'web'");
    await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS device VARCHAR(50) DEFAULT 'desktop'");
  } catch (e) {
    console.error("Failed to ensure is_verified column:", e.message);
  }
})();

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
// Make the 'uploads' folder publicly accessible
app.use('/uploads', express.static('uploads'));

app.use(bodyParser.urlencoded({ extended: true }));

// Create uploads directory if it doesn't exist
const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files (JPEG, PNG) and PDF files are allowed!'));
    }
  }
});

// Middleware: only invoke multer when multipart is sent (so JSON bookings still work)
const optionalLicenseUpload = (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return upload.single("license_file")(req, res, next);
  }
  return next();
};

app.get("/", (req, res) => {
  res.send("Welcome to the Smart Hospitality System API");
});



// Allow optional license upload with the booking
app.post("/api/bookings", optionalLicenseUpload, async (req, res) => {
  const { hotel_id, room_id, guest_name, guest_phone, guest_email, check_in, check_out, number_of_rooms = 1,adults = 2,children = 0, pay_on_arrival } = req.body;

  if (!check_in || !check_out) {
    return res.status(400).json({ message: "Check-in and check-out dates are required." });
  }

  // Validate dates to prevent bad records that break analytics
  const checkInDate = new Date(check_in);
  const checkOutDate = new Date(check_out);
  const isInvalidDate = (d) => Number.isNaN(d.getTime());

  if (isInvalidDate(checkInDate) || isInvalidDate(checkOutDate)) {
    return res.status(400).json({ message: "Invalid date format. Use ISO YYYY-MM-DD." });
  }

  if (checkOutDate <= checkInDate) {
    return res.status(400).json({ message: "Check-out must be after check-in." });
  }

  const MIN_YEAR = 2000;
  const MAX_YEAR = 2100;
  if (
    checkInDate.getFullYear() < MIN_YEAR || checkInDate.getFullYear() > MAX_YEAR ||
    checkOutDate.getFullYear() < MIN_YEAR || checkOutDate.getFullYear() > MAX_YEAR
  ) {
    return res.status(400).json({ message: "Dates must be between years 2000 and 2100." });
  }

  const checkInISO = checkInDate.toISOString().slice(0, 10);
  const checkOutISO = checkOutDate.toISOString().slice(0, 10);
  const licensePath = req.file ? req.file.path.replace(/\\/g, "/") : null;
  const bookingSource = (req.body.booking_source || "web").toLowerCase();
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  const device = (req.body.device || (ua.includes("mobile") ? "mobile" : "desktop")).toLowerCase();

  try {
    await db.query("BEGIN"); // Start transaction

    const roomCheck = await db.query(
      "SELECT total_rooms, room_type FROM rooms WHERE room_id = $1 AND hotel_id = $2 FOR UPDATE",
      [room_id, hotel_id]
    );

    if (roomCheck.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ message: "Room not found" });
    }

    const totalRooms = roomCheck.rows[0].total_rooms;

    const overlapCheck = await db.query(
      `SELECT SUM(number_of_rooms) as booked_count 
       FROM bookings 
       WHERE room_id = $1 AND booking_status = 'confirmed' AND check_in_date < $3 AND check_out_date > $2`,
      [room_id, checkInISO, checkOutISO]
    );

    const currentlyBooked = parseInt(overlapCheck.rows[0].booked_count) || 0;
    const actualAvailable = totalRooms - currentlyBooked;

    if (actualAvailable <= 0 || number_of_rooms > actualAvailable) {
      await db.query("ROLLBACK");
      return res.status(400).json({ message: "Not enough rooms available for these dates." });
    }

    // --- NEW: GENERATE THE FAKE PAYMENT ID & REAL BOOKING REF ---
    const payOnArrival = String(pay_on_arrival) === "true";
    const fakeTxnId = payOnArrival ? 'PAY_ON_ARRIVAL' : 'TXN-' + Math.random().toString(16).slice(2, 8).toUpperCase();
    const bookingRef = 'BK-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    // --- NEW: INSERT WITH THE NEW COLUMNS ---
    const bookingResult = await db.query(
      `INSERT INTO bookings
       (hotel_id, room_id, guest_name, guest_phone, guest_email, check_in_date, check_out_date, number_of_rooms, booking_status, payment_status, transaction_id, booking_ref, adults, children, license_file_path, booking_source, device)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING booking_ref`,
      [hotel_id, room_id, guest_name, guest_phone, guest_email || null, checkInISO, checkOutISO, number_of_rooms, payOnArrival ? 'pending' : 'paid', fakeTxnId, bookingRef, adults, children, licensePath, bookingSource, device]
    );

    // Attempt to send confirmation email if SMTP is configured
    let emailSent = false;
    let emailError = null;
    if (guest_email) {
      try {
        // Only try if SMTP creds are present
        const hasHost = process.env.SMTP_HOST || process.env.SMTP_URL;
        const hasUser = process.env.SMTP_USER && process.env.SMTP_PASS;
        if (!hasHost && !hasUser) {
          throw new Error("SMTP not configured. Set SMTP_HOST/SMTP_PORT and SMTP_USER/SMTP_PASS (or SMTP_URL).");
        }

        const nodemailer = (await import("nodemailer")).default;
        const transporter = process.env.SMTP_URL
          ? nodemailer.createTransport(process.env.SMTP_URL)
          : nodemailer.createTransport({
              host: process.env.SMTP_HOST,
              port: process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587,
              secure: process.env.SMTP_SECURE === "true",
              auth: hasUser
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined,
            });

        await transporter.sendMail({
          from: process.env.SMTP_FROM || "no-reply@stayatelier.local",
          to: guest_email,
          subject: `Booking Confirmed - Ref ${bookingRef}`,
          text: `Thank you for your booking!\n\nReference: ${bookingRef}\nCheck-in: ${checkInISO}\nCheck-out: ${checkOutISO}\nPayment: ${payOnArrival ? 'Pay on Arrival' : 'Paid'}\n\nWe look forward to hosting you.`,
        });
        emailSent = true;
      } catch (emailErr) {
        emailError = emailErr.message;
        console.error("Email send skipped/failed:", emailErr.message);
      }
    }

    await db.query("COMMIT");
    const io = req.app.get("io");
  
    // Calculate nights
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));

    // 🚨 UPDATED: PUSH THE DETAILED REAL-TIME ALERT!
    io.to(`hotel_${hotel_id}`).emit("new_booking_alert", {
      guest_name: guest_name,
      room_type: roomCheck.rows[0].room_type, // Get name from step 1
      nights: nights,
      ref: bookingResult.rows[0].booking_ref
    });
    // Send the reference back to React
    res.json({ 
      message: "Booking confirmed successfully!",
      booking_ref: bookingResult.rows[0].booking_ref,
      email_sent: emailSent,
      email_error: emailError
    });

  } catch (err) {
    await db.query("ROLLBACK"); 
    console.error("Booking Error:", err);
    res.status(500).json({ message: "Server error during booking" });
  }
});
app.post("/api/guest/lookup-booking", async (req, res) => {
  const { booking_ref, guest_phone } = req.body;

  if (!booking_ref || !guest_phone) {
    return res.status(400).json({ message: "Reference and Phone are required." });
  }

  try {
    const result = await db.query(
      `SELECT b.booking_ref, b.guest_name, b.check_in_date, b.check_out_date, 
              b.booking_status, b.number_of_rooms, r.room_type, r.price_per_night,
              h.hotel_name, h.hotel_id, b.payment_status
       FROM bookings b
       JOIN rooms r ON b.room_id = r.room_id
       JOIN hotels h ON b.hotel_id = h.hotel_id
       WHERE b.booking_ref = $1 AND b.guest_phone = $2`,
      [booking_ref.trim(), guest_phone.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No booking found with these details." });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error looking up booking." });
  }
});
app.post("/api/hotels/register", upload.single('license_file'), async (req, res) => {
  const {
    hotel_name,
    location,
    address,
    google_maps_url,
    contact_phone,
    contact_email,
    description,
    staff_name,
    staff_email,
    staff_password
  } = req.body;

  const licenseFile = req.file;

  if (!hotel_name || !location || !contact_phone || !contact_email ||
      !staff_name || !staff_email || !staff_password) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  const slug = `${hotel_name}-${location}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");

  try {
    // Check duplicate hotel
    const existingHotel = await db.query(
      "SELECT hotel_id FROM hotels WHERE slug = $1",
      [slug]
    );

    if (existingHotel.rows.length > 0) {
      return res.status(409).json({ message: "Hotel already registered" });
    }

    // Store password directly (for development only)
    const hashedPassword = staff_password;

    // Start transaction
    await db.query("BEGIN");

    // Insert hotel
    const hotelResult = await db.query(
      `INSERT INTO hotels
       (hotel_name, location, address, google_maps_url, contact_phone, contact_email, description, slug, license_file_path, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
       RETURNING hotel_id`,
      [
        hotel_name,
        location,
        address,
        google_maps_url,
        contact_phone,
        contact_email,
        description,
        slug,
        licenseFile ? licenseFile.path : null
      ]
    );

    const hotel_id = hotelResult.rows[0].hotel_id;

    // Insert staff user (hotel owner)
    await db.query(
      `INSERT INTO staff_users
       (hotel_id, name, email, password_hash, role)
       VALUES ($1,$2,$3,$4,'admin')`,
      [hotel_id, staff_name, staff_email, hashedPassword]
    );

    // Commit transaction
    await db.query("COMMIT");

    res.status(201).json({
      message: "Hotel and staff account created successfully",
      hotel_id,
      staff_login: "/staff-login",
      hotel_page: `/hotel/${slug}`
    });

  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});



app.get("/api/hotels/search", async (req, res) => {
  const searchQuery = (req.query.q || "").trim();
  const location = (req.query.location || "").trim();

  if (!searchQuery && !location) {
    return res.status(400).json({ message: "Provide a search term or location" });
  }

  try {
    const conditions = [];
    const params = [];

    if (searchQuery) {
      params.push(`%${searchQuery}%`);
      conditions.push(`(hotel_name ILIKE $${params.length} OR location ILIKE $${params.length})`);
    }

    if (location) {
      params.push(location);
      conditions.push(`LOWER(TRIM(location)) = LOWER(TRIM($${params.length}))`);
    }

    // Only show verified hotels to guests
    conditions.push("h.is_verified = true");
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT h.hotel_id, h.hotel_name, h.location, h.slug,
              COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 2) FROM hotel_ratings r WHERE r.hotel_id = h.hotel_id), 0) AS avg_rating,
              COALESCE((SELECT COUNT(*) FROM hotel_ratings r WHERE r.hotel_id = h.hotel_id), 0) AS rating_count,
              (
                SELECT 'http://localhost:3000/' || rp.picture_url
                FROM rooms r
                JOIN room_pictures rp ON rp.room_id = r.room_id
                WHERE r.hotel_id = h.hotel_id
                ORDER BY rp.display_order
                LIMIT 1
              ) AS preview_image
       FROM hotels h
       ${whereClause}`,
      params
    );

    res.json({ results: result.rows });
  } catch (err) {
    console.error("✗ Search error:", err.message);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});


// Provide distinct hotel locations for a dropdown
app.get("/api/hotels/locations", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT ON (LOWER(TRIM(location))) 
              TRIM(location) AS location,
              LOWER(TRIM(location)) AS normalized_location
       FROM hotels
       WHERE is_verified = true
       ORDER BY LOWER(TRIM(location)), TRIM(location)`
    );
    res.json({ locations: result.rows.map(r => r.location) });
  } catch (err) {
    console.error("✗ Locations fetch error:", err.message);
    res.status(500).json({ message: "Server error" });
  }
});



app.get("/api/hotels/:slug", async (req, res) => {
  const { slug } = req.params;
  const { date } = req.query; 
  const checkInQuery = req.query.check_in;
  const checkOutQuery = req.query.check_out;

  // Default availability window: today -> tomorrow
  const checkInISO = checkInQuery ? new Date(checkInQuery).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  const defaultCheckout = new Date(checkInISO);
  defaultCheckout.setDate(defaultCheckout.getDate() + 1);
  const checkOutISO = checkOutQuery ? new Date(checkOutQuery).toISOString().slice(0,10) : defaultCheckout.toISOString().slice(0,10);

  try {
    const hotelResult = await db.query(
      `SELECT 
         hotel_id, hotel_name, location, address, description, google_maps_url,
         contact_phone, contact_email,
         COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM hotel_ratings WHERE hotel_id = hotels.hotel_id), 0) AS avg_rating,
         COALESCE((SELECT COUNT(*) FROM hotel_ratings WHERE hotel_id = hotels.hotel_id), 0) AS rating_count
       FROM hotels WHERE slug = $1`,
      [slug]
    );

    if (hotelResult.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });

    const hotel = hotelResult.rows[0];
    let roomsResult;

    // Define the extra fields safely, including live availability
    const extraFields = `
          r.description,
          r.capacity,
          r.total_rooms,
          (r.total_rooms - COALESCE(
            (SELECT SUM(number_of_rooms) FROM bookings b 
              WHERE b.room_id = r.room_id 
                AND b.booking_status = 'confirmed' 
                AND b.check_in_date < $3 
                AND b.check_out_date > $2), 0)
          ) AS available_rooms,
          COALESCE(
            (SELECT json_agg(
               json_build_object('picture_id', picture_id, 'picture_url', 'http://localhost:3000/' || picture_url)
               ORDER BY display_order
             ) FROM room_pictures WHERE room_id = r.room_id),
            '[]'::json
          ) as pictures,
          COALESCE(
            (SELECT json_agg(amenity_name) FROM room_amenities WHERE room_id = r.room_id),
            '[]'::json
          ) as amenities
    `;

    const overrideDate = date || null;
    roomsResult = await db.query(
      `SELECT r.room_id, r.room_type, ${extraFields}, COALESCE(o.custom_price, r.price_per_night) AS price_per_night
       FROM rooms r
       LEFT JOIN room_price_overrides o ON r.room_id = o.room_id AND o.target_date = $4
       WHERE r.hotel_id = $1`,
      [hotel.hotel_id, checkInISO, checkOutISO, overrideDate]
    );

    const ratings = await db.query(
      `SELECT rating_id, guest_name, rating, comment, created_at
         FROM hotel_ratings
        WHERE hotel_id = $1
        ORDER BY created_at DESC
        LIMIT 10`,
      [hotel.hotel_id]
    );

    res.json({ hotel: hotel, rooms: roomsResult.rows, ratings: ratings.rows });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Allow guests to submit a rating for a hotel
app.post("/api/hotels/:hotel_id/ratings", async (req, res) => {
  const { hotel_id } = req.params;
  const { rating, comment, guest_name } = req.body;

  const parsedRating = parseInt(rating, 10);
  if (!hotel_id || Number.isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ message: "hotel_id and rating (1-5) are required" });
  }

  const name = guest_name && guest_name.trim() !== "" ? guest_name.trim().slice(0, 120) : "Anonymous";
  const safeComment = comment ? comment.toString().trim() : null;

  try {
    // Ensure hotel exists
    const exists = await db.query("SELECT 1 FROM hotels WHERE hotel_id = $1", [hotel_id]);
    if (exists.rows.length === 0) {
      return res.status(404).json({ message: "Hotel not found" });
    }

    await db.query(
      `INSERT INTO hotel_ratings (hotel_id, guest_name, rating, comment)
       VALUES ($1, $2, $3, $4)`,
      [hotel_id, name, parsedRating, safeComment]
    );

    const summary = await db.query(
      `SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating,
              COUNT(*) AS rating_count
         FROM hotel_ratings
        WHERE hotel_id = $1`,
      [hotel_id]
    );

    res.status(201).json({
      message: "Thanks for your feedback!",
      avg_rating: parseFloat(summary.rows[0].avg_rating) || 0,
      rating_count: parseInt(summary.rows[0].rating_count) || 0
    });
  } catch (err) {
    console.error("Rating submit error:", err);
    res.status(500).json({ message: "Server error submitting rating" });
  }
});

// Fetch ratings list and summary for a hotel
app.get("/api/hotels/:hotel_id/ratings", async (req, res) => {
  const { hotel_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  if (!hotel_id) {
    return res.status(400).json({ message: "hotel_id is required" });
  }

  try {
    const summary = await db.query(
      `SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating,
              COUNT(*) AS rating_count
         FROM hotel_ratings
        WHERE hotel_id = $1`,
      [hotel_id]
    );

    const ratings = await db.query(
      `SELECT rating_id, guest_name, rating, comment, created_at
         FROM hotel_ratings
        WHERE hotel_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [hotel_id, limit]
    );

    res.json({
      avg_rating: parseFloat(summary.rows[0].avg_rating) || 0,
      rating_count: parseInt(summary.rows[0].rating_count) || 0,
      ratings: ratings.rows
    });
  } catch (err) {
    console.error("Rating fetch error:", err);
    res.status(500).json({ message: "Server error fetching ratings" });
  }
});

app.post("/api/staff/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({
      message: "Email and password are required"
    });
  }

  try {
    const result = await db.query(
      `SELECT staff_id, hotel_id, name, password_hash, role
       FROM staff_users
       WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }

    const staff = result.rows[0];

    const isMatch = password === staff.password_hash;

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid credentials"
      });
    }


    const token = jwt.sign(
  {
    staff_id: staff.staff_id,
    hotel_id: staff.hotel_id,
    role: staff.role
  },
  process.env.JWT_SECRET,
  { expiresIn: "1d" }
);

res.json({
  message: "Login successful",
  token
});

  } catch (err) {
    console.error(err);
    res.status(500).json({
      message: "Server error"
    });
  }
});

// ADMIN AUTH (env-based)
app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required" });
  }
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPass) {
    return res.status(500).json({ message: "Admin credentials not configured" });
  }
  if (email !== adminEmail || password !== adminPass) {
    return res.status(401).json({ message: "Invalid admin credentials" });
  }
  const token = jwt.sign(
    { role: "superadmin", email },
    process.env.JWT_SECRET,
    { expiresIn: "2d" }
  );
  res.json({ token });
});

app.get("/api/rooms", verifyToken, async (req, res) => {
  const hotel_id = req.user.hotel_id;

  if (!hotel_id) return res.status(400).json({ message: "hotel_id is required" });

  try {
    const result = await db.query(
      `SELECT 
         r.room_id, r.room_type, r.price_per_night, r.total_rooms, r.description, r.capacity,
         
         -- Calculate available_rooms dynamically so it doesn't crash!
         (r.total_rooms - COALESCE((SELECT SUM(number_of_rooms) FROM bookings WHERE room_id = r.room_id AND booking_status = 'confirmed' AND CURRENT_DATE BETWEEN check_in_date AND check_out_date), 0)) AS available_rooms,
         
         COALESCE(
           (SELECT json_agg(
              json_build_object('picture_id', picture_id, 'picture_url', 'http://localhost:3000/' || picture_url)
              ORDER BY display_order
            ) FROM room_pictures WHERE room_id = r.room_id), 
           '[]'::json
         ) as pictures,
         
         COALESCE(
           (SELECT json_agg(amenity_name) FROM room_amenities WHERE room_id = r.room_id), 
           '[]'::json
         ) as amenities
       FROM rooms r
       WHERE r.hotel_id = $1
       ORDER BY r.room_id ASC`,
      [hotel_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ... other imports and configs ...

// ==========================================
//  CREATE A NEW ROOM WITH PICTURES & AMENITIES
// ==========================================
// Notice the `upload.array('room_images', 5)` middleware!
// It tells multer to look for multiple files in the 'room_images' field.
app.post("/api/rooms", verifyToken, upload.array('room_images', 5), async (req, res) => {
  const hotel_id = req.user.hotel_id;
  // When using FormData, non-file fields are in req.body
  const { room_type, price_per_night, total_rooms, description, capacity, amenities } = req.body;

  if (!hotel_id || !room_type || !price_per_night || !total_rooms) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  try {
    await db.query("BEGIN"); // Start a transaction

    // 1. Insert into the main `rooms` table
    const roomResult = await db.query(
      `INSERT INTO rooms (hotel_id, room_type, price_per_night, total_rooms, available_rooms, description, capacity)
       VALUES ($1, $2, $3, $4, $4, $5, $6)
       RETURNING room_id`,
      [hotel_id, room_type, price_per_night, total_rooms, description, capacity || 2]
    );
    
    const newRoomId = roomResult.rows[0].room_id;

    // 2. Insert Images into `room_pictures` table
    // req.files contains the array of uploaded files
    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        // Get the path where the file was saved on the server
        // Use forward slashes for URL compatibility
        const filePath = req.files[i].path.replace(/\\/g, '/');
        
        await db.query(
          `INSERT INTO room_pictures (room_id, picture_url, display_order)
           VALUES ($1, $2, $3)`,
          [newRoomId, filePath, i + 1] // i+1 sets the order (1, 2, 3...)
        );
      }
    }

    // 3. Insert Amenities into `room_amenities` table
    // Amenities come as an array of strings from FormData
    if (amenities && Array.isArray(amenities)) {
      for (const amenity of amenities) {
        await db.query(
          `INSERT INTO room_amenities (room_id, amenity_name)
           VALUES ($1, $2)`,
          [newRoomId, amenity]
        );
      }
    } else if (amenities && typeof amenities === 'string') {
       // Handle single amenity case just to be safe
       await db.query(
          `INSERT INTO room_amenities (room_id, amenity_name)
           VALUES ($1, $2)`,
          [newRoomId, amenities]
        );
    }


    await db.query("COMMIT"); // Commit the transaction

    res.status(201).json({ message: "Room added successfully with pictures and amenities!", room_id: newRoomId });

  } catch (err) {
    await db.query("ROLLBACK"); // Rollback on error
    // Important: If the DB insert fails, you might want to delete the uploaded files to save space.
    // For simplicity, we'll skip that for now, but it's a good production practice.
    console.error("ROOM INSERT ERROR:", err);
    res.status(500).json({ error: "Failed to save room details" });
  }
});

// ... rest of your server.js code ...

app.post("/api/rooms/:room_id/pictures", verifyToken, upload.single('picture'), async (req, res) => {
  const { room_id } = req.params;
  const caption = req.body.caption || "Room picture";

  if (!req.file) return res.status(400).json({ message: "No image uploaded" });

  try {
    const cleanPath = req.file.path.replace(/\\/g, '/');
    
    // Get current max display_order
    const orderResult = await db.query(
      "SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM room_pictures WHERE room_id = $1",
      [room_id]
    );
    const nextOrder = orderResult.rows[0].next_order;

    await db.query(
      `INSERT INTO room_pictures (room_id, picture_url, caption, display_order)
       VALUES ($1, $2, $3, $4)`,
      [room_id, cleanPath, caption, nextOrder]
    );

    res.status(201).json({ message: "Picture added successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to upload picture" });
  }
});

// 2. DELETE A ROOM
app.delete("/api/rooms/:room_id", verifyToken, async (req, res) => {
  const { room_id } = req.params;
  try {
    await db.query("BEGIN");
    // Delete dependencies first (Foreign Keys)
    await db.query("DELETE FROM room_pictures WHERE room_id = $1", [room_id]);
    await db.query("DELETE FROM room_amenities WHERE room_id = $1", [room_id]);
    // Delete the room
    await db.query("DELETE FROM rooms WHERE room_id = $1", [room_id]);
    await db.query("COMMIT");
    
    res.json({ message: "Room deleted successfully" });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to delete room" });
  }
});

// 3. UPDATE / EDIT A ROOM
app.put("/api/rooms/:room_id", verifyToken, async (req, res) => {
  const { room_id } = req.params;
  const { room_type, description, capacity, price_per_night, total_rooms, amenities } = req.body;

  try {
    await db.query("BEGIN");

    await db.query(
      `UPDATE rooms 
       SET room_type = $1, description = $2, capacity = $3, price_per_night = $4, total_rooms = $5
       WHERE room_id = $6`,
      [room_type, description, capacity, price_per_night, total_rooms, room_id]
    );

    // Update amenities (delete old ones, insert new ones)
    if (amenities && Array.isArray(amenities)) {
      await db.query("DELETE FROM room_amenities WHERE room_id = $1", [room_id]);
      for (const amenity of amenities) {
        await db.query(
          "INSERT INTO room_amenities (room_id, amenity_name) VALUES ($1, $2)",
          [room_id, amenity]
        );
      }
    }

    await db.query("COMMIT");
    res.json({ message: "Room updated successfully" });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Failed to update room" });
  }
});

app.get("/api/staff/bookings", verifyToken , async (req, res) => {
  const  hotel_id  = req.user.hotel_id;
  const { date_from, date_to } = req.query;

  if (!hotel_id) {
    return res.status(400).json({ message: "hotel_id is required" });
  }

  try {
    const normFrom = date_from ? date_from.trim() : null;
    const normTo = date_to ? date_to.trim() : null;
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (normFrom && !dateRegex.test(normFrom)) return res.status(400).json({ message: "Invalid date_from" });
    if (normTo && !dateRegex.test(normTo)) return res.status(400).json({ message: "Invalid date_to" });

    const conditions = ["b.hotel_id = $1"];
    const params = [hotel_id];
    // Check-in window filter (inclusive)
    if (normFrom && normTo) {
      params.push(normFrom);
      params.push(normTo);
      conditions.push(`b.check_in_date BETWEEN $${params.length-1} AND $${params.length}`);
    } else if (normFrom) {
      params.push(normFrom);
      conditions.push(`b.check_in_date >= $${params.length}`);
    } else if (normTo) {
      params.push(normTo);
      conditions.push(`b.check_in_date <= $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT b.booking_id, b.guest_name, b.guest_phone,
              b.check_in_date, b.check_out_date, b.booking_status,
              b.payment_status, b.booking_ref, b.transaction_id,
              b.license_file_path, b.booking_source, b.device,
              r.room_type, r.price_per_night,
              h.hotel_name
       FROM bookings b
       JOIN rooms r ON b.room_id = r.room_id
       JOIN hotels h ON b.hotel_id = h.hotel_id
       ${whereClause}
       ORDER BY b.check_in_date DESC, b.created_at DESC`,
      params
    );
    

  

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// Staff: mark payment as paid (e.g., pay-on-arrival at check-in)
app.post("/api/staff/bookings/:booking_id/mark-paid", verifyToken, async (req, res) => {
  const { booking_id } = req.params;
  const hotel_id = req.user.hotel_id;
  if (!booking_id || !hotel_id) {
    return res.status(400).json({ message: "booking_id and hotel_id are required" });
  }
  try {
    console.log("Mark paid attempt", { booking_id, hotel_id });
    const result = await db.query(
      `UPDATE bookings
         SET payment_status = 'paid',
             booking_status = CASE WHEN booking_status = 'pending' THEN 'confirmed' ELSE booking_status END,
             transaction_id = COALESCE(transaction_id, 'PAY_ON_ARRIVAL_' || booking_id)
       WHERE booking_id = $1::int AND hotel_id = $2::int
       RETURNING booking_id, booking_status, payment_status, transaction_id`,
      [booking_id, hotel_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Booking not found for this hotel" });
    }
    res.json({ message: "Payment marked as paid", booking: result.rows[0] });
  } catch (err) {
    console.error("mark-paid error:", err.message);
    res.status(500).json({ message: "Failed to update payment status" });
  }
});

// ADMIN: list unverified hotels
app.get("/api/admin/hotels/pending", verifyAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT hotel_id, hotel_name, location, contact_email, contact_phone, license_file_path, is_verified
       FROM hotels
       WHERE is_verified = false
       ORDER BY hotel_id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ADMIN: verify a hotel
app.post("/api/admin/hotels/:hotel_id/verify", verifyAdmin, async (req, res) => {
  const { hotel_id } = req.params;
  try {
    const result = await db.query(
      "UPDATE hotels SET is_verified = true WHERE hotel_id = $1 RETURNING hotel_id",
      [hotel_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: "Hotel not found" });
    res.json({ message: "Hotel verified" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ADMIN: remove a hotel (and its related data)
app.delete("/api/admin/hotels/:hotel_id", verifyAdmin, async (req, res) => {
  const { hotel_id } = req.params;
  try {
    await db.query("BEGIN");
    // remove dependent data to avoid FK issues
    await db.query("DELETE FROM bookings WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM room_pictures WHERE room_id IN (SELECT room_id FROM rooms WHERE hotel_id = $1)", [hotel_id]);
    await db.query("DELETE FROM room_amenities WHERE room_id IN (SELECT room_id FROM rooms WHERE hotel_id = $1)", [hotel_id]);
    await db.query("DELETE FROM rooms WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM staff_users WHERE hotel_id = $1", [hotel_id]);
    const result = await db.query("DELETE FROM hotels WHERE hotel_id = $1 RETURNING hotel_id", [hotel_id]);
    await db.query("COMMIT");
    if (result.rowCount === 0) return res.status(404).json({ message: "Hotel not found" });
    res.json({ message: "Hotel removed" });
  } catch (err) {
    await db.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ message: "Server error removing hotel" });
  }
});


// ==========================================
app.get("/api/staff/analytics", verifyToken, async (req, res) => {
  const hotel_id = req.user.hotel_id;
  const period = parseInt(req.query.period) || 30; // Default 30 days

  if (!hotel_id) return res.status(400).json({ message: "hotel_id is required" });

  try {
    const hotelMeta = await db.query("SELECT hotel_name FROM hotels WHERE hotel_id = $1", [hotel_id]);
    const hotelName = hotelMeta.rows[0]?.hotel_name || null;

    const today = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - period);

    const endDateExclusive = new Date(today);
    endDateExclusive.setDate(endDateExclusive.getDate() + 1); // make end bound inclusive of today

    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateExclusiveStr = endDateExclusive.toISOString().slice(0, 10);
    const previousStartDateStr = previousStartDate.toISOString().slice(0, 10);

    // 1️⃣ CORE METRICS (Current Period)
    const coreMetrics = await db.query(
      `WITH stay_dates AS (
         SELECT b.booking_id, b.booking_status,
                r.price_per_night,
                COALESCE(b.number_of_rooms, 1) AS rooms,
                generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
         FROM bookings b
         JOIN rooms r ON b.room_id = r.room_id
         WHERE b.hotel_id = $1
       )
       SELECT 
         COUNT(DISTINCT booking_id) FILTER (WHERE booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3) AS confirmed_bookings,
         COALESCE(SUM(CASE WHEN booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3 THEN price_per_night * rooms END), 0) AS total_revenue,
         COALESCE(SUM(CASE WHEN booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3 THEN rooms END), 0) AS room_nights,
         COALESCE(SUM(CASE WHEN booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3 THEN 1 END), 0) AS booking_nights
       FROM stay_dates`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const data = coreMetrics.rows[0];
    const totalRevenue = parseInt(data.total_revenue) || 0;
    const roomNights = parseInt(data.room_nights) || 0;      // room-nights (includes number_of_rooms)
    const bookingNights = parseInt(data.booking_nights) || 0; // stay-nights (ignores room count) for ALOS
    const confirmedCount = parseInt(data.confirmed_bookings) || 0;

    // Cancellations (no cancelled_at column, so fallback to creation window)
    const cancelledResult = await db.query(
      `SELECT COUNT(*) AS cancelled
         FROM bookings 
        WHERE hotel_id = $1 AND booking_status = 'cancelled' AND created_at >= $2`,
      [hotel_id, startDateStr]
    );
    const cancelledCount = parseInt(cancelledResult.rows[0].cancelled) || 0;
    const totalBookings = confirmedCount + cancelledCount;

    // 2️⃣ HOTEL CAPACITY
    const totalRoomsResult = await db.query(
      `SELECT COALESCE(SUM(total_rooms), 1) as total_capacity FROM rooms WHERE hotel_id = $1`,
      [hotel_id]
    );
    const totalCapacity = parseInt(totalRoomsResult.rows[0].total_capacity) || 1;
    const totalAvailableNights = totalCapacity * period;

    // 3️⃣ CALCULATE ADVANCED KPIs
    const occupancyRate = totalAvailableNights > 0 ? ((roomNights / totalAvailableNights) * 100).toFixed(1) : 0;
    const revpar = totalAvailableNights > 0 ? Math.round(totalRevenue / totalAvailableNights) : 0;
    const adr = roomNights > 0 ? Math.round(totalRevenue / roomNights) : 0;
    const alos = confirmedCount > 0 ? (bookingNights / confirmedCount).toFixed(1) : 0;
    const cancellationRate = totalBookings > 0 ? ((cancelledCount / totalBookings) * 100).toFixed(1) : 0;

    // 4️⃣ REPEAT GUESTS
    const guestMetrics = await db.query(
      `SELECT COUNT(DISTINCT guest_phone) as unique_guests
       FROM bookings 
       WHERE hotel_id = $1 
         AND booking_status = 'confirmed' 
         AND check_in_date < $3 
         AND check_out_date > $2`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );
    const uniqueGuests = parseInt(guestMetrics.rows[0].unique_guests) || 0;
    const repeatGuestRate = confirmedCount > 0 ? (((confirmedCount - uniqueGuests) / confirmedCount) * 100).toFixed(1) : 0;

    // 5️⃣ REVENUE BY ROOM TYPE
    const revenueByRoom = await db.query(
      `SELECT 
        r.room_type,
        COUNT(DISTINCT b.booking_id) as bookings,
        COALESCE(SUM(r.price_per_night * COALESCE(b.number_of_rooms, 1)), 0) as revenue
       FROM bookings b
       JOIN rooms r ON b.room_id = r.room_id
       CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
       WHERE b.hotel_id = $1 
         AND b.booking_status = 'confirmed' 
         AND stay_date >= $2 AND stay_date < $3
       GROUP BY r.room_type
       ORDER BY revenue DESC`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    // 6️⃣ PEAK DAYS
    const peakDays = await db.query(
      `SELECT 
        TRIM(TO_CHAR(stay_date, 'Day')) as day_of_week,
        COUNT(*) as bookings
       FROM bookings b
       CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
       WHERE b.hotel_id = $1 
         AND b.booking_status = 'confirmed' 
         AND stay_date >= $2 AND stay_date < $3
       GROUP BY TRIM(TO_CHAR(stay_date, 'Day'))
       ORDER BY bookings DESC`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );
    const peakMap = {};
    peakDays.rows.forEach(r => {
      peakMap[r.day_of_week.trim()] = parseInt(r.bookings) || 0;
    });
    const weekLabels = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const peakDaysFull = weekLabels.map(d => ({
      day_of_week: d,
      bookings: peakMap[d] || 0
    }));

    // 7️⃣ REVENUE & OCCUPANCY TREND (stay-date based)
    const revenueTrend = await db.query(
      `SELECT 
         TO_CHAR(stay_date, 'Mon DD') as date,
         stay_date::date as stay_key,
         COALESCE(SUM(r.price_per_night * COALESCE(b.number_of_rooms, 1)), 0) as daily_revenue,
         COALESCE(SUM(COALESCE(b.number_of_rooms,1)),0) as occupied_rooms
       FROM bookings b
       JOIN rooms r ON b.room_id = r.room_id
       CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
       WHERE b.hotel_id = $1 
         AND b.booking_status = 'confirmed' 
         AND stay_date >= $2 AND stay_date < $3
       GROUP BY stay_date
       ORDER BY stay_date ASC`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    // 8️⃣ PREVIOUS PERIOD COMPARISON
    const prevMetrics = await db.query(
      `WITH stay_dates AS (
         SELECT r.price_per_night,
                COALESCE(b.number_of_rooms, 1) AS rooms,
                generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
         FROM bookings b
         JOIN rooms r ON b.room_id = r.room_id
         WHERE b.hotel_id = $1 AND b.booking_status = 'confirmed'
       )
       SELECT COALESCE(SUM(CASE WHEN stay_date >= $2 AND stay_date < $3 THEN price_per_night * rooms END), 0) as prev_revenue
       FROM stay_dates`,
      [hotel_id, previousStartDateStr, startDateStr]
    );
    const prevRevenue = parseInt(prevMetrics.rows[0].prev_revenue) || 0;
    const revenueChange = prevRevenue > 0 ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : (totalRevenue > 0 ? 100 : 0);

    // 🔟 PAYMENT MIX (creation window)
    let paymentMixRows = [];
    try {
      const pm = await db.query(
        `SELECT payment_status, COUNT(*) AS count
           FROM bookings
          WHERE hotel_id = $1
            AND created_at >= $2
            AND created_at < $3
          GROUP BY payment_status`,
        [hotel_id, startDateStr, endDateExclusiveStr]
      );
      paymentMixRows = pm.rows;
    } catch (e) {
      console.error("payment mix error:", e.message);
    }

    // 1️⃣1️⃣ TOP ROOMS (revenue and cancellations)
    let topRoomsRows = [];
    try {
      const tr = await db.query(
        `WITH stay_rev AS (
           SELECT r.room_type,
                  COALESCE(SUM(r.price_per_night * COALESCE(b.number_of_rooms,1)),0) AS revenue,
                  COUNT(DISTINCT b.booking_id) AS bookings
             FROM bookings b
             JOIN rooms r ON b.room_id = r.room_id
             CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
            WHERE b.hotel_id = $1
              AND b.booking_status = 'confirmed'
              AND stay_date >= $2 AND stay_date < $3
            GROUP BY r.room_type
         ),
         cancels AS (
           SELECT r.room_type, COUNT(*) AS cancels
             FROM bookings b
             JOIN rooms r ON b.room_id = r.room_id
         WHERE b.hotel_id = $1
            AND b.booking_status = 'cancelled'
              AND b.created_at >= $2 AND b.created_at < $3
          GROUP BY r.room_type
       )
        SELECT sr.room_type,
               sr.revenue,
               sr.bookings,
               COALESCE(c.cancels,0) AS cancels
          FROM stay_rev sr
          LEFT JOIN cancels c ON c.room_type = sr.room_type
          ORDER BY sr.revenue DESC, sr.bookings DESC
          LIMIT 5`,
        [hotel_id, startDateStr, endDateExclusiveStr]
      );
      topRoomsRows = tr.rows;
    } catch (e) {
      console.error("top rooms error:", e.message);
    }

    // 1️⃣2️⃣ LEAD TIME BUCKETS (confirmed bookings)
    let leadTimeRows = [];
    try {
      const lt = await db.query(
        `SELECT bucket, COUNT(*) AS count FROM (
           SELECT CASE 
             WHEN lt <= 1 THEN '0-1'
             WHEN lt <= 3 THEN '2-3'
             WHEN lt <= 7 THEN '4-7'
             WHEN lt <= 14 THEN '8-14'
             WHEN lt <= 30 THEN '15-30'
             ELSE '30+'
           END AS bucket
           FROM (
             SELECT GREATEST(0, DATE_PART('day', b.check_in_date - b.created_at)) AS lt
               FROM bookings b
              WHERE b.hotel_id = $1
                AND b.booking_status = 'confirmed'
                AND b.created_at >= $2
                AND b.created_at < $3
           ) t
         ) buckets
         GROUP BY bucket
         ORDER BY 
           CASE bucket
             WHEN '0-1' THEN 1
             WHEN '2-3' THEN 2
             WHEN '4-7' THEN 3
             WHEN '8-14' THEN 4
             WHEN '15-30' THEN 5
             ELSE 6
           END`,
        [hotel_id, startDateStr, endDateExclusiveStr]
      );
      leadTimeRows = lt.rows;
    } catch (e) {
      console.error("lead time error:", e.message);
    }

    // 1️⃣3️⃣ PAYMENT DAILY (stay-date based paid vs pending)
    let paymentDailyRows = [];
    try {
      const pd = await db.query(
        `SELECT
            stay_date::date as stay_key,
            TO_CHAR(stay_date, 'Mon DD') as date,
            SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid,
            SUM(CASE WHEN payment_status != 'paid' THEN 1 ELSE 0 END) as pending
         FROM bookings b
         CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
        WHERE b.hotel_id = $1
          AND b.booking_status IN ('confirmed','pending')
          AND stay_date >= $2 AND stay_date < $3
        GROUP BY stay_date
        ORDER BY stay_date`,
        [hotel_id, startDateStr, endDateExclusiveStr]
      );
      paymentDailyRows = pd.rows;
    } catch (e) {
      console.error("payment daily error:", e.message);
    }

    // 1️⃣4️⃣ Cancellations by payment type (creation window)
    let cancelsByPay = [];
    try {
      const cp = await db.query(
        `SELECT payment_status, COUNT(*) as cancels
           FROM bookings
          WHERE hotel_id = $1
            AND booking_status = 'cancelled'
            AND created_at >= $2 AND created_at < $3
          GROUP BY payment_status`,
        [hotel_id, startDateStr, endDateExclusiveStr]
      );
      cancelsByPay = cp.rows;
    } catch (e) {
      console.error("cancel by pay error:", e.message);
    }

    // 1️⃣5️⃣ Source mix & trend
    let sourceMix = [];
    let sourceTrendRows = [];
    try {
      const sm = await db.query(
        `SELECT COALESCE(booking_source,'unknown') AS source, COUNT(*) AS count
           FROM bookings
          WHERE hotel_id = $1
            AND created_at >= $2 AND created_at < $3
          GROUP BY COALESCE(booking_source,'unknown')`,
        [hotel_id, startDateStr, endDateExclusiveStr]
      );
      sourceMix = sm.rows;

      const st = await db.query(
        `SELECT 
            created_at::date as d,
            TO_CHAR(created_at::date, 'Mon DD') as date,
            SUM(CASE WHEN booking_source='web' THEN 1 ELSE 0 END) as web,
            SUM(CASE WHEN booking_source='chat' THEN 1 ELSE 0 END) as chat,
            SUM(CASE WHEN booking_source='phone' THEN 1 ELSE 0 END) as phone,
            SUM(CASE WHEN booking_source='ota' THEN 1 ELSE 0 END) as ota,
            SUM(CASE WHEN booking_source NOT IN ('web','chat','phone','ota') OR booking_source IS NULL THEN 1 ELSE 0 END) as other
         FROM bookings
         WHERE hotel_id = $1
           AND created_at >= $2 AND created_at < $3
         GROUP BY d
         ORDER BY d`,
        [hotel_id, startDateStr, endDateExclusiveStr]
      );
      sourceTrendRows = st.rows;
    } catch (e) {
      console.error("source mix error:", e.message);
    }

    // 1️⃣6️⃣ Alerts: unpaid arrivals today/next 3 days
    const todayStr = new Date().toISOString().slice(0,10);
    const plus3 = new Date();
    plus3.setDate(plus3.getDate() + 3);
    const plus3Str = plus3.toISOString().slice(0,10);
    let unpaidArrivals = 0;
    try {
      const ua = await db.query(
        `SELECT COUNT(*) as cnt
           FROM bookings
          WHERE hotel_id = $1
            AND booking_status IN ('confirmed','pending')
            AND payment_status != 'paid'
            AND check_in_date >= $2
            AND check_in_date <= $3`,
        [hotel_id, todayStr, plus3Str]
      );
      unpaidArrivals = parseInt(ua.rows[0].cnt) || 0;
    } catch (e) {
      console.error("unpaid arrivals error:", e.message);
    }

    // 9️⃣ TODAY'S AVAILABLE ROOMS (current snapshot)
    const availSnapshot = await db.query(
      `SELECT 
         COALESCE(SUM(r.total_rooms),0) 
         - COALESCE((
            SELECT SUM(b.number_of_rooms) 
            FROM bookings b 
            WHERE b.hotel_id = $1 
              AND b.booking_status = 'confirmed' 
              AND b.check_in_date <= CURRENT_DATE 
              AND b.check_out_date > CURRENT_DATE
          ),0) AS available_rooms
       FROM rooms r
       WHERE r.hotel_id = $1`,
      [hotel_id]
    );
    const availableRoomsToday = parseInt(availSnapshot.rows[0].available_rooms) || 0;

    // 🚀 SEND PERFECTLY FORMATTED JSON
    // Derive payment mix map
    const paymentMixMap = paymentMixRows.reduce((acc, row) => {
      acc[row.payment_status || "unknown"] = parseInt(row.count) || 0;
      return acc;
    }, {});

    // Occupancy % per day for trend
    const trendWithOcc = revenueTrend.rows.map(r => ({
      date: r.date,
      daily_revenue: parseInt(r.daily_revenue) || 0,
      occupancy_pct: totalCapacity > 0 ? Number(((parseInt(r.occupied_rooms) || 0) / totalCapacity) * 100).toFixed(1) : 0
    }));

    res.json({
      period: period,
      hotel: {
        hotel_id,
        hotel_name: hotelName
      },
      summary: {
        total_revenue: totalRevenue,
        total_bookings: totalBookings,
        confirmed_bookings: confirmedCount,
        cancelled_bookings: cancelledCount,
        available_rooms: availableRoomsToday
      },
      key_metrics: {
        occupancy_rate: occupancyRate,
        revpar: revpar,
        adr: adr,
        alos: alos,
        cancellation_rate: cancellationRate,
        repeat_guest_rate: repeatGuestRate,
        payment_mix: paymentMixMap
      },
      revenue_by_room_type: revenueByRoom.rows.map(r => ({
        room_type: r.room_type,
        revenue: parseInt(r.revenue) || 0
      })),
      peak_days: peakDaysFull,
      revenue_trend: trendWithOcc,
      top_rooms: topRoomsRows.map(r => ({
        room_type: r.room_type,
        revenue: parseInt(r.revenue) || 0,
        bookings: parseInt(r.bookings) || 0,
        cancels: parseInt(r.cancels) || 0
      })),
      lead_time: leadTimeRows.map(r => ({
        bucket: r.bucket,
        count: parseInt(r.count) || 0
      })),
      payment_daily: paymentDailyRows.map(r => ({
        date: r.date,
        paid: parseInt(r.paid) || 0,
        pending: parseInt(r.pending) || 0
      })),
      cancellations_by_payment: (() => {
        // ensure all payment statuses appear, even if 0 cancels
        const cancelMap = {};
        cancelsByPay.forEach(r => {
          cancelMap[(r.payment_status || "unknown")] = parseInt(r.cancels) || 0;
        });
        Object.keys(paymentMixMap).forEach(k => {
          if (!cancelMap.hasOwnProperty(k)) cancelMap[k] = 0;
        });
        // Always include paid/pending buckets for chart stability
        if (!cancelMap.hasOwnProperty("paid")) cancelMap["paid"] = 0;
        if (!cancelMap.hasOwnProperty("pending")) cancelMap["pending"] = 0;
        return Object.entries(cancelMap).map(([k,v]) => ({
          payment_status: k,
          cancels: v
        }));
      })(),
      source_mix: sourceMix.map(r => ({
        source: r.source,
        count: parseInt(r.count) || 0
      })),
      source_trend: sourceTrendRows.map(r => ({
        date: r.date,
        web: parseInt(r.web) || 0,
        chat: parseInt(r.chat) || 0,
        phone: parseInt(r.phone) || 0,
        ota: parseInt(r.ota) || 0,
        other: parseInt(r.other) || 0
      })),
      alerts: {
        unpaid_arrivals_next3: unpaidArrivals
      },
      comparison: {
        revenue_change_percent: parseFloat(revenueChange),
        previous_period_revenue: prevRevenue
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error generating analytics" });
  }
});
// app.post("/api/guest/query", async (req, res) => {
//   const { hotel_id, query_text, history, bookingDetails, check_in, check_out } = req.body;

//   if (!hotel_id || !query_text) {
//     return res.status(400).json({ message: "hotel_id and query_text are required" });
//   }

//   try {
//     // 1. Fetch REAL Hotel Data from DB
//     const hotelResult = await db.query(
//       `SELECT hotel_id, hotel_name, location FROM hotels WHERE hotel_id = $1`,
//       [hotel_id]
//     );

//     if (hotelResult.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });

//     // 2. Fetch Dynamic Pricing & True Availability for these specific dates!
//     const roomsResult = await db.query(
//       `SELECT 
//           r.room_id, 
//           r.room_type as type, 
//           COALESCE(o.custom_price, r.price_per_night) as price,
//           r.total_rooms - COALESCE(
//               (SELECT SUM(number_of_rooms) FROM bookings b 
//                WHERE b.room_id = r.room_id 
//                AND b.booking_status = 'confirmed' 
//                AND b.check_in_date < $3 
//                AND b.check_out_date > $2), 0
//           ) as available
//        FROM rooms r
//        LEFT JOIN room_price_overrides o 
//           ON r.room_id = o.room_id AND o.target_date = $2
//        WHERE r.hotel_id = $1`,
//       [hotel_id, check_in, check_out]
//     );

//     // 3. Build the Context Object for the AI
//     const hotelContext = {
//       hotel_id: hotel_id,
//       hotel_name: hotelResult.rows[0].hotel_name,
//       location: hotelResult.rows[0].location,
//       target_check_in: check_in,
//       target_check_out: check_out,
//       rooms: roomsResult.rows || []
//     };

//     // 4. Call the AI Service
//     const aiResult = await processGuestQuery(query_text, hotelContext, db, history);

//     let bookingResponse = null;
//     let finalBookingDetails = bookingDetails || aiResult.bookingDetails;
    
//     // 5. Secure Auto-Complete Booking (with Transactions!)
//     if (aiResult.guestDetails && finalBookingDetails) {
//       const { name: guestName, phone } = aiResult.guestDetails;
//       const roomRecord = hotelContext.rooms.find(r => r.type.toLowerCase() === finalBookingDetails.room_type.toLowerCase());
      
//       if (roomRecord && roomRecord.available > 0) {
//         try {
//           await db.query("BEGIN");
          
//           // Lock the room row to prevent race conditions
//           await db.query("SELECT total_rooms FROM rooms WHERE room_id = $1 FOR UPDATE", [roomRecord.room_id]);

//           // Double check availability one last time
//           const overlapCheck = await db.query(
//             `SELECT SUM(number_of_rooms) as booked_count FROM bookings 
//              WHERE room_id = $1 AND booking_status = 'confirmed' AND check_in_date < $3 AND check_out_date > $2`,
//             [roomRecord.room_id, check_in, check_out]
//           );
          
//           const currentlyBooked = parseInt(overlapCheck.rows[0].booked_count) || 0;
//           const actualAvailable = roomRecord.total_rooms - currentlyBooked; // Note: Ensure you fetch total_rooms in step 2 if needed here, or assume roomRecord.available is close enough for the lock check

//           // Insert if safe
//           await db.query(
//             `INSERT INTO bookings (hotel_id, room_id, guest_name, guest_phone, check_in_date, check_out_date, number_of_rooms, booking_status)
//              VALUES ($1, $2, $3, $4, $5, $6, 1, 'confirmed')`,
//             [hotel_id, roomRecord.room_id, guestName, phone, check_in, check_out]
//           );

//           await db.query("COMMIT");

//           bookingResponse = {
//             intent: "booking_confirmed",
//             response: `✅ Booking confirmed!\n• Guest: ${guestName}\n• Room: ${finalBookingDetails.room_type}\n• Check-in: ${check_in}\n• Phone: ${phone}\n\nThank you for booking with us!`,
//             booking_created: true
//           };
//         } catch (bookingErr) {
//           await db.query("ROLLBACK");
//           console.error("Booking creation error:", bookingErr);
//         }
//       }
//     }
    
//     // 6. Store the Interaction in DB
//     await db.query(
//       `INSERT INTO guest_queries (hotel_id, query_text, intent_detected, response_text) VALUES ($1, $2, $3, $4)`,
//       [hotel_id, query_text, aiResult.intent, aiResult.response]
//     );

//     res.json({
//       reply: bookingResponse?.response || aiResult.response,
//       response: bookingResponse?.response || aiResult.response,
//       intent: bookingResponse?.intent || aiResult.intent,
//       bookingDetails: finalBookingDetails || null,
//       guestDetails: aiResult.guestDetails || null,
//       booking_created: bookingResponse?.booking_created || false
//     });

//   } catch (err) {
//     console.error("API Error:", err);
//     res.status(500).json({ message: "Server error processing AI request" });
//   }
// });

// FILE: backend/app.js
// REPLACE THE /api/guest/query endpoint with this complete code

app.post("/api/guest/query", async (req, res) => {
  const { hotel_id, query_text, check_in, check_out, chatState } = req.body;

  if (!hotel_id || !query_text) {
    return res.status(400).json({ message: "hotel_id and query_text are required" });
  }

  // --- THE FIX: DATE AWARENESS ---
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // We explicitly flag if the guest used the calendar!
  const datesProvided = !!(check_in && check_out); 
  const safeCheckIn = check_in ? check_in : today.toISOString().split('T')[0];
  const safeCheckOut = check_out ? check_out : tomorrow.toISOString().split('T')[0];

  try {
    const hotelResult = await db.query(
      `SELECT hotel_id, hotel_name, location, description, address, google_maps_url, contact_phone, contact_email 
       FROM hotels WHERE hotel_id = $1`,
      [hotel_id]
    );

    if (hotelResult.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });

    const roomsResult = await db.query(
      `SELECT r.room_id, r.room_type as type, COALESCE(o.custom_price, r.price_per_night) as price,
              r.description, r.capacity,
              (SELECT string_agg(amenity_name, ', ') FROM room_amenities WHERE room_id = r.room_id) AS room_amenities,
              r.total_rooms - COALESCE(
                  (SELECT SUM(number_of_rooms) FROM bookings b 
                   WHERE b.room_id = r.room_id AND b.booking_status = 'confirmed' 
                   AND b.check_in_date < $3 AND b.check_out_date > $2), 0
              ) as available
       FROM rooms r
       LEFT JOIN room_price_overrides o ON r.room_id = o.room_id AND o.target_date = $2
       WHERE r.hotel_id = $1`,
      [hotel_id, safeCheckIn, safeCheckOut] 
    );
    
    // Fetch amenities for this hotel
    const amenitiesResult = await db.query(
      `SELECT DISTINCT amenity_name FROM room_amenities WHERE room_id IN (SELECT room_id FROM rooms WHERE hotel_id = $1)`,
      [hotel_id]
    );
    const hotelAmenities = amenitiesResult.rows.map(a => a.amenity_name).join(", ");

    // 3. Build Hotel Context for AI
    const hotelInfo = hotelResult.rows[0];
    const hotelContext = {
      hotel_id: hotel_id,
      hotel_name: hotelInfo.hotel_name,
      location: hotelInfo.location,
      description: hotelInfo.description || "",
      address: hotelInfo.address || "",
      google_maps: hotelInfo.google_maps_url || "",
      contact: `${hotelInfo.contact_phone || ""} | ${hotelInfo.contact_email || ""}`,
      amenities: hotelAmenities || "Standard hotel amenities",
      target_check_in: check_in,
      target_check_out: check_out,
      
      datesProvided: (req.body.check_in && req.body.check_out) ? true : false, 
      
      rooms: roomsResult.rows.map(r => ({
        room_id: r.room_id,
        type: r.type,
        price: parseInt(r.price),
        available: Math.max(0, parseInt(r.available)),
        description: r.description || "",
        capacity: parseInt(r.capacity) || 2,
        amenities: r.room_amenities || "Standard amenities"
      }))
    };

    // Pass query and state to AI
    const aiResult = await processGuestQuery(query_text, hotelContext, chatState);

    // Save to history
    await db.query(
      `INSERT INTO guest_queries (hotel_id, query_text, intent_detected, response_text) VALUES ($1, $2, $3, $4)`,
      [hotel_id, query_text, aiResult.intent, aiResult.response]
    );

    res.json({
      reply: aiResult.response,
      intent: aiResult.intent,
      chatState: aiResult.chatState
    });

  } catch (err) {
    console.error("API Error:", err);
    res.status(500).json({ message: "Server error processing AI request" });
  }
});

app.get("/api/staff/queries/summary", verifyToken,async (req, res) => {
  const  hotel_id  = req.user.hotel_id;

  if (!hotel_id) {
    return res.status(400).json({ message: "hotel_id is required" });
  }

  try {
    const totalQueries = await db.query(
      `SELECT COUNT(*) FROM guest_queries WHERE hotel_id = $1`,
      [hotel_id]
    );

    const topIntents = await db.query(
      `SELECT intent_detected, COUNT(*) AS count
       FROM guest_queries
       WHERE hotel_id = $1
       GROUP BY intent_detected
       ORDER BY count DESC`,
      [hotel_id]
    );

    const commonQuestions = await db.query(
      `SELECT query_text, COUNT(*) AS count
       FROM guest_queries
       WHERE hotel_id = $1
       GROUP BY query_text
       ORDER BY count DESC
       LIMIT 5`,
      [hotel_id]
    );

    res.json({
      total_queries: totalQueries.rows[0].count,
      intent_breakdown: topIntents.rows,
      common_questions: commonQuestions.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// app.patch("/api/bookings/:booking_id/cancel", async (req, res) => {
//   const { booking_id } = req.params;

//   try {
//     // Fetch booking details
//     const bookingResult = await db.query(
//       `SELECT room_id, booking_status
//        FROM bookings
//        WHERE booking_id = $1`,
//       [booking_id]
//     );

//     if (bookingResult.rows.length === 0) {
//       return res.status(404).json({ message: "Booking not found" });
//     }

//     const booking = bookingResult.rows[0];

//     // if (booking.bookingstatus === "checked_in") {
//     //   return res.status(400).json({ message: "Cannot cancel checked-in booking" });
//     // }


// // changed status to booking_status

//     if (booking.booking_status === "cancelled") {
//       return res.status(400).json({ message: "Booking already cancelled" });
//     }

//     // Start transaction
//     await db.query("BEGIN");

//     // Update booking status
//     await db.query(
//       `UPDATE bookings
//        SET booking_status = 'cancelled'
//        WHERE booking_id = $1`,
//       [booking_id]
//     );

//     // Increase available rooms
  

//     await db.query("COMMIT");

//     res.json({ message: "Booking cancelled successfully" });

//   } catch (err) {
//     await db.query("ROLLBACK");
//     console.error(err);
//     res.status(500).json({ message: "Server error" });
//   }
// });


// ==========================================
// GUEST: CANCEL BOOKING
// ==========================================
app.post("/api/guest/cancel-booking", async (req, res) => {
  const { booking_ref, guest_phone } = req.body;

  if (!booking_ref || !guest_phone) {
    return res.status(400).json({ message: "Reference and Phone are required." });
  }

  try {
    // 1. Find the exact booking
    const result = await db.query(
      `SELECT booking_id, booking_status, created_at 
       FROM bookings 
       WHERE booking_ref = $1 AND guest_phone = $2`,
      [booking_ref.trim(), guest_phone.trim()]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Booking not found. Please check your details." });
    }

    const booking = result.rows[0];

    // 2. Prevent double cancellations
    if (booking.booking_status === 'cancelled') {
      return res.status(400).json({ message: "This booking is already cancelled." });
    }

    // 3. Time Restriction Logic (e.g., 24-hour grace period)
    const now = new Date();
    const bookingTime = new Date(booking.created_at);
    const hoursDifference = (now - bookingTime) / (1000 * 60 * 60);

    // Set to 24 hours. You can change this number to 2 or 4 if you want a stricter policy!
    const MAX_CANCELLATION_HOURS = 24; 

    if (hoursDifference > MAX_CANCELLATION_HOURS) {
      return res.status(400).json({ 
        message: `Cancellation period expired. You can only cancel within the first ${MAX_CANCELLATION_HOURS} hours.` 
      });
    }

    // 4. Update the status to 'cancelled'
    await db.query(
      `UPDATE bookings SET booking_status = 'cancelled' WHERE booking_id = $1`,
      [booking.booking_id]
    );

    res.json({ message: "Booking successfully cancelled. The room has been released." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error during cancellation." });
  }
});
app.get("/api/pricing/recommendations", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  const daysAhead = parseInt(req.query.days) || 7;

  if (!hotelId) {
    return res.status(400).json({ message: "Hotel ID required" });
  }

  try {
    console.log(
      `\n🎯 Getting pricing recommendations for hotel ${hotelId} (${daysAhead} days)`
    );

    const recommendations = await getPricingRecommendations(
      db,
      hotelId,
      daysAhead
    );

    res.json({
      hotel_id: hotelId,
      total_recommendations: recommendations.length,
      days_ahead: daysAhead,
      recommendations: recommendations,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Failed to get recommendations" });
  }
});

app.post("/api/pricing/calculate", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  const { room_id, booking_date } = req.body;

  if (!room_id || !booking_date) {
    return res
      .status(400)
      .json({ message: "room_id and booking_date required" });
  }

  try {
    const date = new Date(booking_date);
    const pricing = await calculateOptimalPrice(db, hotelId, room_id, date);

    res.json({
      room_id,
      booking_date,
      ...pricing,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Failed to calculate price" });
  }
});

app.post("/api/pricing/apply", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  // ADDED: We must extract target_date from the frontend request
  const { room_id, new_price, target_date } = req.body;

  if (!room_id || !new_price || !target_date) {
    return res.status(400).json({ message: "room_id, new_price, and target_date required" });
  }

  try {
    // UPDATED: Pass target_date into the pricingEngine function
    const result = await applyRecommendedPrice(
      db,
      hotelId,
      room_id,
      target_date, 
      new_price
    );

    res.json({
      message: "Price applied successfully",
      room: result,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Failed to apply price" });
  }
});

app.get("/api/pricing/history", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  const days = parseInt(req.query.days) || 30;

  if (!hotelId) {
    return res.status(400).json({ message: "Hotel ID required" });
  }

  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);

    const result = await db.query(
      `SELECT 
        room_id, 
        date_for_booking, 
        base_price, 
        calculated_price, 
        occupancy_rate,
        reason
       FROM pricing_history
       WHERE hotel_id = $1 AND created_at >= $2
       ORDER BY created_at DESC`,
      [hotelId, fromDate]
    );

    res.json({
      hotel_id: hotelId,
      period_days: days,
      total_records: result.rows.length,
      history: result.rows,
    });
  } catch (err) {
    console.error("Error:", err);
    res.status(500).json({ message: "Failed to get history" });
  }
});

httpServer.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
