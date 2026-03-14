import moment from 'moment';
export async function getComprehensiveAnalytics(db, hotelId, dateFrom, dateTo) {
  try {
    // === 1. BASIC METRICS ===
    const totalRooms = await db.query(
      `SELECT COUNT(DISTINCT room_id) as count FROM rooms WHERE hotel_id = $1`,
      [hotelId]
    );

    const roomData = await db.query(
      `SELECT 
        COUNT(*) as total_bookings,
        SUM(check_out_date - check_in_date) as total_nights,
        SUM(CASE WHEN booking_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN booking_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(CASE WHEN booking_status = 'confirmed' 
            THEN (check_out_date - check_in_date) * price_per_night 
            ELSE 0 END) as total_revenue
       FROM bookings 
       WHERE hotel_id = $1 
       AND check_in_date >= $2 
       AND check_out_date <= $3`,
      [hotelId, dateFrom, dateTo]
    );

    const data = roomData.rows[0];
    const totalAvailableNights = totalRooms.rows[0].count * 
      Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24));

    // === 2. KEY METRICS ===
    const occupancyRate = (data.total_nights / totalAvailableNights) * 100;
    const revpar = data.total_revenue / totalRooms.rows[0].count;
    const adr = data.total_nights > 0 ? data.total_revenue / data.total_nights : 0;
    const cancellationRate = data.total_bookings > 0 
      ? (data.cancelled / data.total_bookings) * 100 
      : 0;

    // === 3. REPEAT GUESTS ===
    const guestMetrics = await db.query(
      `SELECT 
        COUNT(DISTINCT guest_phone) as unique_guests,
        COUNT(*) as total_bookings
       FROM bookings 
       WHERE hotel_id = $1 
       AND check_in_date >= $2 
       AND check_out_date <= $3`,
      [hotelId, dateFrom, dateTo]
    );

    const repeatGuestRate = guestMetrics.rows[0].total_bookings > 0
      ? ((guestMetrics.rows[0].total_bookings - guestMetrics.rows[0].unique_guests) / 
         guestMetrics.rows[0].total_bookings) * 100
      : 0;

    // === 4. REVENUE BY ROOM TYPE ===
    const revenueByRoom = await db.query(
      `SELECT 
        r.room_type,
        COUNT(*) as bookings,
        SUM(b.check_out_date - b.check_in_date) as nights,
        SUM((b.check_out_date - b.check_in_date) * b.price_per_night) as revenue
       FROM bookings b
       JOIN rooms r ON b.room_id = r.room_id
       WHERE b.hotel_id = $1 
       AND b.check_in_date >= $2 
       AND b.check_out_date <= $3
       GROUP BY r.room_type
       ORDER BY revenue DESC`,
      [hotelId, dateFrom, dateTo]
    );

    // === 5. PEAK DAYS ===
    const peakDays = await db.query(
      `SELECT 
        TO_CHAR(check_in_date, 'Day') as day_of_week,
        COUNT(*) as bookings
       FROM bookings 
       WHERE hotel_id = $1 
       AND check_in_date >= $2 
       AND check_out_date <= $3
       GROUP BY day_of_week
       ORDER BY bookings DESC`,
      [hotelId, dateFrom, dateTo]
    );

    // === 6. AVERAGE LENGTH OF STAY ===
    const alos = data.total_bookings > 0 
      ? data.total_nights / data.total_bookings 
      : 0;

    // === 7. COMPARISON WITH PREVIOUS PERIOD ===
    const previousFrom = new Date(dateFrom);
    const previousTo = new Date(dateTo);
    const daysDiff = (previousTo - previousFrom) / (1000 * 60 * 60 * 24);
    previousFrom.setDate(previousFrom.getDate() - daysDiff);

    const previousData = await db.query(
      `SELECT 
        SUM((check_out_date - check_in_date) * price_per_night) as total_revenue,
        COUNT(*) as total_bookings
       FROM bookings 
       WHERE hotel_id = $1 
       AND check_in_date >= $2 
       AND check_out_date <= $3`,
      [hotelId, previousFrom, dateFrom]
    );

    const prevRevenue = previousData.rows[0].total_revenue || 0;
    const revenueChange = ((data.total_revenue - prevRevenue) / prevRevenue) * 100;

    return {
      period: { from: dateFrom, to: dateTo },
      summary: {
        total_revenue: Math.round(data.total_revenue),
        total_bookings: data.total_bookings,
        confirmed_bookings: data.confirmed,
        cancelled_bookings: data.cancelled,
      },
      key_metrics: {
        occupancy_rate: occupancyRate.toFixed(1),
        revpar: Math.round(revpar),
        adr: Math.round(adr),
        alos: alos.toFixed(1),
        cancellation_rate: cancellationRate.toFixed(1),
        repeat_guest_rate: repeatGuestRate.toFixed(1),
      },
      revenue_by_room_type: revenueByRoom.rows,
      peak_days: peakDays.rows,
      comparison: {
        revenue_change_percent: revenueChange.toFixed(1),
        previous_period_revenue: Math.round(prevRevenue),
      },
    };
  } catch (err) {
    console.error("Analytics error:", err);
    throw err;
  }
}