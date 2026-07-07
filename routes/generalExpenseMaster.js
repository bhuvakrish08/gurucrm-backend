const express = require("express");
const router = express.Router();
const db = require("../db"); // tamara db.js no sachho relative path apjo

/* ============================================================
   1) CREATE — Insert new general expense type
   POST /api/general-expense-master/insert
   body: { name, status, is_recurring, budget_limit, start_date, end_date }

   start_date / end_date = expense type nu potanu duration.
   Budget check karti vakhate FAKT aa range vaali expenses count thashe.
============================================================ */
router.post("/insert", (req, res) => {
  const { name, status, is_recurring, budget_limit, start_date, end_date } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ success: false, message: "name required che" });
  }

  if (start_date && end_date && start_date > end_date) {
    return res
      .status(400)
      .json({ success: false, message: "start_date, end_date thi pehla hovi joiye" });
  }

  const sql = `
    INSERT INTO general_expense_master (name, status, is_recurring, budget_limit, start_date, end_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `;
  const values = [
    name,
    status || "1",
    is_recurring ? 1 : 0,
    budget_limit || null,
    start_date || null,
    end_date || null,
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Insert failed", error: err.message });
    }
    res.status(201).json({
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
   Returns is_recurring + budget_limit + start_date + end_date too
   so the frontend can show the "Recurring" badge, duration and
   budget alerts without an extra call.
============================================================ */
router.get("/options", (req, res) => {
  db.query(
    `SELECT id, name, is_recurring, budget_limit, start_date, end_date
     FROM general_expense_master
     WHERE status = '1'
     ORDER BY name ASC`,
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
   2c) BUDGET STATUS — spent vs budget_limit within each type's
   own start_date/end_date duration.
   GET /api/general-expense-master/budget-status
   Uses general_expense_entry table (expense_master_id, amount, expense_date)
   to sum how much has been spent inside each type's own range.

   FIX (2026-07-06): this previously joined a non-existent table
   `project_expense`, which meant this endpoint threw a SQL error
   whenever it was called ("Table 'crm.project_expense' doesn't
   exist"). Actual expense entries live in `general_expense_entry`
   (confirmed via phpMyAdmin — same table used by net-profit.js).
   Joining on that table now.
============================================================ */
router.get("/budget-status", (req, res) => {
  const sql = `
    SELECT
      gem.id,
      gem.name,
      gem.is_recurring,
      gem.budget_limit,
      gem.start_date,
      gem.end_date,
      COALESCE(SUM(
        CASE
          WHEN gem.start_date IS NULL OR gem.end_date IS NULL THEN pe.amount
          WHEN pe.expense_date BETWEEN gem.start_date AND gem.end_date THEN pe.amount
          ELSE 0
        END
      ), 0) AS spent
    FROM general_expense_master gem
    LEFT JOIN general_expense_entry pe ON pe.expense_master_id = gem.id
    WHERE gem.status = '1'
    GROUP BY gem.id, gem.name, gem.is_recurring, gem.budget_limit, gem.start_date, gem.end_date
    ORDER BY gem.name ASC
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Budget Status Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Fetch failed", error: err.message });
    }

    const data = rows.map((r) => {
      if (r.budget_limit == null) {
        return { ...r, remaining: null, status: null };
      }
      const remaining = Number(r.budget_limit) - Number(r.spent);
      return {
        ...r,
        remaining,
        status: remaining < 0 ? "Over Budget" : "Within Budget",
      };
    });

    res.json({ success: true, data });
  });
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
   body: { name, status, is_recurring, budget_limit, start_date, end_date }
============================================================ */
router.put("/:id", (req, res) => {
  const { id } = req.params;
  const { name, status, is_recurring, budget_limit, start_date, end_date } = req.body;

  if (!name) {
    return res
      .status(400)
      .json({ success: false, message: "name required che" });
  }

  if (start_date && end_date && start_date > end_date) {
    return res
      .status(400)
      .json({ success: false, message: "start_date, end_date thi pehla hovi joiye" });
  }

  const sql = `
    UPDATE general_expense_master
    SET name = ?, status = ?, is_recurring = ?, budget_limit = ?, start_date = ?, end_date = ?
    WHERE id = ?
  `;
  const values = [
    name,
    status || "1",
    is_recurring ? 1 : 0,
    budget_limit || null,
    start_date || null,
    end_date || null,
    id,
  ];

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


router.get("/", (req, res) => {
  const { status, searchName, is_recurring } = req.query;

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
  if (is_recurring === "1" || is_recurring === "0") {
    sql += " AND is_recurring = ?";
    values.push(is_recurring);
  }

  sql += " ORDER BY id DESC";

  db.query(sql, values, (err, rows) => {
    if (err) {
      console.error("Fetch Error:", err);
      return res.status(500).json({ success: false, message: "Fetch failed", error: err.message });
    }
    res.json({ success: true, count: rows.length, data: rows });
  });
});

module.exports = router;