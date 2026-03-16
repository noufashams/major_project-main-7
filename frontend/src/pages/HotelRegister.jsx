import { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function HotelRegister() {

  const navigate = useNavigate();

  const [form, setForm] = useState({
    hotel_name: "",
    location: "",
    address: "",
    google_maps_url: "",
    contact_phone: "",
    contact_email: "",
    description: "",
    staff_name: "",
    staff_email: "",
    staff_password: "",
    license_file: null
  });

  const handleChange = (e) => {
    const { name, value, type, files } = e.target;
    setForm({
      ...form,
      [name]: type === 'file' ? files[0] : value
    });
  };
  const handleSubmit = async () => {

    try {
      const formData = new FormData();
      
      Object.keys(form).forEach(key => {
        if (form[key] !== null && form[key] !== '') {
          formData.append(key, form[key]);
        }
      });

      await axios.post(
        "http://localhost:3000/api/hotels/register",
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          }
        }
      );

      alert("Hotel registered successfully. Please wait for admin verification before logging in.");

      navigate("/staff-login");

    } catch (err) {

      console.error(err);

      alert("Registration failed");

    }

  };
  const handleLogin = () => {
    navigate("/staff-login");
  };
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "32px",
      fontFamily: "'Inter', system-ui, sans-serif",
      backgroundColor: "#0b1220",
      backgroundImage: "linear-gradient(150deg, rgba(6,10,18,0.80), rgba(10,16,28,0.62)), url('https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=2000&q=80&sat=-10')",
      backgroundSize: "cover",
      backgroundPosition: "center",
      backgroundRepeat: "no-repeat"
    }}>

      <div style={{
        width: "100%",
        maxWidth: "560px",
        background: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.22)",
        borderRadius: "20px",
        boxShadow: "0 26px 70px rgba(0,0,0,0.38)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
        padding: "28px",
        color: "#e5e7eb"
      }}>
        <div style={{ display: "grid", gap: "12px" }}>
          <h2 style={{ margin: "0 0 6px", color: "#fff", letterSpacing: "0.01em", textAlign: "center" }}>
            Register your hotel
          </h2>
            <Field label="Hotel Name">
              <input name="hotel_name" placeholder="Hotel Name" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Location">
              <input name="location" placeholder="City / Area" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Address">
              <input name="address" placeholder="Street, City, State" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Google Maps URL (optional)">
              <input name="google_maps_url" placeholder="https://maps.google.com/..." onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Phone">
              <input name="contact_phone" placeholder="+91 98765 43210" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Email">
              <input name="contact_email" placeholder="contact@hotel.com" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Description">
              <input name="description" placeholder="Short tagline for guests" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Hotel License Document">
              <input 
                type="file" 
                name="license_file" 
                accept=".pdf,.jpg,.jpeg,.png" 
                onChange={handleChange}
                style={inputStyle}
              />
            </Field>

            <h3 style={{ margin: "8px 0 0", color: "#fff" }}>Account Details</h3>

            <Field label="Admin Name">
              <input name="staff_name" placeholder="Your name" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Admin Email">
              <input name="staff_email" placeholder="admin@hotel.com" onChange={handleChange} style={inputStyle} />
            </Field>

            <Field label="Admin Password">
              <input name="staff_password" type="password" placeholder="••••••••" onChange={handleChange} style={inputStyle} />
            </Field>

          <button onClick={handleSubmit}
            style={primaryButton}>
            Register Hotel
          </button>
          
          <div style={{ textAlign: "center", color: "#cbd5e1" }}>
            <p>Already registered? 
              <button 
                onClick={handleLogin}
                style={{
                  background: "none",
                  border: "none",
                  color: "#93c5fd",
                  cursor: "pointer",
                  textDecoration: "none",
                  marginLeft: "5px",
                  fontSize: "15px",
                  fontWeight: 700
                }}>
                Login here
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );

}

const Field = ({ label, children }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
    <label style={{ color: "#e5e7eb", fontWeight: 700, fontSize: "13px", letterSpacing: "0.02em" }}>{label}</label>
    {children}
  </div>
);

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  border: "1px solid rgba(255,255,255,0.24)",
  borderRadius: "10px",
  boxSizing: "border-box",
  backgroundColor: "rgba(255,255,255,0.12)",
  color: "#f8fafc"
};

const primaryButton = {
  width: "100%",
  padding: "12px",
  background: "linear-gradient(135deg, #60a5fa, #a78bfa)",
  color: "white",
  border: "none",
  borderRadius: "10px",
  cursor: "pointer",
  fontSize: "16px",
  fontWeight: "700",
  letterSpacing: "0.01em",
  boxShadow: "0 18px 40px rgba(124,58,237,0.32)"
};

export default HotelRegister;
