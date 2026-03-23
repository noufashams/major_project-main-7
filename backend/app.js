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
const port = process.env.PORT || 3000;

dotenv.config();

// 🚨 WRAP EXPRESS WITH HTTP & SOCKET.IO
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:5173',
    credentials: true
  }
});

// Reusable email sender for platform notifications
const sendPlatformEmail = async (to, subject, text) => {
  if (!to) return { sent: false, error: "No recipient provided" };
  try {
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
          auth: hasUser ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
        });

    await transporter.sendMail({
      from: process.env.SMTP_FROM || "no-reply@stayos.com",
      to,
      subject,
      text
    });

    return { sent: true, error: null };
  } catch (err) {
    console.error("Email send skipped/failed:", err.message);
    return { sent: false, error: err.message };
  }
};

// 🚨 WEBSOCKET LISTENER LOGIC
io.on("connection", (socket) => {
  console.log("🟢 Live Dashboard Connected:", socket.id);

  socket.on("join_hotel_room", (hotelId) => {
    socket.join(`hotel_${hotelId}`);
    console.log(`🔒 Dashboard subscribed to live updates for Hotel ID: ${hotelId}`);
  });

  socket.on("disconnect", () => {
    console.log("🔴 Live Dashboard Disconnected");
  });
});

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

(async () => {
  try {
    await db.query("ALTER TABLE hotels ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT false");
    await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_source VARCHAR(50) DEFAULT 'web'");
    await db.query("ALTER TABLE bookings ADD COLUMN IF NOT EXISTS device VARCHAR(50) DEFAULT 'desktop'");

    // Physical room inventory (per-room numbers) and booking assignments
    await db.query(`
      CREATE TABLE IF NOT EXISTS room_inventory (
        room_physical_id SERIAL PRIMARY KEY,
        hotel_id INT NOT NULL,
        room_id INT NOT NULL,
        room_number VARCHAR(50) NOT NULL,
        status VARCHAR(20) DEFAULT 'available',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(room_id, room_number),
        FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id) ON DELETE CASCADE,
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
      )
    `);
    // Backfill missing columns for legacy tables
    await db.query(`ALTER TABLE room_inventory ADD COLUMN IF NOT EXISTS room_number VARCHAR(50) NOT NULL DEFAULT 'Room'`);
    await db.query(`ALTER TABLE room_inventory ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'available'`);
    // Backfill column/PK if table existed without them
    await db.query(`ALTER TABLE room_inventory ADD COLUMN IF NOT EXISTS room_physical_id SERIAL`);
    await db.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE table_name = 'room_inventory' AND constraint_type = 'PRIMARY KEY'
        ) THEN
          ALTER TABLE room_inventory ADD PRIMARY KEY (room_physical_id);
        END IF;
      END$$;
    `);
    // Renumber any legacy rows that still have the placeholder 'Room'
    await db.query(`
      WITH numbered AS (
        SELECT room_physical_id,
               CONCAT('Room ', ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY room_physical_id)) AS new_num
        FROM room_inventory
        WHERE room_number IS NULL OR room_number = 'Room'
      )
      UPDATE room_inventory ri
         SET room_number = n.new_num
        FROM numbered n
       WHERE ri.room_physical_id = n.room_physical_id
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS booking_assigned_rooms (
        booking_id INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
        room_physical_id INT NOT NULL REFERENCES room_inventory(room_physical_id) ON DELETE CASCADE,
        room_number VARCHAR(50) NOT NULL,
        PRIMARY KEY (booking_id, room_physical_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS booking_items (
        booking_item_id SERIAL PRIMARY KEY,
        booking_id INT NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
        room_id INT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
        quantity INT NOT NULL DEFAULT 1,
        adults INT DEFAULT 1,
        children INT DEFAULT 0
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS hotel_attractions (
        attraction_id SERIAL PRIMARY KEY,
        hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
        name VARCHAR(150) NOT NULL,
        description TEXT,
        distance_km NUMERIC(6,2),
        category VARCHAR(80),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    console.error("Failed to ensure columns:", e.message);
  }
})();

app.use(cors({
  origin: 'http://localhost:5173',
  credentials: true
}));

app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use(bodyParser.urlencoded({ extended: true }));

const uploadsDir = 'uploads/';
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

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
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (mimetype && extname) return cb(null, true);
    cb(new Error('Only image files (JPEG, PNG) and PDF files are allowed!'));
  }
});

const optionalLicenseUpload = (req, res, next) => {
  const ct = req.headers["content-type"] || "";
  if (ct.includes("multipart/form-data")) {
    return upload.single("license_file")(req, res, next);
  }
  return next();
};

app.get("/", (req, res) => {
  res.send("Welcome to the StayOS API");
});

// ==========================================
// CREATE BOOKING
// ==========================================
app.post("/api/bookings", optionalLicenseUpload, async (req, res) => {
  const { hotel_id, room_id, guest_name, guest_phone, guest_email, check_in, check_out, number_of_rooms = 1, adults = 2, children = 0, pay_on_arrival } = req.body;
  const roomsRequested = Math.max(1, parseInt(number_of_rooms, 10) || 1);

  if (!check_in || !check_out) return res.status(400).json({ message: "Check-in and check-out dates are required." });
  if (!hotel_id) return res.status(400).json({ message: "Hotel is required." });
  if (!guest_name || !guest_phone) return res.status(400).json({ message: "Guest name and phone are required." });

  const checkInDate = new Date(check_in);
  const checkOutDate = new Date(check_out);
  const isInvalidDate = (d) => Number.isNaN(d.getTime());

  if (isInvalidDate(checkInDate) || isInvalidDate(checkOutDate)) return res.status(400).json({ message: "Invalid date format. Use ISO YYYY-MM-DD." });
  if (checkOutDate <= checkInDate) return res.status(400).json({ message: "Check-out must be after check-in." });

  const checkInISO = checkInDate.toISOString().slice(0, 10);
  const checkOutISO = checkOutDate.toISOString().slice(0, 10);
  const licensePath = req.file ? req.file.path.replace(/\\/g, "/") : null;
  const bookingSource = (req.body.booking_source || "web").toLowerCase();
  const ua = (req.headers["user-agent"] || "").toLowerCase();
  const device = (req.body.device || (ua.includes("mobile") ? "mobile" : "desktop")).toLowerCase();

  try {
    await db.query("BEGIN");

    const roomCheck = await db.query(
      "SELECT total_rooms, room_type, capacity FROM rooms WHERE room_id = $1 AND hotel_id = $2 FOR UPDATE",
      [room_id, hotel_id]
    );

    if (roomCheck.rows.length === 0) {
      await db.query("ROLLBACK");
      return res.status(404).json({ message: "Room not found" });
    }

    const totalRooms = roomCheck.rows[0].total_rooms;
    const roomCapacity = roomCheck.rows[0].capacity || 0;

    // Ensure physical inventory exists for this room type
    const invCountRes = await db.query(
      `SELECT COUNT(*) AS cnt FROM room_inventory WHERE room_id = $1`,
      [room_id]
    );
    const invCount = parseInt(invCountRes.rows[0].cnt) || 0;
    if (invCount === 0) {
      const values = [];
      for (let i = 1; i <= totalRooms; i++) {
        values.push(`(${hotel_id}, ${room_id}, 'Room ${i}')`);
      }
      if (values.length) {
        await db.query(
          `INSERT INTO room_inventory (hotel_id, room_id, room_number) VALUES ${values.join(",")}`
        );
      }
    }

    const overlapCheck = await db.query(
      `SELECT COALESCE(MAX(daily_booked), 0) as booked_count
       FROM (
           SELECT d.stay_date, SUM(b.number_of_rooms) as daily_booked
           FROM generate_series($2::date, ($3::date - INTERVAL '1 day'), INTERVAL '1 day') AS d(stay_date)
           JOIN bookings b ON b.room_id = $1 
                          AND b.booking_status = 'confirmed' 
                          AND b.check_in_date <= d.stay_date 
                          AND b.check_out_date > d.stay_date
           GROUP BY d.stay_date
       ) subquery`,
      [room_id, checkInISO, checkOutISO]
    );

    const currentlyBooked = parseInt(overlapCheck.rows[0].booked_count) || 0;
    const actualAvailable = totalRooms - currentlyBooked;
    if (actualAvailable <= 0 || roomsRequested > actualAvailable) {
      await db.query("ROLLBACK");
      return res.status(400).json({ message: "Not enough rooms available for these dates." });
    }

    // Reserve specific physical rooms for this stay window
    const availableRoomsRes = await db.query(
      `SELECT ri.room_physical_id, ri.room_number
         FROM room_inventory ri
        WHERE ri.room_id = $1
          AND ri.status = 'available'
          AND NOT EXISTS (
            SELECT 1
              FROM booking_assigned_rooms bar
              JOIN bookings b ON b.booking_id = bar.booking_id
             WHERE bar.room_physical_id = ri.room_physical_id
               AND b.booking_status = 'confirmed'
               AND b.check_in_date < $3
               AND b.check_out_date > $2
          )
        ORDER BY ri.room_physical_id
        LIMIT $4
        FOR UPDATE SKIP LOCKED`,
      [room_id, checkInISO, checkOutISO, roomsRequested]
    );

    if (availableRoomsRes.rows.length < roomsRequested) {
      await db.query("ROLLBACK");
      return res.status(400).json({ message: "No specific rooms left for these dates." });
    }

    const payOnArrival = String(pay_on_arrival) === "true";
    const fakeTxnId = payOnArrival ? 'PAY_ON_ARRIVAL' : 'TXN-' + Math.random().toString(16).slice(2, 8).toUpperCase();
    const bookingRef = 'BK-' + Math.random().toString(36).substring(2, 8).toUpperCase();

    const bookingResult = await db.query(
      `INSERT INTO bookings
       (hotel_id, room_id, guest_name, guest_phone, guest_email, check_in_date, check_out_date, number_of_rooms, booking_status, payment_status, transaction_id, booking_ref, adults, children, license_file_path, booking_source, device)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING booking_ref, booking_id`,
      [hotel_id, room_id, guest_name, guest_phone, guest_email || null, checkInISO, checkOutISO, roomsRequested, payOnArrival ? 'pending' : 'paid', fakeTxnId, bookingRef, adults, children, licensePath, bookingSource, device]
    );

    // Link assigned rooms to booking
    const assignedRooms = availableRoomsRes.rows.slice(0, roomsRequested);
    for (const r of assignedRooms) {
      await db.query(
        `INSERT INTO booking_assigned_rooms (booking_id, room_physical_id, room_number) VALUES ($1, $2, $3)`,
        [bookingResult.rows[0].booking_id, r.room_physical_id, r.room_number]
      );
    }

    let emailSent = false;
    let emailError = null;
    const assignedRoomNumbers = assignedRooms.map(r => r.room_number);
    if (guest_email) {
      try {
        const hasHost = process.env.SMTP_HOST || process.env.SMTP_URL;
        if (hasHost) {
          const nodemailer = (await import("nodemailer")).default;
          const transporter = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT) || 587, secure: process.env.SMTP_SECURE === "true", auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
          await transporter.sendMail({
            from: process.env.SMTP_FROM || "no-reply@stayos.com",
            to: guest_email,
            subject: `Booking Confirmed - Ref ${bookingRef}`,
            text: `Thank you for your booking!\n\nReference: ${bookingRef}\nCheck-in: ${checkInISO}\nCheck-out: ${checkOutISO}\nRooms: ${assignedRoomNumbers.join(", ")}\nPayment: ${payOnArrival ? 'Pay on Arrival' : 'Paid'}\n\nWe look forward to hosting you.`,
          });
          emailSent = true;
        }
      } catch (emailErr) {
        emailError = emailErr.message;
      }
    }

    await db.query("COMMIT");
    const io = req.app.get("io");
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));

    io.to(`hotel_${hotel_id}`).emit("new_booking_alert", {
      guest_name: guest_name,
      room_type: roomCheck.rows[0].room_type,
      nights: nights,
      ref: bookingResult.rows[0].booking_ref,
      rooms: assignedRoomNumbers
    });

    res.json({ 
      message: "Booking confirmed successfully!",
      booking_ref: bookingResult.rows[0].booking_ref,
      rooms_assigned: assignedRoomNumbers,
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
  if (!booking_ref || !guest_phone) return res.status(400).json({ message: "Reference and Phone are required." });

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
    if (result.rows.length === 0) return res.status(404).json({ message: "No booking found with these details." });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error looking up booking." });
  }
});

app.post("/api/hotels/register", upload.single('license_file'), async (req, res) => {
  const { hotel_name, location, address, google_maps_url, contact_phone, contact_email, description, staff_name, staff_email, staff_password } = req.body;
  const licenseFile = req.file;

  if (!hotel_name || !location || !contact_phone || !contact_email || !staff_name || !staff_email || !staff_password) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  const slug = `${hotel_name}-${location}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  try {
    const existingHotel = await db.query("SELECT hotel_id FROM hotels WHERE slug = $1", [slug]);
    if (existingHotel.rows.length > 0) return res.status(409).json({ message: "Hotel already registered" });

    await db.query("BEGIN");
    const hotelResult = await db.query(
      `INSERT INTO hotels
       (hotel_name, location, address, google_maps_url, contact_phone, contact_email, description, slug, license_file_path, is_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
       RETURNING hotel_id`,
      [hotel_name, location, address, google_maps_url, contact_phone, contact_email, description, slug, licenseFile ? licenseFile.path : null]
    );

    const hotel_id = hotelResult.rows[0].hotel_id;
    await db.query(
      `INSERT INTO staff_users (hotel_id, name, email, password_hash, role) VALUES ($1,$2,$3,$4,'admin')`,
      [hotel_id, staff_name, staff_email, staff_password]
    );
    await db.query("COMMIT");

    res.status(201).json({
      message: "Hotel and staff account created successfully",
      hotel_id,
      staff_login: "/staff-login",
      hotel_page: `/hotel/${slug}`
    });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/hotels/search", async (req, res) => {
  const searchQuery = (req.query.q || "").trim();
  const location = (req.query.location || "").trim();
  const minPrice = req.query.min_price ? Number(req.query.min_price) : null;
  const maxPrice = req.query.max_price ? Number(req.query.max_price) : null;

  if (!searchQuery && !location) return res.status(400).json({ message: "Provide a search term or location" });

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

    // Price filters (based on room price_per_night)
    if (Number.isFinite(minPrice) && Number.isFinite(maxPrice)) {
      params.push(minPrice, maxPrice);
      conditions.push(
        `EXISTS (SELECT 1 FROM rooms r WHERE r.hotel_id = h.hotel_id AND r.price_per_night BETWEEN $${params.length-1} AND $${params.length})`
      );
    } else if (Number.isFinite(minPrice)) {
      params.push(minPrice);
      conditions.push(
        `EXISTS (SELECT 1 FROM rooms r WHERE r.hotel_id = h.hotel_id AND r.price_per_night >= $${params.length})`
      );
    } else if (Number.isFinite(maxPrice)) {
      params.push(maxPrice);
      conditions.push(
        `EXISTS (SELECT 1 FROM rooms r WHERE r.hotel_id = h.hotel_id AND r.price_per_night <= $${params.length})`
      );
    }

    conditions.push("h.is_verified = true");
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT h.hotel_id, h.hotel_name, h.location, h.slug,
              COALESCE((SELECT ROUND(AVG(r.rating)::numeric, 2) FROM hotel_ratings r WHERE r.hotel_id = h.hotel_id), 0) AS avg_rating,
              COALESCE((SELECT COUNT(*) FROM hotel_ratings r WHERE r.hotel_id = h.hotel_id), 0) AS rating_count,
              COALESCE((SELECT MIN(r.price_per_night) FROM rooms r WHERE r.hotel_id = h.hotel_id), 0) AS min_price,
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
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

app.get("/api/hotels/locations", async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT DISTINCT ON (LOWER(TRIM(location))) TRIM(location) AS location, LOWER(TRIM(location)) AS normalized_location
       FROM hotels WHERE is_verified = true ORDER BY LOWER(TRIM(location)), TRIM(location)`
    );
    res.json({ locations: result.rows.map(r => r.location) });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/hotels/:slug", async (req, res) => {
  const { slug } = req.params;
  const { date } = req.query; 
  const checkInQuery = req.query.check_in;
  const checkOutQuery = req.query.check_out;
  const hasDates = !!(checkInQuery && checkOutQuery);

  const checkInISO = checkInQuery ? new Date(checkInQuery).toISOString().slice(0,10) : new Date().toISOString().slice(0,10);
  const defaultCheckout = new Date(checkInISO);
  defaultCheckout.setDate(defaultCheckout.getDate() + 1);
  const checkOutISO = checkOutQuery ? new Date(checkOutQuery).toISOString().slice(0,10) : defaultCheckout.toISOString().slice(0,10);

  try {
    const hotelResult = await db.query(
      `SELECT hotel_id, hotel_name, location, address, description, google_maps_url, contact_phone, contact_email,
         COALESCE((SELECT ROUND(AVG(rating)::numeric, 2) FROM hotel_ratings WHERE hotel_id = hotels.hotel_id), 0) AS avg_rating,
         COALESCE((SELECT COUNT(*) FROM hotel_ratings WHERE hotel_id = hotels.hotel_id), 0) AS rating_count
       FROM hotels WHERE slug = $1`,
      [slug]
    );

    if (hotelResult.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });
    const hotel = hotelResult.rows[0];

    const extraFields = `
          r.description,
          r.capacity,
          r.total_rooms,
          CASE 
            WHEN NOT $5 THEN r.total_rooms
            ELSE (r.total_rooms - COALESCE(
              (SELECT MAX(daily_booked) FROM (
                  SELECT d.stay_date, SUM(b.number_of_rooms) as daily_booked
                  FROM generate_series($2::date, ($3::date - INTERVAL '1 day'), INTERVAL '1 day') AS d(stay_date)
                  JOIN bookings b ON b.room_id = r.room_id 
                                 AND b.booking_status = 'confirmed'
                                 AND b.check_in_date <= d.stay_date
                                 AND b.check_out_date > d.stay_date
                  GROUP BY d.stay_date
              ) max_calc), 0)
            ) 
          END AS available_rooms,
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
    const roomsResult = await db.query(
      `SELECT r.room_id, r.room_type, ${extraFields}, COALESCE(o.custom_price, r.price_per_night) AS price_per_night
       FROM rooms r
       LEFT JOIN room_price_overrides o ON r.room_id = o.room_id AND o.target_date = $4
       WHERE r.hotel_id = $1`,
      [hotel.hotel_id, checkInISO, checkOutISO, overrideDate, hasDates]
    );

    const ratings = await db.query(
      `SELECT rating_id, guest_name, rating, comment, created_at FROM hotel_ratings WHERE hotel_id = $1 ORDER BY created_at DESC LIMIT 10`,
      [hotel.hotel_id]
    );

    res.json({ hotel: hotel, rooms: roomsResult.rows, ratings: ratings.rows });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ==========================================
// STAFF: Availability by date range
// ==========================================
app.get("/api/staff/availability", verifyToken, async (req, res) => {
  const hotel_id = req.user.hotel_id;
  const { check_in, check_out } = req.query;
  if (!hotel_id) return res.status(400).json({ message: "Hotel ID missing" });

  // Default to today -> tomorrow if not provided
  const checkInDate = check_in ? new Date(check_in) : new Date();
  const checkOutDate = check_out ? new Date(check_out) : new Date(new Date().setDate(new Date().getDate() + 1));
  const isInvalidDate = (d) => Number.isNaN(d.getTime());
  if (isInvalidDate(checkInDate) || isInvalidDate(checkOutDate)) {
    return res.status(400).json({ message: "Invalid date format. Use YYYY-MM-DD." });
  }
  if (checkOutDate <= checkInDate) {
    return res.status(400).json({ message: "Check-out must be after check-in." });
  }
  const checkInISO = checkInDate.toISOString().slice(0, 10);
  const checkOutISO = checkOutDate.toISOString().slice(0, 10);

  try {
    const roomsResult = await db.query(
      `SELECT r.room_id, r.room_type, r.total_rooms, r.price_per_night,
              (r.total_rooms - COALESCE(
                (SELECT MAX(daily_booked) FROM (
                    SELECT d.stay_date, SUM(b.number_of_rooms) as daily_booked
                    FROM generate_series($2::date, ($3::date - INTERVAL '1 day'), INTERVAL '1 day') AS d(stay_date)
                    JOIN bookings b ON b.room_id = r.room_id 
                                   AND b.booking_status = 'confirmed'
                                   AND b.check_in_date <= d.stay_date
                                   AND b.check_out_date > d.stay_date
                    GROUP BY d.stay_date
                ) max_calc), 0)
              ) AS available_rooms
         FROM rooms r
        WHERE r.hotel_id = $1
        ORDER BY r.room_type`,
      [hotel_id, checkInISO, checkOutISO]
    );

    const totalAvailable = roomsResult.rows.reduce((sum, r) => sum + (parseInt(r.available_rooms) || 0), 0);
    res.json({
      hotel_id,
      check_in: checkInISO,
      check_out: checkOutISO,
      total_available: totalAvailable,
      rooms: roomsResult.rows
    });
  } catch (err) {
    console.error("Availability fetch failed:", err.message);
    res.status(500).json({ message: "Failed to fetch availability" });
  }
});

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
    const exists = await db.query("SELECT 1 FROM hotels WHERE hotel_id = $1", [hotel_id]);
    if (exists.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });

    await db.query(
      `INSERT INTO hotel_ratings (hotel_id, guest_name, rating, comment) VALUES ($1, $2, $3, $4)`,
      [hotel_id, name, parsedRating, safeComment]
    );

    const summary = await db.query(
      `SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count FROM hotel_ratings WHERE hotel_id = $1`,
      [hotel_id]
    );

    res.status(201).json({
      message: "Thanks for your feedback!",
      avg_rating: parseFloat(summary.rows[0].avg_rating) || 0,
      rating_count: parseInt(summary.rows[0].rating_count) || 0
    });
  } catch (err) {
    res.status(500).json({ message: "Server error submitting rating" });
  }
});

app.get("/api/hotels/:hotel_id/ratings", async (req, res) => {
  const { hotel_id } = req.params;
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

  try {
    const summary = await db.query(
      `SELECT ROUND(AVG(rating)::numeric, 2) AS avg_rating, COUNT(*) AS rating_count FROM hotel_ratings WHERE hotel_id = $1`,
      [hotel_id]
    );
    const ratings = await db.query(
      `SELECT rating_id, guest_name, rating, comment, created_at FROM hotel_ratings WHERE hotel_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [hotel_id, limit]
    );

    res.json({
      avg_rating: parseFloat(summary.rows[0].avg_rating) || 0,
      rating_count: parseInt(summary.rows[0].rating_count) || 0,
      ratings: ratings.rows
    });
  } catch (err) {
    res.status(500).json({ message: "Server error fetching ratings" });
  }
});

app.post("/api/staff/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Email and password are required" });

  try {
    const result = await db.query(`SELECT staff_id, hotel_id, name, password_hash, role FROM staff_users WHERE email = $1`, [email]);
    if (result.rows.length === 0) return res.status(401).json({ message: "Invalid credentials" });

    const staff = result.rows[0];
    if (password !== staff.password_hash) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ staff_id: staff.staff_id, hotel_id: staff.hotel_id, role: staff.role }, process.env.JWT_SECRET, { expiresIn: "1d" });
    res.json({ message: "Login successful", token });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/staff/hotel", verifyToken, async (req, res) => {
  const hotelId = req.user?.hotel_id;
  if (!hotelId) return res.status(403).json({ message: "Unauthorized" });

  try {
    const result = await db.query(
      `SELECT hotel_id, hotel_name, location, address, google_maps_url, contact_phone, contact_email, description, slug, is_verified
       FROM hotels WHERE hotel_id = $1`,
      [hotelId]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ==========================================
// STAFF: Daily operations summary (revenue, bookings, occupancy, low inventory)
// ==========================================
app.get("/api/staff/daily-summary", verifyToken, async (req, res) => {
  const hotelId = req.user?.hotel_id;
  if (!hotelId) return res.status(403).json({ message: "Unauthorized" });

  const day = req.query.date ? new Date(req.query.date) : new Date();
  if (Number.isNaN(day.getTime())) return res.status(400).json({ message: "Invalid date. Use YYYY-MM-DD." });

  // Normalize to start of day UTC to keep boundaries consistent
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const startISO = start.toISOString().slice(0, 10);
  const endISO = end.toISOString().slice(0, 10);

  try {
    const revenue = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN b.payment_status = 'paid'
           THEN r.price_per_night * b.number_of_rooms * GREATEST(1, (b.check_out_date - b.check_in_date)) END), 0) AS revenue_paid,
         COALESCE(SUM(CASE WHEN b.payment_status <> 'paid'
           THEN r.price_per_night * b.number_of_rooms * GREATEST(1, (b.check_out_date - b.check_in_date)) END), 0) AS revenue_poa,
         COUNT(*) FILTER (WHERE b.booking_status = 'confirmed') AS bookings_new,
         COUNT(*) FILTER (WHERE b.booking_status = 'cancelled') AS bookings_cancelled
       FROM bookings b
       JOIN rooms r ON r.room_id = b.room_id
       WHERE b.hotel_id = $1
         AND b.created_at >= $2::date
         AND b.created_at < $3::date`,
      [hotelId, startISO, endISO]
    );

    const occupancy = await db.query(
      `WITH totals AS (
         SELECT COALESCE(SUM(total_rooms), 0) AS total_rooms
           FROM rooms
          WHERE hotel_id = $1
       ), occ AS (
         SELECT COUNT(*) AS occupied
           FROM bookings
          WHERE hotel_id = $1
            AND booking_status = 'confirmed'
            AND check_in_date <= $2::date
            AND check_out_date > $2::date
       )
       SELECT totals.total_rooms, occ.occupied
         FROM totals, occ`,
      [hotelId, startISO]
    );

    const lowInventory = await db.query(
      `SELECT r.room_id, r.room_type, r.total_rooms,
              (r.total_rooms - COALESCE(b.booked, 0)) AS available
         FROM rooms r
         LEFT JOIN (
           SELECT room_id, COUNT(*) AS booked
             FROM bookings
            WHERE hotel_id = $1
              AND booking_status = 'confirmed'
              AND check_in_date <= $2::date
              AND check_out_date > $2::date
            GROUP BY room_id
         ) b ON b.room_id = r.room_id
        WHERE r.hotel_id = $1
        ORDER BY available ASC
        LIMIT 5`,
      [hotelId, startISO]
    );

    const totalRooms = parseInt(occupancy.rows[0]?.total_rooms || 0, 10);
    const occupiedRooms = parseInt(occupancy.rows[0]?.occupied || 0, 10);
    const availableRooms = totalRooms - occupiedRooms;
    const occupancyPct = totalRooms > 0 ? Number(((occupiedRooms / totalRooms) * 100).toFixed(1)) : 0;

    res.json({
      date: startISO,
      totals: {
        revenue_paid: Number(revenue.rows[0]?.revenue_paid || 0),
        revenue_pay_on_arrival: Number(revenue.rows[0]?.revenue_poa || 0),
        bookings_new: Number(revenue.rows[0]?.bookings_new || 0),
        bookings_cancelled: Number(revenue.rows[0]?.bookings_cancelled || 0),
        occupancy_pct: occupancyPct
      },
      rooms: {
        occupied: occupiedRooms,
        available: availableRooms,
        total: totalRooms
      },
      alerts: {
        low_inventory: lowInventory.rows
      }
    });
  } catch (err) {
    console.error("Daily summary failed:", err.message);
    res.status(500).json({ message: "Failed to build summary" });
  }
});

app.put("/api/staff/hotel", verifyToken, async (req, res) => {
  const hotelId = req.user?.hotel_id;
  if (!hotelId) return res.status(403).json({ message: "Unauthorized" });

  const { hotel_name, location, address, google_maps_url, contact_phone, contact_email, description } = req.body;

  try {
    const current = await db.query(`SELECT * FROM hotels WHERE hotel_id = $1`, [hotelId]);
    if (current.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });
    const existing = current.rows[0];

    const finalName = hotel_name ?? existing.hotel_name;
    const finalLoc = location ?? existing.location;
    const newSlug = `${finalName}-${finalLoc}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");

    const result = await db.query(
      `UPDATE hotels
       SET hotel_name = $1, location = $2, address = $3, google_maps_url = $4, contact_phone = $5, contact_email = $6, description = $7, slug = $8
       WHERE hotel_id = $9
       RETURNING hotel_id, hotel_name, location, address, google_maps_url, contact_phone, contact_email, description, slug, is_verified`,
      [finalName, finalLoc, address ?? existing.address, google_maps_url ?? existing.google_maps_url, contact_phone ?? existing.contact_phone, contact_email ?? existing.contact_email, description ?? existing.description, newSlug, hotelId]
    );

    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ message: "Server error updating hotel" });
  }
});

// ==========================================
// STAFF: Auto-cancel unpaid arrivals up to today
// ==========================================
app.post("/api/staff/cancel-unpaid-arrivals", verifyToken, async (req, res) => {
  const hotelId = req.user?.hotel_id;
  if (!hotelId) return res.status(403).json({ message: "Unauthorized" });

  const todayIso = new Date().toISOString().slice(0,10);
  try {
    const result = await db.query(
      `UPDATE bookings
          SET booking_status = 'cancelled'
        WHERE hotel_id = $1
          AND booking_status IN ('confirmed','pending')
          AND payment_status != 'paid'
          AND check_in_date <= $2
        RETURNING booking_id, booking_ref`,
      [hotelId, todayIso]
    );

    res.json({
      message: `Cancelled ${result.rowCount} unpaid arrival(s) through ${todayIso}`,
      cancelled: result.rows
    });
  } catch (err) {
    console.error("Auto cancel failed:", err.message);
    res.status(500).json({ message: "Failed to cancel unpaid arrivals" });
  }
});

app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
  
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPass) return res.status(500).json({ message: "Admin credentials not configured" });
  
  if (email !== adminEmail || password !== adminPass) return res.status(401).json({ message: "Invalid admin credentials" });
  
  const token = jwt.sign({ role: "superadmin", email }, process.env.JWT_SECRET, { expiresIn: "2d" });
  res.json({ token });
});

// ==========================================
// GET ROOMS
// ==========================================
app.get("/api/rooms", verifyToken, async (req, res) => {
  const hotel_id = req.user.hotel_id;
  if (!hotel_id) return res.status(400).json({ message: "hotel_id is required" });

  try {
    const result = await db.query(
      `SELECT 
         r.room_id, r.room_type, r.price_per_night, r.total_rooms, r.description, r.capacity,
         r.total_rooms AS available_rooms,
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
    res.status(500).json({ message: "Server error" });
  }
});

// ==========================================
// CREATE A NEW ROOM
// ==========================================
app.post("/api/rooms", verifyToken, upload.array('room_images', 5), async (req, res) => {
  const hotel_id = req.user.hotel_id;
  const { room_type, price_per_night, total_rooms, description, capacity, amenities } = req.body;

  if (!hotel_id || !room_type || !price_per_night || !total_rooms) {
    return res.status(400).json({ message: "Required fields missing" });
  }

  try {
    await db.query("BEGIN"); 
    
    // 🚨 Removed available_rooms insertion here to normalize database
    const roomResult = await db.query(
      `INSERT INTO rooms (hotel_id, room_type, price_per_night, total_rooms, description, capacity)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING room_id`,
      [hotel_id, room_type, price_per_night, total_rooms, description, capacity || 2]
    );
    
    const newRoomId = roomResult.rows[0].room_id;

    if (req.files && req.files.length > 0) {
      for (let i = 0; i < req.files.length; i++) {
        const filePath = req.files[i].path.replace(/\\/g, '/');
        await db.query(
          `INSERT INTO room_pictures (room_id, picture_url, display_order) VALUES ($1, $2, $3)`,
          [newRoomId, filePath, i + 1] 
        );
      }
    }

    if (amenities && Array.isArray(amenities)) {
      for (const amenity of amenities) {
        await db.query(`INSERT INTO room_amenities (room_id, amenity_name) VALUES ($1, $2)`, [newRoomId, amenity]);
      }
    } else if (amenities && typeof amenities === 'string') {
       await db.query(`INSERT INTO room_amenities (room_id, amenity_name) VALUES ($1, $2)`, [newRoomId, amenities]);
    }

    await db.query("COMMIT");
    res.status(201).json({ message: "Room added successfully!", room_id: newRoomId });

  } catch (err) {
    await db.query("ROLLBACK"); 
    res.status(500).json({ error: "Failed to save room details" });
  }
});

app.post("/api/rooms/:room_id/pictures", verifyToken, upload.single('picture'), async (req, res) => {
  const { room_id } = req.params;
  const caption = req.body.caption || "Room picture";
  if (!req.file) return res.status(400).json({ message: "No image uploaded" });

  try {
    const cleanPath = req.file.path.replace(/\\/g, '/');
    const orderResult = await db.query("SELECT COALESCE(MAX(display_order), 0) + 1 as next_order FROM room_pictures WHERE room_id = $1", [room_id]);
    await db.query(
      `INSERT INTO room_pictures (room_id, picture_url, caption, display_order) VALUES ($1, $2, $3, $4)`,
      [room_id, cleanPath, caption, orderResult.rows[0].next_order]
    );
    res.status(201).json({ message: "Picture added successfully" });
  } catch (err) {
    res.status(500).json({ message: "Failed to upload picture" });
  }
});

app.delete("/api/rooms/:room_id", verifyToken, async (req, res) => {
  const { room_id } = req.params;
  try {
    await db.query("BEGIN");
    await db.query("DELETE FROM room_pictures WHERE room_id = $1", [room_id]);
    await db.query("DELETE FROM room_amenities WHERE room_id = $1", [room_id]);
    await db.query("DELETE FROM rooms WHERE room_id = $1", [room_id]);
    await db.query("COMMIT");
    res.json({ message: "Room deleted successfully" });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ message: "Failed to delete room" });
  }
});

app.put("/api/rooms/:room_id", verifyToken, upload.array('room_images', 5), async (req, res) => {
  const { room_id } = req.params;
  const { room_type, description, capacity, price_per_night, total_rooms, amenities, replace_images } = req.body;

  try {
    await db.query("BEGIN");
    await db.query(
      `UPDATE rooms 
       SET room_type = $1, description = $2, capacity = $3, price_per_night = $4, total_rooms = $5
       WHERE room_id = $6`,
      [room_type, description, capacity, price_per_night, total_rooms, room_id]
    );

    if (amenities) {
      await db.query("DELETE FROM room_amenities WHERE room_id = $1", [room_id]);
      const amenityArray = Array.isArray(amenities) ? amenities : [amenities];
      for (const amenity of amenityArray) {
        await db.query("INSERT INTO room_amenities (room_id, amenity_name) VALUES ($1, $2)", [room_id, amenity]);
      }
    }

    if (replace_images === 'true' && req.files && req.files.length > 0) {
      await db.query("DELETE FROM room_pictures WHERE room_id = $1", [room_id]);
      for (let i = 0; i < req.files.length; i++) {
        const filePath = req.files[i].path.replace(/\\/g, '/');
        await db.query(
          `INSERT INTO room_pictures (room_id, picture_url, display_order) VALUES ($1, $2, $3)`,
          [room_id, filePath, i + 1]
        );
      }
    }

    await db.query("COMMIT");
    res.json({ message: "Room updated successfully" });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ message: "Failed to update room" });
  }
});

app.get("/api/staff/bookings", verifyToken , async (req, res) => {
  const hotel_id = req.user.hotel_id;
  const { date_from, date_to } = req.query;

  if (!hotel_id) return res.status(400).json({ message: "hotel_id is required" });

  try {
    const normFrom = date_from ? date_from.trim() : null;
    const normTo = date_to ? date_to.trim() : null;
    
    const conditions = ["b.hotel_id = $1"];
    const params = [hotel_id];
    
    if (normFrom && normTo) {
      params.push(normFrom); params.push(normTo);
      conditions.push(`b.check_in_date BETWEEN $${params.length-1} AND $${params.length}`);
    } else if (normFrom) {
      params.push(normFrom); conditions.push(`b.check_in_date >= $${params.length}`);
    } else if (normTo) {
      params.push(normTo); conditions.push(`b.check_in_date <= $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT b.booking_id, b.guest_name, b.guest_phone,
              b.check_in_date, b.check_out_date, b.booking_status,
              b.payment_status, b.booking_ref, b.transaction_id,
              b.license_file_path, b.booking_source, b.device,
              b.number_of_rooms,
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
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/staff/bookings/:booking_id/mark-paid", verifyToken, async (req, res) => {
  const { booking_id } = req.params;
  const hotel_id = req.user.hotel_id;
  try {
    const result = await db.query(
      `UPDATE bookings
         SET payment_status = 'paid',
             booking_status = CASE WHEN booking_status = 'pending' THEN 'confirmed' ELSE booking_status END,
             transaction_id = COALESCE(transaction_id, 'PAY_ON_ARRIVAL_' || booking_id)
       WHERE booking_id = $1::int AND hotel_id = $2::int
       RETURNING booking_id, booking_status, payment_status, transaction_id`,
      [booking_id, hotel_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ message: "Booking not found" });
    res.json({ message: "Payment marked as paid", booking: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: "Failed to update payment status" });
  }
});

app.get("/api/admin/hotels/pending", verifyAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT hotel_id, hotel_name, location, contact_email, contact_phone, license_file_path, is_verified
       FROM hotels WHERE is_verified = false ORDER BY hotel_id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/admin/hotels/verified", verifyAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT hotel_id, hotel_name, location, contact_email, contact_phone, is_verified
         FROM hotels WHERE is_verified = true ORDER BY hotel_id DESC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/admin/hotels/:hotel_id/verify", verifyAdmin, async (req, res) => {
  const { hotel_id } = req.params;
  try {
    const hotelResult = await db.query("SELECT hotel_name, contact_email FROM hotels WHERE hotel_id = $1", [hotel_id]);
    if (hotelResult.rowCount === 0) return res.status(404).json({ message: "Hotel not found" });

    const staffResult = await db.query("SELECT email, password_hash FROM staff_users WHERE hotel_id = $1 AND role = 'admin' ORDER BY staff_id LIMIT 1", [hotel_id]);
    const updateResult = await db.query("UPDATE hotels SET is_verified = true WHERE hotel_id = $1 RETURNING hotel_id", [hotel_id]);

    const adminEmail = staffResult.rows[0]?.email || hotelResult.rows[0]?.contact_email;
    const adminPassword = staffResult.rows[0]?.password_hash;
    const { sent, error } = await sendPlatformEmail(
      adminEmail,
      "Your hotel has been verified",
      `Hi,\n\nYour hotel \"${hotelResult.rows[0].hotel_name}\" is now verified and live on the platform.\n\nLogin URL: http://localhost:5173/staff-login\nEmail: ${adminEmail || "N/A"}\n${adminPassword ? `Password: ${adminPassword}\n` : ""}\nPlease log in to manage your property.\n\nThanks,\nPlatform Team`
    );
    res.json({ message: "Hotel verified", email_sent: sent, email_error: error });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.delete("/api/admin/hotels/:hotel_id", verifyAdmin, async (req, res) => {
  const { hotel_id } = req.params;
  try {
    const hotelMeta = await db.query("SELECT hotel_name, contact_email FROM hotels WHERE hotel_id = $1", [hotel_id]);
    if (hotelMeta.rowCount === 0) return res.status(404).json({ message: "Hotel not found" });

    const staffMeta = await db.query("SELECT email FROM staff_users WHERE hotel_id = $1 AND role = 'admin' ORDER BY staff_id LIMIT 1", [hotel_id]);

    await db.query("BEGIN");
    await db.query("DELETE FROM booking_assigned_rooms WHERE booking_id IN (SELECT booking_id FROM bookings WHERE hotel_id = $1)", [hotel_id]);
    await db.query("DELETE FROM bookings WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM room_pictures WHERE room_id IN (SELECT room_id FROM rooms WHERE hotel_id = $1)", [hotel_id]);
    await db.query("DELETE FROM room_amenities WHERE room_id IN (SELECT room_id FROM rooms WHERE hotel_id = $1)", [hotel_id]);
    await db.query("DELETE FROM room_price_overrides WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM pricing_history WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM hotel_pictures WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM hotel_amenities WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM hotel_ratings WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM guest_queries WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM analytics_summary WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM room_inventory WHERE room_id IN (SELECT room_id FROM rooms WHERE hotel_id = $1)", [hotel_id]).catch(() => {});
    await db.query("DELETE FROM rooms WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM staff_users WHERE hotel_id = $1", [hotel_id]);
    await db.query("DELETE FROM hotels WHERE hotel_id = $1", [hotel_id]);
    await db.query("COMMIT");

    const recipient = staffMeta.rows[0]?.email || hotelMeta.rows[0]?.contact_email;
    const { sent, error } = await sendPlatformEmail(
      recipient,
      "Hotel removed from platform",
      `Hi,\n\nYour hotel \"${hotelMeta.rows[0].hotel_name}\" has been removed from the platform by an administrator.\n\nThanks,\nPlatform Team`
    );
    res.json({ message: "Hotel removed", email_sent: sent, email_error: error });
  } catch (err) {
    await db.query("ROLLBACK");
    res.status(500).json({ message: "Server error removing hotel" });
  }
});

// ==========================================
// STAFF ANALYTICS
// ==========================================
app.get("/api/staff/analytics", verifyToken, async (req, res) => {
  const hotel_id = req.user.hotel_id;
  const period = parseInt(req.query.period) || 30;
  const startParam = req.query.start_date ? new Date(req.query.start_date) : null;
  const endParam = req.query.end_date ? new Date(req.query.end_date) : null;
  const singleDateParam = req.query.date ? new Date(req.query.date) : null;

  try {
    const hotelMeta = await db.query("SELECT hotel_name FROM hotels WHERE hotel_id = $1", [hotel_id]);
    const hotelName = hotelMeta.rows[0]?.hotel_name || null;

    const today = new Date();
    let endDateBase;
    let startDate;

    if (singleDateParam && !Number.isNaN(singleDateParam)) {
      // single-day shortcut: date = YYYY-MM-DD
      const d = new Date(singleDateParam);
      d.setHours(0,0,0,0);
      endDateBase = new Date(d);
      endDateBase.setDate(endDateBase.getDate() + 1); // exclusive end = next day
      startDate = new Date(d);
    } else {
      endDateBase = endParam && !Number.isNaN(endParam) ? endParam : today;
      endDateBase.setHours(0,0,0,0);
      startDate = startParam && !Number.isNaN(startParam) ? new Date(startParam) : new Date(endDateBase);
      startDate.setHours(0,0,0,0);
      if (!(startParam && !Number.isNaN(startParam))) {
        startDate.setDate(startDate.getDate() - period);
      }
    }
    
    const previousStartDate = new Date(startDate);
    previousStartDate.setDate(previousStartDate.getDate() - period);

    const endDateExclusive = new Date(endDateBase);
    if (!(singleDateParam && !Number.isNaN(singleDateParam))) {
      // range/period path: we already moved endDateBase to next day inside single-date branch
      endDateExclusive.setDate(endDateExclusive.getDate() + 1);
    }

    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateExclusiveStr = endDateExclusive.toISOString().slice(0, 10);
    const previousStartDateStr = previousStartDate.toISOString().slice(0, 10);

    const coreMetrics = await db.query(
      `WITH stay_dates AS (
         SELECT b.booking_id, b.booking_status, b.payment_status,
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
    const roomNights = parseInt(data.room_nights) || 0;
    const bookingNights = parseInt(data.booking_nights) || 0;
    const confirmedCount = parseInt(data.confirmed_bookings) || 0;

    const cancelledResult = await db.query(
      `SELECT COUNT(DISTINCT b.booking_id) AS cancelled
         FROM bookings b
         CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
        WHERE b.hotel_id = $1
          AND b.booking_status = 'cancelled'
          AND stay_date >= $2 AND stay_date < $3`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );
    const cancelledCount = parseInt(cancelledResult.rows[0].cancelled) || 0;
    const totalBookings = confirmedCount + cancelledCount;

    const totalRoomsResult = await db.query(
      `SELECT COALESCE(SUM(total_rooms), 1) as total_capacity FROM rooms WHERE hotel_id = $1`,
      [hotel_id]
    );
    const totalCapacity = parseInt(totalRoomsResult.rows[0].total_capacity) || 1;
    const daysInRange = Math.max(1, Math.round((endDateExclusive - startDate) / (1000 * 60 * 60 * 24)));
    const totalAvailableNights = totalCapacity * daysInRange;

    const occupancyRate = totalAvailableNights > 0 ? ((roomNights / totalAvailableNights) * 100).toFixed(1) : 0;
    const revpar = totalAvailableNights > 0 ? Math.round(totalRevenue / totalAvailableNights) : 0;
    const adr = roomNights > 0 ? Math.round(totalRevenue / roomNights) : 0;
    const alos = confirmedCount > 0 ? (bookingNights / confirmedCount).toFixed(1) : 0;
    const cancellationRate = totalBookings > 0 ? ((cancelledCount / totalBookings) * 100).toFixed(1) : 0;

    const guestMetrics = await db.query(
      `SELECT COUNT(DISTINCT guest_phone) as unique_guests FROM bookings 
       WHERE hotel_id = $1 AND booking_status = 'confirmed' AND check_in_date < $3 AND check_out_date > $2`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );
    const uniqueGuests = parseInt(guestMetrics.rows[0].unique_guests) || 0;
    const repeatGuestRate = confirmedCount > 0 ? (((confirmedCount - uniqueGuests) / confirmedCount) * 100).toFixed(1) : 0;

    const revenueByRoom = await db.query(
      `SELECT r.room_type, COUNT(DISTINCT b.booking_id) as bookings,
        COALESCE(SUM(r.price_per_night * COALESCE(b.number_of_rooms, 1)), 0) as revenue
       FROM bookings b
       JOIN rooms r ON b.room_id = r.room_id
       CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
       WHERE b.hotel_id = $1 AND b.booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3
       GROUP BY r.room_type ORDER BY revenue DESC`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const peakDays = await db.query(
      `SELECT TRIM(TO_CHAR(stay_date, 'Day')) as day_of_week, COUNT(*) as bookings
       FROM bookings b
       CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
       WHERE b.hotel_id = $1 AND b.booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3
       GROUP BY TRIM(TO_CHAR(stay_date, 'Day')) ORDER BY bookings DESC`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );
    const peakMap = {};
    peakDays.rows.forEach(r => { peakMap[r.day_of_week.trim()] = parseInt(r.bookings) || 0; });
    const weekLabels = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
    const peakDaysFull = weekLabels.map(d => ({ day_of_week: d, bookings: peakMap[d] || 0 }));

    const revenueTrend = await db.query(
      `SELECT TO_CHAR(stay_date, 'Mon DD') as date, stay_date::date as stay_key,
         COALESCE(SUM(r.price_per_night * COALESCE(b.number_of_rooms, 1)), 0) as daily_revenue,
         COALESCE(SUM(COALESCE(b.number_of_rooms,1)),0) as occupied_rooms
       FROM bookings b JOIN rooms r ON b.room_id = r.room_id
       CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
       WHERE b.hotel_id = $1 AND b.booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3
       GROUP BY stay_date ORDER BY stay_date ASC`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const prevMetrics = await db.query(
      `WITH stay_dates AS (
         SELECT r.price_per_night, COALESCE(b.number_of_rooms, 1) AS rooms,
                generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
         FROM bookings b JOIN rooms r ON b.room_id = r.room_id
         WHERE b.hotel_id = $1 AND b.booking_status = 'confirmed'
       )
       SELECT COALESCE(SUM(CASE WHEN stay_date >= $2 AND stay_date < $3 THEN price_per_night * rooms END), 0) as prev_revenue
       FROM stay_dates`,
      [hotel_id, previousStartDateStr, startDateStr]
    );
    const prevRevenue = parseInt(prevMetrics.rows[0].prev_revenue) || 0;
    const revenueChange = prevRevenue > 0 ? (((totalRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1) : (totalRevenue > 0 ? 100 : 0);

    const pm = await db.query(
      `SELECT payment_status, COUNT(DISTINCT b.booking_id) AS count
         FROM bookings b
         CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
        WHERE b.hotel_id = $1
          AND b.booking_status = 'confirmed'
          AND stay_date >= $2 AND stay_date < $3
        GROUP BY payment_status`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );
    const paymentMixMap = pm.rows.reduce((acc, row) => { acc[row.payment_status || "unknown"] = parseInt(row.count) || 0; return acc; }, {});

    const tr = await db.query(
      `WITH stay_rev AS (
           SELECT r.room_type, COALESCE(SUM(r.price_per_night * COALESCE(b.number_of_rooms,1)),0) AS revenue, COUNT(DISTINCT b.booking_id) AS bookings
             FROM bookings b JOIN rooms r ON b.room_id = r.room_id
             CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
            WHERE b.hotel_id = $1 AND b.booking_status = 'confirmed' AND stay_date >= $2 AND stay_date < $3
            GROUP BY r.room_type
         ), cancels AS (
           SELECT r.room_type, COUNT(*) AS cancels FROM bookings b JOIN rooms r ON b.room_id = r.room_id
         WHERE b.hotel_id = $1 AND b.booking_status = 'cancelled' AND b.created_at >= $2 AND b.created_at < $3
          GROUP BY r.room_type
       )
        SELECT sr.room_type, sr.revenue, sr.bookings, COALESCE(c.cancels,0) AS cancels
          FROM stay_rev sr LEFT JOIN cancels c ON c.room_type = sr.room_type
          ORDER BY sr.revenue DESC, sr.bookings DESC LIMIT 5`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const lt = await db.query(
      `SELECT bucket, COUNT(*) AS count FROM (
           SELECT CASE WHEN lt <= 1 THEN '0-1' WHEN lt <= 3 THEN '2-3' WHEN lt <= 7 THEN '4-7' WHEN lt <= 14 THEN '8-14' WHEN lt <= 30 THEN '15-30' ELSE '30+' END AS bucket
           FROM ( SELECT GREATEST(0, DATE_PART('day', b.check_in_date - b.created_at)) AS lt FROM bookings b WHERE b.hotel_id = $1 AND b.booking_status = 'confirmed' AND b.created_at >= $2 AND b.created_at < $3) t
         ) buckets GROUP BY bucket ORDER BY CASE bucket WHEN '0-1' THEN 1 WHEN '2-3' THEN 2 WHEN '4-7' THEN 3 WHEN '8-14' THEN 4 WHEN '15-30' THEN 5 ELSE 6 END`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const pd = await db.query(
      `SELECT stay_date::date as stay_key, TO_CHAR(stay_date, 'Mon DD') as date, SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid, SUM(CASE WHEN payment_status != 'paid' THEN 1 ELSE 0 END) as pending
         FROM bookings b CROSS JOIN LATERAL generate_series(b.check_in_date, b.check_out_date - INTERVAL '1 day', INTERVAL '1 day') AS stay_date
        WHERE b.hotel_id = $1 AND b.booking_status IN ('confirmed','pending') AND stay_date >= $2 AND stay_date < $3
        GROUP BY stay_date ORDER BY stay_date`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const cp = await db.query(
      `SELECT payment_status, COUNT(*) as cancels FROM bookings WHERE hotel_id = $1 AND booking_status = 'cancelled' AND created_at >= $2 AND created_at < $3 GROUP BY payment_status`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );
    const cancelMap = {};
    cp.rows.forEach(r => { cancelMap[(r.payment_status || "unknown")] = parseInt(r.cancels) || 0; });
    Object.keys(paymentMixMap).forEach(k => { if (!cancelMap.hasOwnProperty(k)) cancelMap[k] = 0; });
    if (!cancelMap.hasOwnProperty("paid")) cancelMap["paid"] = 0;
    if (!cancelMap.hasOwnProperty("pending")) cancelMap["pending"] = 0;

    const sm = await db.query(
      `SELECT COALESCE(booking_source,'unknown') AS source, COUNT(*) AS count FROM bookings WHERE hotel_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY COALESCE(booking_source,'unknown')`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const st = await db.query(
      `SELECT created_at::date as d, TO_CHAR(created_at::date, 'Mon DD') as date, SUM(CASE WHEN booking_source='web' THEN 1 ELSE 0 END) as web, SUM(CASE WHEN booking_source='chat' THEN 1 ELSE 0 END) as chat, SUM(CASE WHEN booking_source='phone' THEN 1 ELSE 0 END) as phone, SUM(CASE WHEN booking_source='ota' THEN 1 ELSE 0 END) as ota, SUM(CASE WHEN booking_source NOT IN ('web','chat','phone','ota') OR booking_source IS NULL THEN 1 ELSE 0 END) as other
         FROM bookings WHERE hotel_id = $1 AND created_at >= $2 AND created_at < $3 GROUP BY d ORDER BY d`,
      [hotel_id, startDateStr, endDateExclusiveStr]
    );

    const todayStr = new Date().toISOString().slice(0,10);
    const plus3 = new Date(); plus3.setDate(plus3.getDate() + 3);
    const plus3Str = plus3.toISOString().slice(0,10);
    const uaCount = await db.query(
      `SELECT COUNT(*) as cnt FROM bookings WHERE hotel_id = $1 AND booking_status IN ('confirmed','pending') AND payment_status != 'paid' AND check_in_date >= $2 AND check_in_date <= $3`,
      [hotel_id, todayStr, plus3Str]
    );

    const availSnapshot = await db.query(
      `SELECT COALESCE(SUM(r.total_rooms),0) - COALESCE((
         SELECT SUM(b.number_of_rooms)
           FROM bookings b
          WHERE b.hotel_id = $1
            AND b.booking_status = 'confirmed'
            AND b.check_in_date <= CURRENT_DATE
            AND b.check_out_date > CURRENT_DATE
      ),0) AS available_rooms
       FROM rooms r WHERE r.hotel_id = $1`,
      [hotel_id]
    );

    const availByTypeRes = await db.query(
      `WITH occupied AS (
         SELECT room_id, SUM(number_of_rooms) AS booked_now
           FROM bookings
          WHERE hotel_id = $1
            AND booking_status = 'confirmed'
            AND check_in_date <= CURRENT_DATE
            AND check_out_date > CURRENT_DATE
          GROUP BY room_id
       )
       SELECT r.room_type,
              SUM(r.total_rooms) - COALESCE(SUM(o.booked_now), 0) AS available_rooms
         FROM rooms r
         LEFT JOIN occupied o ON o.room_id = r.room_id
        WHERE r.hotel_id = $1
        GROUP BY r.room_type
        ORDER BY r.room_type`,
      [hotel_id]
    );

    const trendWithOcc = revenueTrend.rows.map(r => ({
      date: r.date, daily_revenue: parseInt(r.daily_revenue) || 0,
      occupancy_pct: totalCapacity > 0 ? Number(((parseInt(r.occupied_rooms) || 0) / totalCapacity) * 100).toFixed(1) : 0
    }));

    res.json({
      period: period,
      hotel: { hotel_id, hotel_name: hotelName },
      summary: {
        total_revenue: totalRevenue, total_bookings: totalBookings, confirmed_bookings: confirmedCount, cancelled_bookings: cancelledCount,
        available_rooms: parseInt(availSnapshot.rows[0]?.available_rooms) || 0,
        available_by_room_type: availByTypeRes.rows.map(r => ({ room_type: r.room_type, available: parseInt(r.available_rooms) || 0 }))
      },
      key_metrics: {
        occupancy_rate: occupancyRate, revpar: revpar, adr: adr, alos: alos, cancellation_rate: cancellationRate, repeat_guest_rate: repeatGuestRate, payment_mix: paymentMixMap
      },
      revenue_by_room_type: revenueByRoom.rows.map(r => ({ room_type: r.room_type, revenue: parseInt(r.revenue) || 0 })),
      peak_days: peakDaysFull,
      revenue_trend: trendWithOcc,
      top_rooms: tr.rows.map(r => ({ room_type: r.room_type, revenue: parseInt(r.revenue) || 0, bookings: parseInt(r.bookings) || 0, cancels: parseInt(r.cancels) || 0 })),
      lead_time: lt.rows.map(r => ({ bucket: r.bucket, count: parseInt(r.count) || 0 })),
      payment_daily: pd.rows.map(r => ({ date: r.date, paid: parseInt(r.paid) || 0, pending: parseInt(r.pending) || 0 })),
      cancellations_by_payment: Object.entries(cancelMap).map(([k,v]) => ({ payment_status: k, cancels: v })),
      source_mix: sm.rows.map(r => ({ source: r.source, count: parseInt(r.count) || 0 })),
      source_trend: st.rows.map(r => ({ date: r.date, web: parseInt(r.web) || 0, chat: parseInt(r.chat) || 0, phone: parseInt(r.phone) || 0, ota: parseInt(r.ota) || 0, other: parseInt(r.other) || 0 })),
      alerts: { unpaid_arrivals_next3: parseInt(uaCount.rows[0]?.cnt) || 0 },
      comparison: { revenue_change_percent: parseFloat(revenueChange), previous_period_revenue: prevRevenue }
    });
  } catch (err) {
    res.status(500).json({ message: "Server error generating analytics" });
  }
});

// ==========================================
// AI GUEST QUERY 
// ==========================================
app.post("/api/guest/query", async (req, res) => {
  const { hotel_id, query_text, check_in, check_out, chatState } = req.body;
  if (!hotel_id || !query_text) return res.status(400).json({ message: "hotel_id and query_text are required" });

  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const safeCheckIn = check_in ? check_in : today.toISOString().split('T')[0];
  const safeCheckOut = check_out ? check_out : tomorrow.toISOString().split('T')[0];

  try {
    const hotelResult = await db.query(`SELECT * FROM hotels WHERE hotel_id = $1`, [hotel_id]);
    if (hotelResult.rows.length === 0) return res.status(404).json({ message: "Hotel not found" });

    const roomsResult = await db.query(
      `SELECT r.room_id, r.room_type as type, COALESCE(o.custom_price, r.price_per_night) as price,
              r.description, r.capacity,
              (SELECT string_agg(amenity_name, ', ') FROM room_amenities WHERE room_id = r.room_id) AS room_amenities,
              r.total_rooms - COALESCE(
                  (SELECT MAX(daily_booked) FROM (
                      SELECT d.stay_date, SUM(b.number_of_rooms) as daily_booked
                      FROM generate_series($2::date, ($3::date - INTERVAL '1 day'), INTERVAL '1 day') AS d(stay_date)
                      JOIN bookings b ON b.room_id = r.room_id 
                                     AND b.booking_status = 'confirmed'
                                     AND b.check_in_date <= d.stay_date
                                     AND b.check_out_date > d.stay_date
                      GROUP BY d.stay_date
                  ) max_calc), 0
              ) as available
       FROM rooms r
       LEFT JOIN room_price_overrides o ON r.room_id = o.room_id AND o.target_date = $2
       WHERE r.hotel_id = $1`,
      [hotel_id, safeCheckIn, safeCheckOut] 
    );
    
    const amenitiesResult = await db.query(`SELECT DISTINCT amenity_name FROM room_amenities WHERE room_id IN (SELECT room_id FROM rooms WHERE hotel_id = $1)`, [hotel_id]);
    const hotelAmenities = amenitiesResult.rows.map(a => a.amenity_name).join(", ");

    const hotelInfo = hotelResult.rows[0];
    const attractionsRes = await db.query(
      `SELECT name, description, COALESCE(distance_km, 0) AS distance_km, category 
         FROM hotel_attractions 
        WHERE hotel_id = $1 
        ORDER BY distance_km NULLS LAST, name
        LIMIT 10`,
      [hotel_id]
    );
  const hotelContext = {
      hotel_id: hotel_id, hotel_name: hotelInfo.hotel_name, location: hotelInfo.location, description: hotelInfo.description || "", address: hotelInfo.address || "",
      google_maps: hotelInfo.google_maps_url || "", contact: `${hotelInfo.contact_phone || ""} | ${hotelInfo.contact_email || ""}`,
      amenities: hotelAmenities || "Standard hotel amenities", target_check_in: check_in, target_check_out: check_out,
      datesProvided: !!(req.body.check_in && req.body.check_out), 
      rooms: roomsResult.rows.map(r => ({ room_id: r.room_id, type: r.type, price: parseInt(r.price), available: Math.max(0, parseInt(r.available)), description: r.description || "", capacity: parseInt(r.capacity) || 2, amenities: r.room_amenities || "Standard amenities" })),
      attractions: attractionsRes.rows || []
    };

    const aiResult = await processGuestQuery(query_text, hotelContext, chatState);
    await db.query(`INSERT INTO guest_queries (hotel_id, query_text, intent_detected, response_text) VALUES ($1, $2, $3, $4)`, [hotel_id, query_text, aiResult.intent, aiResult.response]);
    res.json({ reply: aiResult.response, intent: aiResult.intent, chatState: aiResult.chatState });
  } catch (err) {
    res.status(500).json({ message: "Server error processing AI request" });
  }
});

app.get("/api/staff/queries/summary", verifyToken,async (req, res) => {
  const hotel_id = req.user.hotel_id;
  try {
    const totalQueries = await db.query(`SELECT COUNT(*) FROM guest_queries WHERE hotel_id = $1`, [hotel_id]);
    const topIntents = await db.query(`SELECT intent_detected, COUNT(*) AS count FROM guest_queries WHERE hotel_id = $1 GROUP BY intent_detected ORDER BY count DESC`, [hotel_id]);
    const commonQuestions = await db.query(`SELECT query_text, COUNT(*) AS count FROM guest_queries WHERE hotel_id = $1 GROUP BY query_text ORDER BY count DESC LIMIT 5`, [hotel_id]);
    res.json({ total_queries: totalQueries.rows[0].count, intent_breakdown: topIntents.rows, common_questions: commonQuestions.rows });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/api/guest/cancel-booking", async (req, res) => {
  const { booking_ref, guest_phone } = req.body;
  if (!booking_ref || !guest_phone) return res.status(400).json({ message: "Reference and Phone are required." });

  try {
    const result = await db.query(`SELECT booking_id, booking_status, created_at FROM bookings WHERE booking_ref = $1 AND guest_phone = $2`, [booking_ref.trim(), guest_phone.trim()]);
    if (result.rows.length === 0) return res.status(404).json({ message: "Booking not found." });
    
    const booking = result.rows[0];
    if (booking.booking_status === 'cancelled') return res.status(400).json({ message: "This booking is already cancelled." });

    const now = new Date();
    const hoursDifference = (now - new Date(booking.created_at)) / (1000 * 60 * 60);
    const MAX_CANCELLATION_HOURS = 24; 
    if (hoursDifference > MAX_CANCELLATION_HOURS) return res.status(400).json({ message: `Cancellation period expired. You can only cancel within the first ${MAX_CANCELLATION_HOURS} hours.` });

    await db.query(`UPDATE bookings SET booking_status = 'cancelled' WHERE booking_id = $1`, [booking.booking_id]);
    res.json({ message: "Booking successfully cancelled. The room has been released." });
  } catch (err) {
    res.status(500).json({ message: "Server error during cancellation." });
  }
});

app.get("/api/pricing/recommendations", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  const daysAhead = parseInt(req.query.days) || 7;
  const startDate = req.query.start_date || null;
  try {
    const recommendations = await getPricingRecommendations(db, hotelId, daysAhead, startDate);
    res.json({ hotel_id: hotelId, total_recommendations: recommendations.length, days_ahead: daysAhead, start_date: startDate, recommendations });
  } catch (err) {
    if (err.message?.includes("Invalid start date")) {
      return res.status(400).json({ message: "start_date must be ISO YYYY-MM-DD" });
    }
    console.error("Pricing recommendations failed:", err.message);
    res.status(500).json({ message: "Failed to get recommendations" });
  }
});

app.post("/api/pricing/calculate", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  const { room_id, booking_date } = req.body;
  try {
    const pricing = await calculateOptimalPrice(db, hotelId, room_id, new Date(booking_date));
    res.json({ room_id, booking_date, ...pricing });
  } catch (err) {
    res.status(500).json({ message: "Failed to calculate price" });
  }
});

app.post("/api/pricing/apply", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  const { room_id, new_price, target_date } = req.body;
  try {
    const result = await applyRecommendedPrice(db, hotelId, room_id, target_date, new_price);
    res.json({ message: "Price applied successfully", room: result });
  } catch (err) {
    res.status(500).json({ message: "Failed to apply price" });
  }
});

app.get("/api/pricing/history", verifyToken, async (req, res) => {
  const hotelId = req.user.hotel_id;
  const days = parseInt(req.query.days) || 30;
  try {
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    const result = await db.query(
      `SELECT room_id, date_for_booking, base_price, calculated_price, occupancy_rate, reason
       FROM pricing_history WHERE hotel_id = $1 AND created_at >= $2 ORDER BY created_at DESC`,
      [hotelId, fromDate]
    );
    res.json({ hotel_id: hotelId, period_days: days, total_records: result.rows.length, history: result.rows });
  } catch (err) {
    res.status(500).json({ message: "Failed to get history" });
  }
});

httpServer.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
