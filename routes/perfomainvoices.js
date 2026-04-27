// ============================================================
// routes/pi.js — COMPLETE PI BACKEND (replace your existing file)
// ============================================================

const express = require("express");
const router = express.Router();
const db = require("../db");
const mysql = require('mysql2/promise');  // ← bas /promise add karo


// CREATE PI FROM QUOTATION
router.post("/create-from-quotation/:quotation_id", async (req, res) => {
  const { quotation_id } = req.params;
  const { percentage } = req.body; // first percentage (ex: 50)

  try {
    // 1. Get quotation data
    const [quotation] = await db
      .promise()
      .query(
        "SELECT * FROM quotation WHERE id = ? AND quotation_status = 'Won'",
        [quotation_id],
      );

    if (quotation.length === 0) {
      return res
        .status(400)
        .json({ message: "Quotation not Won or not found" });
    }

    const q = quotation[0];

    // 2. Create PI
    const pi_no = `PI-${Date.now()}`;

    const [piResult] = await db.promise().query(
      `INSERT INTO proforma_invoices 
  (pi_no, pi_date, quotation_id, customer_name, quotation_no,assignee, total, proforma_percentage)
  VALUES (?, CURDATE(), ?, ?, ?, ?,?, 0)`,
      [pi_no, q.id, q.customer_name, q.quotation_no, q.assignee, q.grand_total],
    );
    const pi_id = piResult.insertId;

    // 3. Insert first follow-up
    const amount = (q.grand_total * percentage) / 100;

    await db.promise().query(
      `INSERT INTO pi_follow_up 
  (pi_id, proforma_percentage, total)
  VALUES (?, ?, ?)`,
      [pi_id, percentage, amount],
    );
    // 4. Update PI percentage AND total
    await db.promise().query(
      `UPDATE proforma_invoices 
   SET 
     proforma_percentage = (
       SELECT SUM(proforma_percentage) 
       FROM pi_follow_up 
       WHERE pi_id = ?
     ),
     total = (
       SELECT SUM(total) 
       FROM pi_follow_up 
       WHERE pi_id = ?
     )
   WHERE pi_id = ?`,
      [pi_id, pi_id, pi_id],
    );

    res.json({
      message: "PI Created Successfully",
      pi_id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// ADD FOLLOW-UP TO PI
router.post("/add-followup/:pi_id", async (req, res) => {
  const { pi_id } = req.params;
  const { percentage } = req.body;

  try {
    // 1. Get PI + quotation_id
    const [piData] = await db.promise().query(
      `SELECT pi_id, quotation_id 
       FROM proforma_invoices
       WHERE pi_id = ?`,
      [pi_id]
    );

    if (piData.length === 0) {
      return res.status(404).json({ message: "PI not found" });
    }

    const pi = piData[0];

    // 2. Get ORIGINAL grand_total from quotation
    const [quoteData] = await db.promise().query(
      `SELECT grand_total FROM quotation WHERE id = ?`,
      [pi.quotation_id]
    );

    const grand_total = quoteData[0].grand_total;

    // 3. Check total percentage (should not exceed 100)
    const [current] = await db.promise().query(
      `SELECT SUM(proforma_percentage) as total_percentage
       FROM pi_follow_up
       WHERE pi_id = ?`,
      [pi_id]
    );

    const currentPercentage = current[0].total_percentage || 0;

    if (currentPercentage + percentage > 100) {
      return res.status(400).json({
        message: "Total percentage cannot exceed 100%"
      });
    }

    // ✅ 4. FIXED CALCULATION (IMPORTANT)
    const amount = (grand_total * percentage) / 100;

    // 5. Insert follow-up
    await db.promise().query(
      `INSERT INTO pi_follow_up (pi_id, proforma_percentage, total)
       VALUES (?, ?, ?)`,
      [pi_id, percentage, amount]
    );

    // 6. Recalculate totals
    const [totals] = await db.promise().query(
      `SELECT 
        SUM(proforma_percentage) as total_percentage,
        SUM(total) as total_amount
       FROM pi_follow_up
       WHERE pi_id = ?`,
      [pi_id]
    );

    const total_percentage = totals[0].total_percentage || 0;
    const total_amount = totals[0].total_amount || 0;

    // 7. Update proforma_invoices
    await db.promise().query(
      `UPDATE proforma_invoices
       SET proforma_percentage = ?, total = ?
       WHERE pi_id = ?`,
      [total_percentage, total_amount, pi_id]
    );

    // 8. Update quotation
    await db.promise().query(
      `UPDATE quotation
       SET proforma_percentage = ?
       WHERE id = ?`,
      [total_percentage, pi.quotation_id]
    );

    res.json({
      success: true,
      message: "Follow-up added (fixed % logic)",
      total_percentage,
      total_amount
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET ALL PI WITH FOLLOW-UPS
router.get("/list", async (req, res) => {
  try {
    // 1. Get all PI
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
        q.lead_id
      FROM proforma_invoices pi
      LEFT JOIN quotation q ON q.id = pi.quotation_id
      ORDER BY pi.pi_id DESC
    `);

    // 2. Get all follow-ups
    const [followUps] = await db.promise().query(`
      SELECT * FROM pi_follow_up ORDER BY id DESC
    `);

    // 3. Map follow-ups to PI
    const result = piData.map(pi => {
      const relatedFollowUps = followUps.filter(f => f.pi_id === pi.pi_id);

      return {
        ...pi,
        follow_ups: relatedFollowUps
      };
    });

    res.json({
      success: true,
      count: result.length,
      data: result
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// UPDATE LATEST FOLLOW-UP ONLY
router.put("/update-followup/:pi_id/:follow_id", async (req, res) => {
  const { pi_id, follow_id } = req.params;
  const { percentage } = req.body;

  try {
    // 1. Get latest follow-up
    const [latest] = await db.promise().query(
      `SELECT id FROM pi_follow_up 
       WHERE pi_id = ? 
       ORDER BY id DESC LIMIT 1`,
      [pi_id]
    );

    if (!latest.length || latest[0].id != follow_id) {
      return res.status(400).json({
        message: "Only latest follow-up can be edited",
      });
    }

    // 2. Get quotation total
    const [quote] = await db.promise().query(
      `SELECT grand_total FROM quotation 
       WHERE id = (SELECT quotation_id FROM proforma_invoices WHERE pi_id = ?)`,
      [pi_id]
    );

    const grand_total = quote[0].grand_total;

    // 3. Update follow-up amount
    const amount = (grand_total * percentage) / 100;

    await db.promise().query(
      `UPDATE pi_follow_up 
       SET proforma_percentage = ?, total = ?
       WHERE id = ?`,
      [percentage, amount, follow_id]
    );

    // 4. Recalculate totals
    const [totals] = await db.promise().query(
      `SELECT 
        SUM(proforma_percentage) as total_percentage,
        SUM(total) as total_amount
       FROM pi_follow_up
       WHERE pi_id = ?`,
      [pi_id]
    );

    // 5. Update PI
    await db.promise().query(
      `UPDATE proforma_invoices
       SET proforma_percentage = ?, total = ?
       WHERE pi_id = ?`,
      [totals[0].total_percentage, totals[0].total_amount, pi_id]
    );

    res.json({
      success: true,
      message: "Follow-up updated",
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});



// GET — Check if PI exists for a quotation
// GET /api/pi/check/:quotation_id
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







router.put("/update-status/:pi_id", (req, res) => {
  const { pi_id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({
      success: false,
      message: "Status is required"
    });
  }

  const validStatus = ["draft", "sent", "partial", "paid", "cancelled"];

  if (!validStatus.includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Invalid status"
    });
  }

  // ✅ Check if PI exists
  db.query(
    "SELECT * FROM proforma_invoices WHERE pi_id = ?",
    [pi_id],
    (err, result) => {
      if (err) {
        console.log("SELECT ERROR:", err);
        return res.status(500).json({
          success: false,
          message: "DB error"
        });
      }

      if (result.length === 0) {
        return res.status(404).json({
          success: false,
          message: "PI not found"
        });
      }

      // ✅ Update status
      db.query(
        "UPDATE proforma_invoices SET status = ? WHERE pi_id = ?",
        [status, pi_id],
        (err, updateResult) => {
          if (err) {
            console.log("UPDATE ERROR:", err);
            return res.status(500).json({
              success: false,
              message: "Update failed"
            });
          }

          return res.json({
            success: true,
            message: "Status updated successfully",
            data: { pi_id, status }
          });
        }
      );
    }
  );
});


module.exports = router;