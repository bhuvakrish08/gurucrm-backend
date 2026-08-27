const express = require("express");
const db = require("../db");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

// Read all data
router.get("/read", (req, res) => {
  const { search2 = "", status } = req.query;

  let query = "SELECT * FROM contract_types WHERE 1=1";
  const params = [];

  if (search2) {
    query += " AND name LIKE ?";
    params.push(`%${search2}%`);
  }
  if (status === "1" || status === "0") {
    query += " AND status = ?";
    params.push(status);
  }

  db.query(query, params, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});



// Insert data
router.post("/insert", (req, res) => {
  const { name, status } = req.body;

  const query = "INSERT INTO contract_types (name, status) VALUES (?, ?)";
  db.query(query, [name, status || 1], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ status: 1, message: "Inserted successfully", result });
  });
});

// Update data
router.put("/update/:id", (req, res) => {
  const { id } = req.params;
  const { name, status } = req.body;

  let query = "UPDATE contract_types SET name = ?";
  const params = [name];

  if (status !== undefined) {
    query += ", status = ?";
    params.push(status);
  }

  query += " WHERE id = ?";
  params.push(id);

  db.query(query, params, (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Updated successfully" });
  });
});

// update toggle
router.put("/status/:id", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const query = "UPDATE contract_types SET status = ? WHERE id = ?";
  db.query(query, [status, id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Status updated successfully" });
  });
});



router.get("/contracts", (req, res) => {
  const { status } = req.query;

  let sql = "SELECT id,name FROM contract_types";
  const values = [];

  // Apply status filter if provided
  if (status) {
    sql += " WHERE status = ?";
    values.push(status);
  }

  sql += " ORDER BY name ASC";

  db.query(sql, values, (err, rows) => {
    if (err) {
      console.error("Error fetching source names:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({
      success: true,
      data: rows,
    });
  });
});


module.exports = router;
