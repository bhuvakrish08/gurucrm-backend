const express = require("express");
const jwt = require("jsonwebtoken");
const db = require("../db");
require("dotenv").config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

// LOGIN ROUTE
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
                    message: "Your account is inactive. You cannot login."
                });
            }

            // Use correct column name for username
            const token = jwt.sign(
                {
                    id: user.id,
                    role: user.role,
                    username: user.username || user.name
                },
                JWT_SECRET,
                { expiresIn: "5h" }
            );

            return res.json({
                message: "Login successful",
                token: token,
                role: user.role,
                username: user.username || user.name,
                id: user.id,
            });
        }
    );

   
});

module.exports = router;
