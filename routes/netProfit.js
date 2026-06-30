const express = require("express");
const router = express.Router();
const db = require("../db"); // tamara db.js no sachho relative path apjo

/* ============================================================
   helper — default to current month if no range given
============================================================ */
function getDefaultRange() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { from: iso(from), to: iso(to) };
}

/* ============================================================
   1) LOG AN EXPENSE ENTRY
   POST /api/net-profit/expense
   body: { expense_master_id, amount, expense_date, notes }
============================================================ */
router.post("/expense", (req, res) => {
  const { expense_master_id, amount, expense_date, notes } = req.body;

  if (!expense_master_id || !amount || !expense_date) {
    return res
      .status(400)
      .json({
        success: false,
        message: "expense_master_id, amount, expense_date required che",
      });
  }

  const sql = `
    INSERT INTO general_expense_entry (expense_master_id, amount, expense_date, notes)
    VALUES (?, ?, ?, ?)
  `;
  const values = [expense_master_id, amount, expense_date, notes || null];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Insert failed", error: err.message });
    }
    res
      .status(201)
      .json({ success: true, message: "Expense logged", id: result.insertId });
  });
});

/* ============================================================
   2) UPDATE AN EXPENSE ENTRY
   PUT /api/net-profit/expense/:id
   body: { expense_master_id, amount, expense_date, notes }
============================================================ */
router.put("/expense/:id", (req, res) => {
  const { id } = req.params;
  const { expense_master_id, amount, expense_date, notes } = req.body;

  if (!expense_master_id || !amount || !expense_date) {
    return res
      .status(400)
      .json({
        success: false,
        message: "expense_master_id, amount, expense_date required che",
      });
  }

  const sql = `
    UPDATE general_expense_entry
    SET expense_master_id = ?, amount = ?, expense_date = ?, notes = ?
    WHERE id = ?
  `;
  const values = [expense_master_id, amount, expense_date, notes || null, id];

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
        .json({ success: false, message: "Expense entry not found" });
    }
    res.json({ success: true, message: "Expense entry updated" });
  });
});

/* ============================================================
   3) DELETE AN EXPENSE ENTRY
   DELETE /api/net-profit/expense/:id
============================================================ */
router.delete("/expense/:id", (req, res) => {
  const { id } = req.params;

  db.query(
    "DELETE FROM general_expense_entry WHERE id = ?",
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
          .json({ success: false, message: "Expense entry not found" });
      }
      res.json({ success: true, message: "Expense entry deleted" });
    },
  );
});

/* ============================================================
   4) NET PROFIT CALCULATION — the main page endpoint
   GET /api/net-profit?from=2026-06-01&to=2026-06-30
   if from/to omitted, defaults to the current month
============================================================ */
router.get("/", (req, res) => {
  let { from, to } = req.query;

  if (!from || !to) {
    const def = getDefaultRange();
    from = from || def.from;
    to = to || def.to;
  }

  // 1) projects + net revenue in range
  const projectSql = `
    SELECT id, company_name, customer_name, quotation_no, quotation_date, net_revenue_amount
    FROM project
    WHERE quotation_date BETWEEN ? AND ?
    ORDER BY quotation_date DESC
  `;

  db.query(projectSql, [from, to], (err, projectRows) => {
    if (err) {
      console.error("Project Fetch Error:", err);
      return res
        .status(500)
        .json({
          success: false,
          message: "Project fetch failed",
          error: err.message,
        });
    }

    // 2) expense entries + their type name, in range
    const expenseSql = `
      SELECT e.id, e.amount, e.expense_date, e.notes, m.name AS expense_name
      FROM general_expense_entry e
      JOIN general_expense_master m ON m.id = e.expense_master_id
      WHERE e.expense_date BETWEEN ? AND ?
      ORDER BY e.expense_date DESC
    `;

    db.query(expenseSql, [from, to], (err2, expenseRows) => {
      if (err2) {
        console.error("Expense Fetch Error:", err2);
        return res
          .status(500)
          .json({
            success: false,
            message: "Expense fetch failed",
            error: err2.message,
          });
      }

      const netRevenue = projectRows.reduce(
        (sum, p) => sum + Number(p.net_revenue_amount || 0),
        0,
      );
      const totalExpense = expenseRows.reduce(
        (sum, e) => sum + Number(e.amount || 0),
        0,
      );
      const netProfit = netRevenue - totalExpense;

      res.json({
        success: true,
        from,
        to,
        netRevenue,
        totalExpense,
        netProfit,
        projects: projectRows,
        expenses: expenseRows,
      });
    });
  });
});

module.exports = router;
