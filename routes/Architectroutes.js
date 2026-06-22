const express = require("express");
const router = express.Router();
const db = require("../db"); // tamara db.js no sachho relative path apjo

/* ============================================================
   1) CREATE — Insert new architect
   POST /api/architect/insert
   body: { name, email, address, status, mobile_no }
============================================================ */
router.post("/insert", (req, res) => {
  const { name, email, address, status, mobile_no } = req.body;

  if (!name || !email || !mobile_no) {
    return res
      .status(400)
      .json({ success: false, message: "name, email, mobile_no required che" });
  }

  const sql = `
    INSERT INTO architect (name, email, address, status, mobile_no)
    VALUES (?, ?, ?, ?, ?)
  `;
  // ✅ status default fixed to "active" (string) to match varchar column
  const values = [name, email, address || null, status || "active", mobile_no];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Insert failed", error: err.message });
    }
    res.status(201).json({ success: true, message: "Architect added", id: result.insertId });
  });
});

/* ============================================================
   2) READ ALL — Get all architects (with simple search/filter)
   GET /api/architect
   optional query: ?status=active&searchName=krish&searchEmail=...&searchMobile=...
============================================================ */
router.get("/", (req, res) => {
  const { status, searchName, searchEmail, searchMobile } = req.query;

  let sql = "SELECT * FROM architect WHERE 1=1";
  const values = [];

  if (status) {
    sql += " AND status = ?";
    values.push(status);
  }
  if (searchName) {
    sql += " AND name LIKE ?";
    values.push(`%${searchName}%`);
  }
  if (searchEmail) {
    sql += " AND email LIKE ?";
    values.push(`%${searchEmail}%`);
  }
  if (searchMobile) {
    sql += " AND mobile_no LIKE ?";
    values.push(`%${searchMobile}%`);
  }

  sql += " ORDER BY id DESC";

  db.query(sql, values, (err, rows) => {
    if (err) {
      console.error("Fetch Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Fetch failed", error: err.message });
    }
    res.json({ success: true, count: rows.length, data: rows });
  });
});

/* ============================================================
   3) READ ONE — Get single architect by id
   GET /api/architect/:id
============================================================ */
router.get("/:id", (req, res) => {
  const { id } = req.params;

  db.query("SELECT * FROM architect WHERE id = ?", [id], (err, rows) => {
    if (err) {
      console.error("Fetch Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Fetch failed", error: err.message });
    }
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Architect not found" });
    }
    res.json({ success: true, data: rows[0] });
  });
});

/* ============================================================
   4) UPDATE — Update full record
   PUT /api/architect/:id
   body: { name, email, address, status, mobile_no }
============================================================ */
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { name, email, address, status, mobile_no } = req.body;

  if (!name || !email || !mobile_no) {
    return res
      .status(400)
      .json({ success: false, message: "name, email, mobile_no required che" });
  }

  const sql = `
    UPDATE architect
    SET name = ?, email = ?, address = ?, status = ?, mobile_no = ?
    WHERE id = ?
  `;
  const values = [name, email, address || null, status || "active", mobile_no, id];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Update Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Update failed", error: err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Architect not found" });
    }
    res.json({ success: true, message: "Architect updated" });
  });
});

/* ============================================================
   5) UPDATE STATUS ONLY  ⭐ THIS IS THE ROUTE THAT WAS FAILING
   PATCH /api/architect/:id
   body: { status: "active" | "inactive" }
============================================================ */
router.patch("/:id", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  // ✅ FIX: explicit whitelist check instead of `if (!status)`.
  //         `if (!status)` looks safe but is a trap the moment someone
  //         sends 0 / false / "" — here we make the accepted values explicit
  //         so it always matches what the DB column actually allows.
  if (!status || !["active", "inactive"].includes(status)) {
    return res
      .status(400)
      .json({ success: false, message: 'status must be "active" or "inactive"' });
  }

  db.query("UPDATE architect SET status = ? WHERE id = ?", [status, id], (err, result) => {
    if (err) {
      console.error("Status Update Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Status update failed", error: err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Architect not found" });
    }
    res.json({ success: true, message: `Status updated to "${status}"` });
  });
});

/* ============================================================
   6) DELETE — Remove architect
   DELETE /api/architect/:id
============================================================ */
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM architect WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error("Delete Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Delete failed", error: err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Architect not found" });
    }
    res.json({ success: true, message: "Architect deleted" });
  });
});

module.exports = router;