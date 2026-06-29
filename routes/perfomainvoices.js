// ============================================================
// routes/pi.js — COMPLETE PI BACKEND WITH SPLIT FOLLOW-UP
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
    const [quotation] = await db.promise().query(
      `SELECT q.*, COALESCE(qs.grand_total, q.grand_total) AS grand_total
       FROM quotation q
       LEFT JOIN quotation_splits qs ON q.id = qs.quotation_id
       WHERE q.id = ? 
       AND q.quotation_status IN ('Won', 'Approved')`,
      [quotation_id],
    );

    if (quotation.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Quotation not found or not Won",
      });
    }

    const q = quotation[0];

    const [existingPI] = await db.promise().query(
      `SELECT SUM(proforma_percentage) as total_percentage
       FROM proforma_invoices
       WHERE quotation_id = ?`,
      [quotation_id],
    );

    const usedPercentage = Number(existingPI[0]?.total_percentage || 0);
    const newPercentage = Number(percentage);

    if (usedPercentage + newPercentage > 100) {
      return res.status(400).json({
        success: false,
        message: `Only ${100 - usedPercentage}% remaining`,
      });
    }

    const amount = (Number(q.grand_total) * newPercentage) / 100;
    const pi_no = `PI-${Date.now()}`;

    const [piResult] = await db.promise().query(
      `INSERT INTO proforma_invoices
      (
        pi_no,
        pi_date,
        quotation_id,
        customer_name,
        quotation_no,
        assignee,
        source,
        reference,
        total,
        proforma_percentage,
        status
      )
      VALUES (?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pi_no,
        q.id,
        q.customer_name,
        q.quotation_no,
        q.assignee,
        q.source,
        q.reference,
        amount,
        newPercentage,
        "partial",
      ],
    );

    const pi_id = piResult.insertId;

    // Insert initial follow-up with split zeros (no proforma_percentage/total in pi_follow_up)
    await db.promise().query(
      `INSERT INTO pi_follow_up
      (pi_id, proforma_percentage_9, proforma_percentage_18, total_9, total_18)
      VALUES (?, 0, 0, 0, 0)`,
      [pi_id],
    );

    await db.promise().query(
      `UPDATE quotation
       SET proforma_percentage = ?
       WHERE id = ?`,
      [usedPercentage + newPercentage, q.id],
    );

    return res.json({
      success: true,
      message: "PI Created Successfully",
    });
  } catch (err) {
    console.log(err);
    return res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

// ============================================================
// ADD FOLLOW-UP TO PI (WITH SPLIT total_9 / total_18)
// Base for percentage calculation = amount + tax (tax-inclusive)
// ============================================================
router.post("/add-followup/:pi_id", async (req, res) => {
  const { pi_id } = req.params;
  const {
    percentage,
    percentage_9,
    percentage_18,
  } = req.body;

  try {
    const [piData] = await db.promise().query(
      `SELECT pi_id, quotation_id FROM proforma_invoices WHERE pi_id = ?`,
      [pi_id],
    );

    if (piData.length === 0) {
      return res.status(404).json({ message: "PI not found" });
    }

    const pi = piData[0];

    // Get quotation split amounts + tax (tax-inclusive base)
    const [quoteData] = await db.promise().query(
      `SELECT q.grand_total, 
              COALESCE(qs.amount_9, pi_tbl.amount_9, 0) AS amount_9,
              COALESCE(qs.amount_18, pi_tbl.amount_18, 0) AS amount_18,
              COALESCE(qs.tax_9, pi_tbl.tax_9, 0) AS tax_9,
              COALESCE(qs.tax_18, pi_tbl.tax_18, 0) AS tax_18
       FROM quotation q
       LEFT JOIN quotation_splits qs ON qs.quotation_id = q.id
       LEFT JOIN proforma_invoices pi_tbl ON pi_tbl.quotation_id = q.id AND pi_tbl.pi_id = ?
       WHERE q.id = ?`,
      [pi_id, pi.quotation_id],
    );

    const grand_total = Number(quoteData[0]?.grand_total || 0);

    // Tax-inclusive base: amount + tax for each part
    const base_amt_9  = Number(quoteData[0]?.amount_9 || 0) + Number(quoteData[0]?.tax_9  || 0);
    const base_amt_18 = Number(quoteData[0]?.amount_18 || 0) + Number(quoteData[0]?.tax_18 || 0);

    // Current totals already used for Part A and Part B
    const [current9] = await db.promise().query(
      `SELECT COALESCE(SUM(proforma_percentage_9), 0) AS used_9
       FROM pi_follow_up WHERE pi_id = ?`,
      [pi_id],
    );
    const [current18] = await db.promise().query(
      `SELECT COALESCE(SUM(proforma_percentage_18), 0) AS used_18
       FROM pi_follow_up WHERE pi_id = ?`,
      [pi_id],
    );

    const used_9  = Number(current9[0].used_9);
    const used_18 = Number(current18[0].used_18);
    const new_pct_9  = Number(percentage_9  || 0);
    const new_pct_18 = Number(percentage_18 || 0);

    if (used_9 + new_pct_9 > 100) {
      return res.status(400).json({
        message: `Part A: Only ${(100 - used_9).toFixed(2)}% remaining`,
      });
    }
    if (used_18 + new_pct_18 > 100) {
      return res.status(400).json({
        message: `Part B: Only ${(100 - used_18).toFixed(2)}% remaining`,
      });
    }

    // Calculate amounts on tax-inclusive base
    const new_total_9  = (base_amt_9  * new_pct_9)  / 100;
    const new_total_18 = (base_amt_18 * new_pct_18) / 100;
    const new_total    = new_total_9 + new_total_18;

    // Overall percentage relative to grand total
    const overall_pct = grand_total > 0
      ? ((new_total / grand_total) * 100)
      : Number(percentage || 0);

    // Insert follow-up (no proforma_percentage / total columns in pi_follow_up)
    await db.promise().query(
      `INSERT INTO pi_follow_up 
       (pi_id, proforma_percentage_9, proforma_percentage_18, total_9, total_18)
       VALUES (?, ?, ?, ?, ?)`,
      [pi_id, new_pct_9, new_pct_18, new_total_9, new_total_18],
    );

    // Recalculate totals from all follow-ups
    const [totals] = await db.promise().query(
      `SELECT 
         SUM(proforma_percentage_9)  AS total_pct_9,
         SUM(proforma_percentage_18) AS total_pct_18,
         SUM(total_9)                AS total_amt_9,
         SUM(total_18)               AS total_amt_18
       FROM pi_follow_up WHERE pi_id = ?`,
      [pi_id],
    );

    const total_pct_9      = Number(totals[0].total_pct_9  || 0);
    const total_pct_18     = Number(totals[0].total_pct_18 || 0);
    const total_amt_9      = Number(totals[0].total_amt_9  || 0);
    const total_amt_18     = Number(totals[0].total_amt_18 || 0);

    // Overall % and total for proforma_invoices (based on grand_total)
    const total_amount     = total_amt_9 + total_amt_18;
    const total_percentage = grand_total > 0 ? (total_amount / grand_total) * 100 : 0;

    // Update proforma_invoices
    await db.promise().query(
      `UPDATE proforma_invoices 
       SET proforma_percentage = ?, total = ?, total_9 = ?, total_18 = ?
       WHERE pi_id = ?`,
      [total_percentage, total_amount, total_amt_9, total_amt_18, pi_id],
    );

    // Update quotation
    await db.promise().query(
      `UPDATE quotation SET proforma_percentage = ? WHERE id = ?`,
      [total_percentage, pi.quotation_id],
    );

    res.json({
      success: true,
      message: "Follow-up added",
      total_percentage,
      total_amount,
      total_pct_9,
      total_pct_18,
      total_amt_9,
      total_amt_18,
    });
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
        pi.quotation_id,
        pi.assignee,
        pi.source,
        pi.reference,
        pi.total,
        pi.amount_9,
        pi.amount_18,
        pi.tax_9,
        pi.tax_18,
        pi.total_9,
        pi.total_18,
        pi.proforma_percentage,
        pi.status,
        pi.stage,
        pi.created_at,
        q.company_name,
        q.lead_id,
        q.grand_total AS quotation_grand_total,
        COALESCE(qs.amount_9,  0) AS split_amount_9,
        COALESCE(qs.amount_18, 0) AS split_amount_18,
        COALESCE(qs.tax_9,  0) AS split_tax_9,
        COALESCE(qs.tax_18, 0) AS split_tax_18
      FROM proforma_invoices pi
      LEFT JOIN quotation q ON q.id = pi.quotation_id
      LEFT JOIN quotation_splits qs ON qs.quotation_id = pi.quotation_id
      ORDER BY pi.pi_id DESC
    `);

    const [followUps] = await db.promise().query(
      `SELECT * FROM pi_follow_up ORDER BY id DESC`,
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
// FILTER PI
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
        pi.quotation_id,
        pi.assignee,
        pi.source,
        pi.reference,
        pi.total,
        pi.amount_9,
        pi.amount_18,
        pi.tax_9,
        pi.tax_18,
        pi.total_9,
        pi.total_18,
        pi.proforma_percentage,
        pi.status,
        pi.stage,
        pi.created_at,
        q.company_name,
        q.lead_id,
        q.grand_total AS quotation_grand_total,
        COALESCE(qs.amount_9,  0) AS split_amount_9,
        COALESCE(qs.amount_18, 0) AS split_amount_18,
        COALESCE(qs.tax_9,  0) AS split_tax_9,
        COALESCE(qs.tax_18, 0) AS split_tax_18
      FROM proforma_invoices pi
      LEFT JOIN quotation q ON q.id = pi.quotation_id
      LEFT JOIN quotation_splits qs ON qs.quotation_id = pi.quotation_id
      WHERE 1=1
    `;

    const values = [];

    if (customer_name) { sql += " AND pi.customer_name LIKE ?"; values.push(`%${customer_name}%`); }
    if (assignee)      { sql += " AND FIND_IN_SET(?, pi.assignee)"; values.push(assignee); }
    if (status)        { sql += " AND pi.status = ?"; values.push(status); }
    if (quotation_no)  { sql += " AND pi.quotation_no LIKE ?"; values.push(`%${quotation_no}%`); }

    if (from_date && to_date) {
      sql += " AND DATE(pi.pi_date) BETWEEN ? AND ?";
      values.push(from_date, to_date);
    } else if (from_date) {
      sql += " AND DATE(pi.pi_date) >= ?"; values.push(from_date);
    } else if (to_date) {
      sql += " AND DATE(pi.pi_date) <= ?"; values.push(to_date);
    }

    if (min_percentage !== undefined && min_percentage !== "") {
      sql += " AND pi.proforma_percentage >= ?"; values.push(Number(min_percentage));
    }
    if (max_percentage !== undefined && max_percentage !== "") {
      sql += " AND pi.proforma_percentage <= ?"; values.push(Number(max_percentage));
    }
    if (min_total !== undefined && min_total !== "") {
      sql += " AND pi.total >= ?"; values.push(Number(min_total));
    }
    if (max_total !== undefined && max_total !== "") {
      sql += " AND pi.total <= ?"; values.push(Number(max_total));
    }

    sql += " ORDER BY pi.pi_id DESC";

    const [piData] = await db.promise().query(sql, values);
    const piIds = piData.map((p) => p.pi_id);

    let followUps = [];
    if (piIds.length > 0) {
      const [fuRows] = await db.promise().query(
        `SELECT * FROM pi_follow_up WHERE pi_id IN (?) ORDER BY id DESC`,
        [piIds],
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
// UPDATE LATEST FOLLOW-UP ONLY (WITH SPLIT)
// Base for percentage calculation = amount + tax (tax-inclusive)
// ============================================================
router.put("/update-followup/:pi_id/:follow_id", async (req, res) => {
  const { pi_id, follow_id } = req.params;
  const { percentage, percentage_9, percentage_18 } = req.body;

  try {
    const [latest] = await db.promise().query(
      `SELECT id FROM pi_follow_up WHERE pi_id = ? ORDER BY id DESC LIMIT 1`,
      [pi_id],
    );

    if (!latest.length || latest[0].id != follow_id) {
      return res.status(400).json({ message: "Only latest follow-up can be edited" });
    }

    // Get split base amounts + tax (tax-inclusive base)
    const [quoteData] = await db.promise().query(
      `SELECT q.grand_total,
              COALESCE(qs.amount_9,  pi_tbl.amount_9,  0) AS amount_9,
              COALESCE(qs.amount_18, pi_tbl.amount_18, 0) AS amount_18,
              COALESCE(qs.tax_9,  pi_tbl.tax_9,  0) AS tax_9,
              COALESCE(qs.tax_18, pi_tbl.tax_18, 0) AS tax_18
       FROM quotation q
       LEFT JOIN quotation_splits qs ON qs.quotation_id = q.id
       LEFT JOIN proforma_invoices pi_tbl ON pi_tbl.quotation_id = q.id AND pi_tbl.pi_id = ?
       WHERE q.id = (SELECT quotation_id FROM proforma_invoices WHERE pi_id = ?)`,
      [pi_id, pi_id],
    );

    const grand_total = Number(quoteData[0]?.grand_total || 0);

    // Tax-inclusive base: amount + tax for each part
    const base_amt_9  = Number(quoteData[0]?.amount_9 || 0) + Number(quoteData[0]?.tax_9  || 0);
    const base_amt_18 = Number(quoteData[0]?.amount_18 || 0) + Number(quoteData[0]?.tax_18 || 0);

    const new_pct_9  = Number(percentage_9  || 0);
    const new_pct_18 = Number(percentage_18 || 0);
    const new_total_9  = (base_amt_9  * new_pct_9)  / 100;
    const new_total_18 = (base_amt_18 * new_pct_18) / 100;
    const new_total    = new_total_9 + new_total_18;
    const overall_pct  = grand_total > 0
      ? ((new_total / grand_total) * 100)
      : Number(percentage || 0);

    await db.promise().query(
      `UPDATE pi_follow_up 
       SET proforma_percentage_9 = ?, proforma_percentage_18 = ?,
           total_9 = ?, total_18 = ?
       WHERE id = ?`,
      [new_pct_9, new_pct_18, new_total_9, new_total_18, follow_id],
    );

    const [totals] = await db.promise().query(
      `SELECT 
         SUM(total_9)  AS total_amt_9,
         SUM(total_18) AS total_amt_18
       FROM pi_follow_up WHERE pi_id = ?`,
      [pi_id],
    );

    const total_amt_9  = Number(totals[0].total_amt_9  || 0);
    const total_amt_18 = Number(totals[0].total_amt_18 || 0);
    const total_amount = total_amt_9 + total_amt_18;
    const total_pct    = grand_total > 0 ? (total_amount / grand_total) * 100 : 0;

    await db.promise().query(
      `UPDATE proforma_invoices 
       SET proforma_percentage = ?, total = ?, total_9 = ?, total_18 = ?
       WHERE pi_id = ?`,
      [
        total_pct,
        total_amount,
        total_amt_9,
        total_amt_18,
        pi_id,
      ],
    );

    await db.promise().query(
      `UPDATE quotation SET proforma_percentage = ?
       WHERE id = (SELECT quotation_id FROM proforma_invoices WHERE pi_id = ?)`,
      [total_pct, pi_id],
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
      [quotation_id],
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
      if (err) return res.status(500).json({ success: false, message: "DB error" });
      if (result.length === 0) return res.status(404).json({ success: false, message: "PI not found" });

      db.query(
        "UPDATE proforma_invoices SET status = ? WHERE pi_id = ?",
        [status, pi_id],
        (err) => {
          if (err) return res.status(500).json({ success: false, message: "Update failed" });
          return res.json({ success: true, message: "Status updated successfully", data: { pi_id, status } });
        },
      );
    },
  );
});

// ============================================================
// UPDATE PI STAGE (pending / completed)
// ============================================================
router.put("/update-stage/:pi_id", async (req, res) => {
  const { pi_id } = req.params;
  const { stage } = req.body;

  if (!stage || !["pending", "completed"].includes(stage)) {
    return res.status(400).json({ success: false, message: "Invalid stage" });
  }

  try {
    await db.promise().query(
      "UPDATE proforma_invoices SET stage = ? WHERE pi_id = ?",
      [stage, pi_id],
    );
    return res.json({ success: true, message: "Stage updated", stage });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, message: err.message });
  }
});


// REPLACE the entire quotation-file route with this:
router.get("/quotation-file/:quotation_id", async (req, res) => {
  try {
    const { quotation_id } = req.params;

    // Check quotation exists and is Approved
    const [quotation] = await db.promise().query(
      `SELECT id, quotation_status FROM quotation WHERE id = ?`,
      [quotation_id]
    );

    if (!quotation.length) {
      return res.json({ success: false, message: "Quotation not found" });
    }

    if (quotation[0].quotation_status !== "Approved") {
      return res.json({
        success: false,
        message: `Quotation is not approved (status: ${quotation[0].quotation_status})`,
      });
    }

    // quot_follow_up_id in quotation_followup_files stores the quotation_id directly
    const [files] = await db.promise().query(
      `SELECT file_path 
       FROM quotation_followup_files 
       WHERE quot_follow_up_id = ? 
       ORDER BY id DESC 
       LIMIT 1`,
      [quotation_id]
    );

    if (!files.length) {
      return res.json({ success: false, message: "No attachment found for this quotation" });
    }

    return res.json({ success: true, file: files[0].file_path });

  } catch (err) {
    console.error("quotation-file error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});
module.exports = router;