import { Routes, Route } from "react-router-dom";

import StaffLogin from "./pages/StaffLogin";
import StaffDashboard from "./pages/StaffDashboard";
import HotelSearch from "./pages/HotelSearch";
import HotelPage from "./pages/HotelPage";
import HotelRegister from "./pages/HotelRegister";
import RoomManagement from "./pages/RoomManagement";
import LandingPage from "./pages/LandingPage";
import AdminDashboard from "./pages/AdminDashboard";
import StaffBookings from "./pages/StaffBookings";

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/search" element={<HotelSearch />} />
      <Route path="/hotel/:slug" element={<HotelPage />} />
      <Route path="/register-hotel" element = {<HotelRegister />} />
      <Route path="/staff-login" element={<StaffLogin />} />
      <Route path="/dashboard" element={<StaffDashboard />} />
      <Route path="/bookings" element={<StaffBookings />} />
      <Route path="/rooms" element={<RoomManagement />} />
      {/* Admins use the same unified login screen */}
      <Route path="/admin-login" element={<StaffLogin />} />
      <Route path="/admin-dashboard" element={<AdminDashboard />} />
    </Routes>
  );
}

export default App;
