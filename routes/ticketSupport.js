const express = require("express");
const db = require("../db");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

// Read all data
router.get("/read", async (req, res) => {
  try {
    const { search, search2, status } = req.query;

    let query = "SELECT * FROM ticket_support WHERE 1=1";
    const params = [];


    // 🔹 Textbox search (name)
    if (search2) {
      query += " AND name LIKE ?";
      params.push(`%${search2}%`);
    }

    // 🔹 Status dropdown
    if (status === "1" || status === "0") {
      query += " AND status = ?";
      params.push(status);
    }

    query += " ORDER BY id ASC";

    const [rows] = await db.promise().query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("Error in /read:", err);
    res.status(500).json({ success: false, message: "Internal Server Error", error: err.message });
  }
});

// Insert data
router.post("/insert", (req, res) => {
  const {name} = req.body;

  const query = `
    INSERT INTO ticket_support (name)
    VALUES (?)
  `;

  db.query(query, [name], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ status: 1, message: "Inserted successfully", result });
  });
});

// Update data
router.put("/update/:id", (req, res) => {
  const { id } = req.params;
  const { name } = req.body;

  const query = `
    UPDATE ticket_support
    SET name = ?
    WHERE id = ?
  `;

  db.query(query, [name, id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Updated successfully" });
  });
});

// Toggle status
router.put("/status/:id", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const query = "UPDATE ticket_support SET status = ? WHERE id = ?";
  db.query(query, [status, id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Status updated successfully" });
  });
});

// Update default value
router.put("/default/:id", (req, res) => {
  const { id } = req.params;
  const { default: isDefault } = req.body;

  const query = "UPDATE ticket_support SET `default` = ? WHERE id = ?";
  db.query(query, [isDefault, id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Default value updated successfully" });
  });
});


router.get("/get-column-scroll", async (req, res) => {
  try {
    const { direction, offset = 0, limit = 10 } = req.query;

    const columns = ["name"];

    const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM ticket_support");
    const total = countRows[0]?.total || 0;

    let newOffset = Number(offset);
    if (direction === "down") {
      newOffset = Math.min(newOffset + 1, Math.max(total - limit, 0));
    } else if (direction === "up") {
      newOffset = Math.max(newOffset - 1, 0);
    }

    const query = `SELECT id, ${columns.map(c => `\`${c}\``).join(", ")} FROM ticket_support ORDER BY id ASC LIMIT ? OFFSET ? `;

    const [rows] = await db.promise().query(query, [Number(limit), newOffset]);

    res.json({success: true, data: rows, newOffset, total});
  } catch (err) {
    
  }
});


module.exports = router;
