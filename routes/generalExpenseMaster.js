const express = require("express");
const router = express.Router();
const db = require("../db"); // tamara db.js no sachho relative path apjo

/* ============================================================
   1) CREATE — Insert new general expense type
   POST /api/general-expense-master/insert
   body: { name, status }
============================================================ */
router.post("/insert", (req, res) => {
  const { name, status } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ success: false, message: "name required che" });
  }

  const sql = `
    INSERT INTO general_expense_master (name, status)
    VALUES (?, ?)
  `;
  const values = [name, status || "1"];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Insert failed", error: err.message });
    }
    res
      .status(201)
      .json({
        success: true,
        message: "General expense type added",
        id: result.insertId,
      });
  });
});

/* ============================================================
   2) READ ALL — Get all general expense types (search/filter)
   GET /api/general-expense-master
   optional query: ?status=1&searchName=rent
============================================================ */
router.get("/", (req, res) => {
  const { status, searchName } = req.query;

  let sql = "SELECT * FROM general_expense_master WHERE 1=1";
  const values = [];

  if (status) {
    sql += " AND status = ?";
    values.push(status);
  }
  if (searchName) {
    sql += " AND name LIKE ?";
    values.push(`%${searchName}%`);
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
   2b) READ ACTIVE ONLY — for the dropdown on the Net Profit page
   GET /api/general-expense-master/options
============================================================ */
router.get("/options", (req, res) => {
  db.query(
    "SELECT id, name FROM general_expense_master WHERE status = '1' ORDER BY name ASC",
    (err, rows) => {
      if (err) {
        console.error("Fetch Error:", err);
        return res
          .status(500)
          .json({
            success: false,
            message: "Fetch failed",
            error: err.message,
          });
      }
      res.json({ success: true, data: rows });
    },
  );
});

/* ============================================================
   3) READ ONE
   GET /api/general-expense-master/:id
============================================================ */
router.get("/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    "SELECT * FROM general_expense_master WHERE id = ?",
    [id],
    (err, rows) => {
      if (err) {
        console.error("Fetch Error:", err);
        return res
          .status(500)
          .json({
            success: false,
            message: "Fetch failed",
            error: err.message,
          });
      }
      if (rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "General expense type not found" });
      }
      res.json({ success: true, data: rows[0] });
    },
  );
});

/* ============================================================
   4) UPDATE — Update full record
   PUT /api/general-expense-master/:id
   body: { name, status }
============================================================ */
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { name, status } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ success: false, message: "name required che" });
  }

  const sql = `
    UPDATE general_expense_master
    SET name = ?, status = ?
    WHERE id = ?
  `;
  const values = [name, status || "1", id];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Update Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Update failed", error: err.message });
    }
    if (result.affectedRows === 0) {
      return res
        .status(404)
        .json({ success: false, message: "General expense type not found" });
    }
    res.json({ success: true, message: "General expense type updated" });
  });
});

/* ============================================================
   5) UPDATE STATUS ONLY — toggle active/inactive
   PATCH /api/general-expense-master/:id
   body: { status: "1" | "0" }
============================================================ */
router.patch("/:id", (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !["1", "0"].includes(status)) {
    return res
      .status(400)
      .json({ success: false, message: 'status must be "1" or "0"' });
  }

  db.query(
    "UPDATE general_expense_master SET status = ? WHERE id = ?",
    [status, id],
    (err, result) => {
      if (err) {
        console.error("Status Update Error:", err);
        return res
          .status(500)
          .json({
            success: false,
            message: "Status update failed",
            error: err.message,
          });
      }
      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "General expense type not found" });
      }
      res.json({ success: true, message: `Status updated to "${status}"` });
    },
  );
});

/* ============================================================
   6) DELETE
   DELETE /api/general-expense-master/:id
============================================================ */
router.delete("/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    "DELETE FROM general_expense_master WHERE id = ?",
    [id],
    (err, result) => {
      if (err) {
        console.error("Delete Error:", err);
        return res
          .status(500)
          .json({
            success: false,
            message: "Delete failed",
            error: err.message,
          });
      }
      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ success: false, message: "General expense type not found" });
      }
      res.json({ success: true, message: "General expense type deleted" });
    },
  );
});

module.exports = router;
