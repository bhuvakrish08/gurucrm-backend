const express = require("express");
const db = require("../db");

const router = express.Router();

// read data
router.get("/read", (req, res) => {
    const sql = "SELECT * FROM org_notifications";
    db.query(sql, (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json(result);
    });
});


// update all status
router.patch("/update/:id", (req, res) => {
    const { field, value } = req.body;
    const { id } = req.params;

    const allowedFields = ["email_notification", "whatsapp_notification", "push_notification"];
    if (!allowedFields.includes(field)) {
        return res.status(400).json({ error: "Invalid field" });
    }

    const sql = `UPDATE org_notifications SET ${field} = ? WHERE id = ?`;
    db.query(sql, [value ? 1 : 0, id], (err, result) => {
        if (err) return res.status(500).json({ error: err });
        res.json({ message: "Updated successfully", id, field, value });
    });
});



module.exports = router;

