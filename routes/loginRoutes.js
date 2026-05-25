const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;
const axios = require("axios");

const sendEmail = async (to, otp) => {
  try {
    const response = await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          name: "CRM Support",
          email: process.env.EMAIL_USER,
        },
        to: [{ email: to }],
        subject: "Password Reset OTP",
        htmlContent: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:Arial, sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" style="padding:20px;">
    <tr>
      <td align="center">
        
        <!-- Card -->
        <table width="400" cellpadding="0" cellspacing="0" 
          style="background:#ffffff;border-radius:12px;padding:30px;
                 box-shadow:0 4px 15px rgba(0,0,0,0.1);">

          <!-- Title -->
          <tr>
            <td align="center" style="font-size:22px;font-weight:bold;color:#333;">
              Password Reset Request
            </td>
          </tr>

          <!-- Message -->
          <tr>
            <td align="center" 
              style="font-size:14px;color:#666;padding:15px 0;">
              You recently requested to reset your password for your Venster CRM account.<br/>
              Use the OTP below to continue:
            </td>
          </tr>

          <!-- OTP BOX -->
          <tr>
            <td align="center">
              <div style="
                display:inline-block;
                padding:15px 30px;
                font-size:28px;
                letter-spacing:5px;
                font-weight:bold;
                color:#ffffff;
                background:#2563eb;
                border-radius:8px;">
                ${otp}
              </div>
            </td>
          </tr>

          <!-- Expiry -->
          <tr>
            <td align="center" 
              style="font-size:12px;color:#999;padding-top:15px;">
              This OTP is valid for 2 minutes.
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>
`,

        // 👇 THIS goes inside BODY (not hea ders section below)
        headers: {
          "X-Mailer": "CRM App",
        },
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json",
        },
      },
    );

    console.log("✅ Brevo Response:", response.data);
  } catch (error) {
    console.error("❌ Brevo Error:", error.response?.data || error.message);
    throw new Error("Email sending failed");
  }
};
//////////////////////////////////////////////////////////////////
// 🔐 LOGIN.
//////////////////////////////////////////////////////////////////
router.post("/login", (req, res) => {
  const { email, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE email = ? AND password = ?",
    [email, password],
    (err, results) => {
      if (err) return res.status(500).json({ message: "Database error" });

      if (results.length === 0)
        return res.status(401).json({ message: "Invalid credentials" });

      const user = results[0];

      if (user.status === 0) {
        return res.status(403).json({
          message: "Your account is inactive.",
        });
      }

      const token = jwt.sign(
        {
          id: user.id,
          role: user.role,
          username: (user.username || user.name || "").split(" ")[0],
        },
        JWT_SECRET,
        { expiresIn: "5h" },
      );

      res.json({
        message: "Login successful",
        token,
        role: user.role,
        username: (user.username || user.name || "").split(" ")[0],
        id: user.id,
      });
    },
  );
});

//////////////////////////////////////////////////////////////////
// 📩 SEND OTP (email OR mobile)
//////////////////////////////////////////////////////////////////
router.post("/send-otp", (req, res) => {
  const { identifier } = req.body;

  const isEmail = identifier.includes("@");

  const query = isEmail
    ? "SELECT * FROM users WHERE email = ?"
    : "SELECT * FROM users WHERE mobile = ?";

  db.query(query, [identifier], async (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });

    if (results.length === 0)
      return res.status(404).json({ message: "User not found" });

    const user = results[0];

    // ✅ NOW it's valid
    console.log("✅ USER OBJECT:", user);
    console.log("📩 OTP will be sent to:", user.email);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 2 * 60 * 1000);

    const userId = user.id || user.user_id;

    if (!userId) {
      console.log("❌ USER OBJECT:", user);
      return res.status(500).json({ message: "User ID missing" });
    }

    db.query(
      "UPDATE users SET otp=?, otp_expiry=? WHERE id=?",
      [otp, expiry, userId],
      async (err2, result) => {
        if (err2) return res.status(500).json({ message: "DB update error" });

        console.log("✅ UPDATE RESULT:", result);
        console.log("🔢 OTP:", otp);

        try {
          await sendEmail(user.email, otp);
          res.json({ message: "OTP sent successfully" });
        } catch (mailErr) {
          res.status(500).json({ message: "Error sending email" });
        }
      },
    );
  });
});

//////////////////////////////////////////////////////////////////
// 🔎 VERIFY OTP
//////////////////////////////////////////////////////////////////
router.post("/verify-otp", (req, res) => {
  const { identifier, otp } = req.body;

  const isEmail = identifier.includes("@");

  const query = isEmail
    ? "SELECT * FROM users WHERE email=? AND otp=?"
    : "SELECT * FROM users WHERE mobile=? AND otp=?";

  db.query(query, [identifier, otp], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error" });

    if (results.length === 0)
      return res.status(400).json({ message: "Invalid OTP" });

    const user = results[0];

    if (new Date(user.otp_expiry) < new Date()) {
      return res.status(400).json({ message: "OTP expired" });
    }

    res.json({
      message: "OTP verified",
      userId: user.id,
    });
  });
});

//////////////////////////////////////////////////////////////////
// 🔑 RESET PASSWORD
//////////////////////////////////////////////////////////////////
router.post("/reset-password", (req, res) => {
  const { userId, password } = req.body;

  db.query(
    "UPDATE users SET password=? WHERE id=?",
    [password, userId],
    (err) => {
      if (err) return res.status(500).json({ message: "DB error" });

      res.json({ message: "Password updated successfully" });
    },
  );
});

module.exports = router;
