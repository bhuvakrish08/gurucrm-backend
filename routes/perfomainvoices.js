// ============================================================
// routes/pi.js — COMPLETE PI BACKEND WITH FILTER API
// ============================================================

const express = require("express");
const router = express.Router();
const db = require("../db");

// ============================================================
// CREATE PI FROM QUOTATION
// ============================================================
router.post("/create-from-quotation/:quotation_id", async (req, res) => {
  const { quotation_id } = req.params;
  const { percentage } = req.body;

  try {
    const [quotation] = await db
      .promise()
      .query(
        "SELECT * FROM quotation WHERE id = ? AND quotation_status = 'Won'",
        [quotation_id]
      );

    if (quotation.length === 0) {
      return res.status(400).json({ message: "Quotation not Won or not found" });
    }

    const q = quotation[0];
    const pi_no = `PI-${Date.now()}`;

    const [piResult] = await db.promise().query(
      `INSERT INTO proforma_invoices 
       (pi_no, pi_date, quotation_id, customer_name, quotation_no, assignee, total, proforma_percentage)
       VALUES (?, CURDATE(), ?, ?, ?, ?, ?, 0)`,
      [pi_no, q.id, q.customer_name, q.quotation_no, q.assignee, q.grand_total]
    );
    const pi_id = piResult.insertId;

    const amount = (q.grand_total * percentage) / 100;

    await db.promise().query(
      `INSERT INTO pi_follow_up (pi_id, proforma_percentage, total) VALUES (?, ?, ?)`,
      [pi_id, percentage, amount]
    );

    await db.promise().query(
      `UPDATE proforma_invoices 
       SET 
         proforma_percentage = (SELECT SUM(proforma_percentage) FROM pi_follow_up WHERE pi_id = ?),
         total = (SELECT SUM(total) FROM pi_follow_up WHERE pi_id = ?)
       WHERE pi_id = ?`,
      [pi_id, pi_id, pi_id]
    );

    res.json({ message: "PI Created Successfully", pi_id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// ADD FOLLOW-UP TO PI
// ============================================================
router.post("/add-followup/:pi_id", async (req, res) => {
  const { pi_id } = req.params;
  const { percentage } = req.body;

  try {
    const [piData] = await db.promise().query(
      `SELECT pi_id, quotation_id FROM proforma_invoices WHERE pi_id = ?`,
      [pi_id]
    );

    if (piData.length === 0) {
      return res.status(404).json({ message: "PI not found" });
    }

    const pi = piData[0];

    const [quoteData] = await db.promise().query(
      `SELECT grand_total FROM quotation WHERE id = ?`,
      [pi.quotation_id]
    );

    const grand_total = quoteData[0].grand_total;

    const [current] = await db.promise().query(
      `SELECT SUM(proforma_percentage) as total_percentage FROM pi_follow_up WHERE pi_id = ?`,
      [pi_id]
    );

    const currentPercentage = current[0].total_percentage || 0;

    if (currentPercentage + percentage > 100) {
      return res.status(400).json({ message: "Total percentage cannot exceed 100%" });
    }

    const amount = (grand_total * percentage) / 100;

    await db.promise().query(
      `INSERT INTO pi_follow_up (pi_id, proforma_percentage, total) VALUES (?, ?, ?)`,
      [pi_id, percentage, amount]
    );

    const [totals] = await db.promise().query(
      `SELECT SUM(proforma_percentage) as total_percentage, SUM(total) as total_amount
       FROM pi_follow_up WHERE pi_id = ?`,
      [pi_id]
    );

    const total_percentage = totals[0].total_percentage || 0;
    const total_amount = totals[0].total_amount || 0;

    await db.promise().query(
      `UPDATE proforma_invoices SET proforma_percentage = ?, total = ? WHERE pi_id = ?`,
      [total_percentage, total_amount, pi_id]
    );

    await db.promise().query(
      `UPDATE quotation SET proforma_percentage = ? WHERE id = ?`,
      [total_percentage, pi.quotation_id]
    );

    res.json({ success: true, message: "Follow-up added", total_percentage, total_amount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// GET ALL PI WITH FOLLOW-UPS
// ============================================================
router.get("/list", async (req, res) => {
  try {
    const [piData] = await db.promise().query(`
      SELECT 
        pi.pi_id,
        pi.pi_no,
        pi.pi_date,
        pi.customer_name,
        pi.quotation_no,
        pi.assignee,
        pi.total,
        pi.proforma_percentage,
        pi.status,
        pi.created_at,
        q.company_name,
        q.lead_id,
        q.grand_total AS quotation_grand_total
      FROM proforma_invoices pi
      LEFT JOIN quotation q ON q.id = pi.quotation_id
      ORDER BY pi.pi_id DESC
    `);

    const [followUps] = await db.promise().query(
      `SELECT * FROM pi_follow_up ORDER BY id DESC`
    );

    const result = piData.map((pi) => ({
      ...pi,
      follow_ups: followUps.filter((f) => f.pi_id === pi.pi_id),
    }));

    res.json({ success: true, count: result.length, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// FILTER PI  ← NEW API
// GET /api/pi/filter?customer_name=&assignee=&status=&from_date=&to_date=&quotation_no=&min_percentage=&max_percentage=&min_total=&max_total=
// ============================================================
router.get("/filter", async (req, res) => {
  try {
    const {
      customer_name,
      assignee,
      status,
      quotation_no,
      from_date,
      to_date,
      min_percentage,
      max_percentage,
      min_total,
      max_total,
    } = req.query;

    let sql = `
      SELECT 
        pi.pi_id,
        pi.pi_no,
        pi.pi_date,
        pi.customer_name,
        pi.quotation_no,
        pi.assignee,
        pi.total,
        pi.proforma_percentage,
        pi.status,
        pi.created_at,
        q.company_name,
        q.lead_id,
        q.grand_total AS quotation_grand_total
      FROM proforma_invoices pi
      LEFT JOIN quotation q ON q.id = pi.quotation_id
      WHERE 1=1
    `;

    const values = [];

    // Customer Name — partial match
    if (customer_name) {
      sql += " AND pi.customer_name LIKE ?";
      values.push(`%${customer_name}%`);
    }

    // Assignee — FIND_IN_SET (comma-separated field support)
    if (assignee) {
      sql += " AND FIND_IN_SET(?, pi.assignee)";
      values.push(assignee);
    }

    // Status — exact match
    if (status) {
      sql += " AND pi.status = ?";
      values.push(status);
    }

    // Quotation No — partial match
    if (quotation_no) {
      sql += " AND pi.quotation_no LIKE ?";
      values.push(`%${quotation_no}%`);
    }

    // PI Date range
    if (from_date && to_date) {
      sql += " AND DATE(pi.pi_date) BETWEEN ? AND ?";
      values.push(from_date, to_date);
    } else if (from_date) {
      sql += " AND DATE(pi.pi_date) >= ?";
      values.push(from_date);
    } else if (to_date) {
      sql += " AND DATE(pi.pi_date) <= ?";
      values.push(to_date);
    }

    // Proforma Percentage range
    if (min_percentage !== undefined && min_percentage !== "") {
      sql += " AND pi.proforma_percentage >= ?";
      values.push(Number(min_percentage));
    }

    if (max_percentage !== undefined && max_percentage !== "") {
      sql += " AND pi.proforma_percentage <= ?";
      values.push(Number(max_percentage));
    }

    // Total Amount range
    if (min_total !== undefined && min_total !== "") {
      sql += " AND pi.total >= ?";
      values.push(Number(min_total));
    }

    if (max_total !== undefined && max_total !== "") {
      sql += " AND pi.total <= ?";
      values.push(Number(max_total));
    }

    sql += " ORDER BY pi.pi_id DESC";

    const [piData] = await db.promise().query(sql, values);

    // Attach follow-ups
    const piIds = piData.map((p) => p.pi_id);

    let followUps = [];
    if (piIds.length > 0) {
      const [fuRows] = await db.promise().query(
        `SELECT * FROM pi_follow_up WHERE pi_id IN (?) ORDER BY id DESC`,
        [piIds]
      );
      followUps = fuRows;
    }

    const result = piData.map((pi) => ({
      ...pi,
      follow_ups: followUps.filter((f) => f.pi_id === pi.pi_id),
    }));

    res.json({ success: true, count: result.length, data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// UPDATE LATEST FOLLOW-UP ONLY
// ============================================================
router.put("/update-followup/:pi_id/:follow_id", async (req, res) => {
  const { pi_id, follow_id } = req.params;
  const { percentage } = req.body;

  try {
    const [latest] = await db.promise().query(
      `SELECT id FROM pi_follow_up WHERE pi_id = ? ORDER BY id DESC LIMIT 1`,
      [pi_id]
    );

    if (!latest.length || latest[0].id != follow_id) {
      return res.status(400).json({ message: "Only latest follow-up can be edited" });
    }

    const [quote] = await db.promise().query(
      `SELECT grand_total FROM quotation 
       WHERE id = (SELECT quotation_id FROM proforma_invoices WHERE pi_id = ?)`,
      [pi_id]
    );

    const grand_total = quote[0].grand_total;
    const amount = (grand_total * percentage) / 100;

    await db.promise().query(
      `UPDATE pi_follow_up SET proforma_percentage = ?, total = ? WHERE id = ?`,
      [percentage, amount, follow_id]
    );

    const [totals] = await db.promise().query(
      `SELECT SUM(proforma_percentage) as total_percentage, SUM(total) as total_amount
       FROM pi_follow_up WHERE pi_id = ?`,
      [pi_id]
    );

    await db.promise().query(
      `UPDATE proforma_invoices SET proforma_percentage = ?, total = ? WHERE pi_id = ?`,
      [totals[0].total_percentage, totals[0].total_amount, pi_id]
    );

    await db.promise().query(
      `UPDATE quotation SET proforma_percentage = ?
       WHERE id = (SELECT quotation_id FROM proforma_invoices WHERE pi_id = ?)`,
      [totals[0].total_percentage, pi_id]
    );

    res.json({ success: true, message: "Follow-up updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// CHECK IF PI EXISTS FOR A QUOTATION
// ============================================================
router.get("/check/:quotation_id", async (req, res) => {
  const { quotation_id } = req.params;
  try {
    const [rows] = await db.promise().query(
      `SELECT pi_id, pi_no, proforma_percentage, total, status 
       FROM proforma_invoices WHERE quotation_id = ? LIMIT 1`,
      [quotation_id]
    );
    if (rows.length > 0) {
      return res.json({ exists: true, pi: rows[0] });
    }
    return res.json({ exists: false, pi: null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// UPDATE PI STATUS
// ============================================================
router.put("/update-status/:pi_id", (req, res) => {
  const { pi_id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: "Status is required" });
  }

  const validStatus = ["draft", "sent", "partial", "paid", "cancelled"];

  if (!validStatus.includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  db.query(
    "SELECT * FROM proforma_invoices WHERE pi_id = ?",
    [pi_id],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, message: "DB error" });
      }

      if (result.length === 0) {
        return res.status(404).json({ success: false, message: "PI not found" });
      }

      db.query(
        "UPDATE proforma_invoices SET status = ? WHERE pi_id = ?",
        [status, pi_id],
        (err) => {
          if (err) {
            return res.status(500).json({ success: false, message: "Update failed" });
          }

          return res.json({
            success: true,
            message: "Status updated successfully",
            data: { pi_id, status },
          });
        }
      );
    }
  );
});

module.exports = router;