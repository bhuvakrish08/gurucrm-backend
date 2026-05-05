const express = require("express");
const db = require("../db");

const router = express.Router();

// Read all activities
router.get("/read", (req, res) => {
    const sql = "SELECT * FROM activities ORDER BY created_at DESC LIMIT 50";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json(result);
    });
});

// Mark activity as read
router.patch("/mark-as-read/:id", (req, res) => {
    const { id } = req.params;
    const sql = "UPDATE activities SET is_read = 1 WHERE id = ?";
    db.query(sql, [id], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ message: "Marked as read", id });
    });
});

// Mark all as read
router.patch("/mark-all-read", (req, res) => {
    const sql = "UPDATE activities SET is_read = 1";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ message: "All marked as read" });
    });
});

module.exports = router;
