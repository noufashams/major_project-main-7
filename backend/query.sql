CREATE TABLE hotels (
    hotel_id SERIAL PRIMARY KEY,
    hotel_name VARCHAR(150) NOT NULL,
    location VARCHAR(100) NOT NULL,
    address TEXT,
    google_maps_url TEXT,
    contact_phone VARCHAR(20),
    contact_email VARCHAR(150),
    description TEXT,
    slug VARCHAR(200) UNIQUE,    -- for clean URLs
    license_file_path TEXT,      -- path to uploaded license file
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE staff_users (
    staff_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role VARCHAR(50) DEFAULT 'staff', -- admin / staff
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id) ON DELETE CASCADE
);
CREATE TABLE rooms (
    room_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL,
    room_type VARCHAR(100) NOT NULL,   -- Deluxe, Standard
    price_per_night NUMERIC(10,2) NOT NULL,
    total_rooms INT NOT NULL,
    available_rooms INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id) ON DELETE CASCADE
);
CREATE TABLE bookings (
    booking_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL,
    room_id INT NOT NULL,
    guest_name VARCHAR(100) NOT NULL,
    guest_phone VARCHAR(20) NOT NULL,
    guest_email VARCHAR(200),
    check_in_date DATE NOT NULL,
    check_out_date DATE NOT NULL,
    license_file_path TEXT,
    number_of_rooms INT NOT NULL DEFAULT 1,
    booking_status VARCHAR(50) DEFAULT 'confirmed', -- confirmed / cancelled
    payment_status VARCHAR(50) DEFAULT 'pending',   -- pending / paid
    adults INT DEFAULT 1,
    children INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
);
CREATE TABLE guest_queries (
    query_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL,
    query_text TEXT NOT NULL,
    intent_detected VARCHAR(100),
    response_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id) ON DELETE CASCADE
);
CREATE TABLE analytics_summary (
    summary_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL,
    date DATE NOT NULL,
    total_bookings INT DEFAULT 0,
    occupancy_rate NUMERIC(5,2),
    most_booked_room VARCHAR(100),
    FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id) ON DELETE CASCADE
);

-- Add pictures table
CREATE TABLE room_pictures (
  picture_id SERIAL PRIMARY KEY,
  room_id INT NOT NULL,
  picture_url VARCHAR(500),
  caption VARCHAR(255),
  display_order INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(room_id)
);

-- Add amenities table
CREATE TABLE room_amenities (
  amenity_id SERIAL PRIMARY KEY,
  room_id INT NOT NULL,
  amenity_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(room_id)
);

-- Add hotel pictures table
CREATE TABLE hotel_pictures (
  picture_id SERIAL PRIMARY KEY,
  hotel_id INT NOT NULL,
  picture_url VARCHAR(500),
  picture_type VARCHAR(50), -- 'lobby', 'entrance', 'room', etc
  caption VARCHAR(255),
  display_order INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id)
);

-- Add hotel amenities table
CREATE TABLE hotel_amenities (
  amenity_id SERIAL PRIMARY KEY,
  hotel_id INT NOT NULL,
  amenity_name VARCHAR(100), -- 'Pool', 'WiFi', 'Parking', etc
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (hotel_id) REFERENCES hotels(hotel_id)
);

-- Add description fields to existing tables
ALTER TABLE rooms ADD COLUMN description TEXT;
ALTER TABLE rooms ADD COLUMN capacity INT DEFAULT 2;
ALTER TABLE hotels ADD COLUMN description TEXT;

-- Ratings from guests
CREATE TABLE IF NOT EXISTS hotel_ratings (
    rating_id SERIAL PRIMARY KEY,
    hotel_id INT NOT NULL REFERENCES hotels(hotel_id) ON DELETE CASCADE,
    guest_name VARCHAR(120),
    rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_hotel_ratings_hotel_id ON hotel_ratings(hotel_id);


-- Add indexes
CREATE INDEX idx_hotel_is_complete ON hotels(is_complete);
CREATE INDEX idx_room_pictures_room_id ON room_pictures(room_id);

-- Table to store the active surges that bypass the base price
CREATE TABLE IF NOT EXISTS room_price_overrides (
    override_id SERIAL PRIMARY KEY,
    hotel_id INT REFERENCES hotels(hotel_id),
    room_id INT REFERENCES rooms(room_id),
    target_date DATE NOT NULL,
    custom_price NUMERIC(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, target_date) -- Prevents multiple overrides for the same room/day
);

-- Table to log the AI's mathematical decisions for future ML training
CREATE TABLE IF NOT EXISTS pricing_history (
    history_id SERIAL PRIMARY KEY,
    hotel_id INT REFERENCES hotels(hotel_id),
    room_id INT REFERENCES rooms(room_id),
    date_for_booking DATE NOT NULL,
    base_price NUMERIC(10, 2),
    calculated_price NUMERIC(10, 2),
    occupancy_rate NUMERIC(5, 2),
    days_until INT,
    is_weekend BOOLEAN,
    is_holiday BOOLEAN,
    season VARCHAR(20),
    multiplier NUMERIC(5, 2),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE bookings 
ADD COLUMN payment_status VARCHAR(50) DEFAULT 'pending',
ADD COLUMN transaction_id VARCHAR(100),
ADD COLUMN booking_ref VARCHAR(20) UNIQUE;
