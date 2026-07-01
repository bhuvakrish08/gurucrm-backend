const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const router = express.Router();

// Shared bucketing helper
const bucketByDate = (rows) => {
  const today = [],
    tomorrow = [],
    day_after = [];
  const fmt = (d) => new Date(d).toISOString().split("T")[0];
  const t0 = fmt(new Date());
  const t1 = fmt(new Date(Date.now() + 86400000));
  const t2 = fmt(new Date(Date.now() + 2 * 86400000));

  rows.forEach((r) => {
    const d = fmt(r.follow_up_date);
    if (d === t0) today.push(r);
    else if (d === t1) tomorrow.push(r);
    else if (d === t2) day_after.push(r);
  });

  return { today, tomorrow, day_after };
};

// ===================================================
// LEAD — UPCOMING FOLLOW-UPS
// ===================================================
router.get(
  "/lead-follow-up/upcoming",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const [rows] = await db.promise().query(`
        SELECT lead_id, company_name, customer_name, mobile_no,
               assignee, status, follow_up_date
        FROM (
          SELECT l.lead_id, l.company_name, l.customer_name, l.mobile_no,
                 l.assignee, l.status, lf.follow_up_date,
                 ROW_NUMBER() OVER (
                   PARTITION BY l.lead_id
                   ORDER BY lf.follow_up_id DESC
                 ) AS rn
          FROM lead l
          INNER JOIN lead_follow_up lf
            ON lf.lead_id = l.lead_id
          WHERE (l.status IS NULL OR l.status NOT IN ('Won', 'Lost'))
        ) ranked
        WHERE rn = 1
          AND follow_up_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 2 DAY)
        ORDER BY follow_up_date ASC
      `);

      console.log("🔍 RAW ROWS FROM DB:", rows); // 👈 temporary debug line
      res.json({ success: true, ...bucketByDate(rows) });
    } catch (err) {
      console.error("LEAD UPCOMING FOLLOWUP ERROR:", err);
      res
        .status(500)
        .json({ success: false, message: "Failed to fetch lead follow-ups" });
    }
  },
);
// ===================================================
// QUOTATION — UPCOMING FOLLOW-UPS
// ===================================================
router.get(
  "/quotation/upcoming-followups",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const [rows] = await db.promise().query(`
        SELECT quotation_id, lead_id, company_name, customer_name,
               quotation_no, assignee, quotation_status, follow_up_date
        FROM (
          SELECT q.id AS quotation_id, q.lead_id, q.company_name, q.customer_name,
                 qr.quotation_no, q.assignee, q.quotation_status, qr.follow_up_date,
                 ROW_NUMBER() OVER (
                   PARTITION BY q.id
                   ORDER BY qr.id DESC
                 ) AS rn
          FROM quotation q
          INNER JOIN (
            SELECT lead_id, MAX(id) AS latest_id
            FROM quotation
            GROUP BY lead_id
          ) latest ON latest.latest_id = q.id
          INNER JOIN quotation_revision qr
            ON qr.quotation_id = q.id
          WHERE (q.quotation_status IS NULL OR q.quotation_status NOT IN ('Won','Lost','Approved','Declined'))
        ) ranked
        WHERE rn = 1
          AND follow_up_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 2 DAY)
        ORDER BY follow_up_date ASC
      `);

      console.log("🔍 RAW QUOTATION ROWS FROM DB:", rows);
      res.json({ success: true, ...bucketByDate(rows) });
    } catch (err) {
      console.error("QUOTATION UPCOMING FOLLOWUP ERROR:", err);
      res.status(500).json({
        success: false,
        message: "Failed to fetch quotation follow-ups",
      });
    }
  },
);
module.exports = router;
