const express = require("express");
const db = require("../db");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const router = express.Router();

// =============================
// CLOUDINARY STORAGE
// =============================

<<<<<<< Updated upstream
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "crm/quotations",
    resource_type: "auto",
  }),
=======
  let sql = `
    SELECT 
  l.lead_id,
  l.company_name,
  l.customer_name,
  l.reference,
  ls.name AS source,
  l.assignee,
  l.status,
  l.created_at,
  l.updated_by,
  l.updated_at,
  NOW() AS server_time,
  (
    SELECT f.follow_up_date
    FROM lead_follow_up f
    WHERE f.lead_id = l.lead_id
    ORDER BY f.follow_up_date DESC
    LIMIT 1
  ) AS next_follow_up_date
    FROM lead l
    LEFT JOIN inquiry_lead_source ls
      ON ls.id = l.source
  `;

  let values = [];

  // ✅ Admin sees all leads
  if (loggedInRole !== "Admin" && loggedInRole !== "Super Admin") {
    sql += `
      WHERE FIND_IN_SET(?, REPLACE(l.assignee, ', ', ','))
    `;

    values.push(loggedInUser);
  }

  sql += ` ORDER BY l.lead_id DESC`;

  db.query(sql, values, (err, result) => {
    if (err) {
      console.log(err);

      return res.status(500).json({
        success: false,
        error: err,
      });
    }

    res.json({
      success: true,
      result,
    });
  });
});
/* =====================================
   GET ALL LEADS (sales route)
===================================== */
router.get("/sales/leads", authenticateAndAuthorize(), (req, res) => {
  const sql = `
    SELECT
      l.lead_id,
      l.company_name,
      l.customer_name,
      l.reference,
      ls.name AS source,
      l.priority,
      l.assignee,
      l.status,
      lc.name AS category,
      l.description,
      l.created_at,
      l.updated_by,
      l.updated_at
    FROM lead l
    LEFT JOIN inquiry_lead_source ls
      ON ls.id = l.source
    LEFT JOIN inquiry_lead_category lc
      ON lc.id = l.category
    ORDER BY l.lead_id DESC
  `;

  db.query(sql, (err, result) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: err,
      });
    }

    res.json({
      success: true,
      count: result.length,
      data: result,
    });
  });
>>>>>>> Stashed changes
});

const IMAGE_EXT = ["jpg", "jpeg", "png"];
const DOC_EXT = ["pdf", "doc", "xlsx", "csv", "pptx", "txt"];
const MAX_DOC_SIZE = 15 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_DOC_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (![...IMAGE_EXT, ...DOC_EXT].includes(ext)) {
      return cb(new Error("Unsupported file type"), false);
    }
    cb(null, true);
  },
});

// =============================
// HELPER: Get the "active" quotation id for a lead
// Prioritizes Approved/Won/Lost, else MAX id
// =============================

async function getActiveQuotationForLead(lead_id) {
  const [rows] = await db.promise().query(
    `SELECT id, quotation_no FROM quotation 
     WHERE id = (
       SELECT COALESCE(
         MAX(CASE WHEN quotation_status IN ('Approved', 'Won', 'Lost') THEN id END),
         MAX(id)
       )
       FROM quotation 
       WHERE lead_id = ?
     )`,
    [lead_id]
  );
  return rows && rows.length > 0 ? rows[0] : null;
}







// =============================
// UPDATE ASSIGNEE
// - lead_id based (not quotation id)
// - ALL quotations for this lead_id are updated together
// - Quotation na hoy to auto-create minimal quotation
// - Quotation hoy to update ALL matching lead_id quotations
// - assignee_log ma history store thay (JSON array)
// =============================

router.put(
  "/update-assignee/:lead_id",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const { assignee } = req.body;
      const lead_id = req.params.lead_id;

      if (assignee === undefined) {
        return res
          .status(400)
          .json({ success: false, message: "Assignee is required" });
      }

      const updatedBy =
        req.user?.username ||
        req.user?.name ||
        req.user?.email ||
        "Unknown";

      // ✅ Check if any quotations exist for this lead
      const [existingQuotations] = await db.promise().query(
        "SELECT id, assignee, assignee_log FROM quotation WHERE lead_id = ? ORDER BY id DESC LIMIT 1",
        [lead_id]
      );

      if (existingQuotations && existingQuotations.length > 0) {
        // ✅ Get current assignee_log and previous assignee from latest quotation
        const latestQuotation = existingQuotations[0];
        const previousAssignee = latestQuotation.assignee || "";

        // ✅ Parse existing log (safe parse)
        let assigneeLog = [];
        try {
          if (latestQuotation.assignee_log) {
            assigneeLog = JSON.parse(latestQuotation.assignee_log);
            if (!Array.isArray(assigneeLog)) assigneeLog = [];
          }
        } catch (e) {
          assigneeLog = [];
        }

        // ✅ New log entry push karvu
        const newLogEntry = {
          previous_assignee: previousAssignee,
          new_assignee: assignee || "",
          changed_by: updatedBy,
          changed_at: new Date().toISOString(),
        };
        assigneeLog.push(newLogEntry);

        const updatedLog = JSON.stringify(assigneeLog);

        // ✅ Update ALL quotations for this lead_id — full consistency
        // Latest quotation ma log update thay, baki ma sirf assignee update thay
        await db.promise().query(
          `UPDATE quotation SET 
            assignee = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE lead_id = ? AND id != ?`,
          [assignee || null, updatedBy, lead_id, latestQuotation.id]
        );

        // Latest quotation ma log sathe update
        await db.promise().query(
          `UPDATE quotation SET 
            assignee = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP,
            assignee_log = ?
           WHERE id = ?`,
          [assignee || null, updatedBy, updatedLog, latestQuotation.id]
        );

      } else {
        // ✅ No quotation at all — fetch lead info and create minimal quotation with log
        const [leadRow] = await db.promise().query(
          "SELECT company_name, customer_name, reference FROM lead WHERE lead_id = ?",
          [lead_id]
        );

        if (!leadRow || leadRow.length === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Lead not found" });
        }

        const lead = leadRow[0];

        // First assignment no log
        const initialLog = JSON.stringify([
          {
            previous_assignee: "",
            new_assignee: assignee || "",
            changed_by: updatedBy,
            changed_at: new Date().toISOString(),
          },
        ]);

        await db.promise().query(
          `INSERT INTO quotation 
           (lead_id, company_name, customer_name, reference, quotation_status, assignee, updated_by, updated_at, assignee_log)
           VALUES (?, ?, ?, ?, 'Pending', ?, ?, CURRENT_TIMESTAMP, ?)`,
          [
            lead_id,
            lead.company_name || null,
            lead.customer_name || null,
            lead.reference || null,
            assignee || null,
            updatedBy,
            initialLog,
          ]
        );
      }

      // Activity log
      try {
        const activityMsg = `${updatedBy} assigned "${assignee}" on lead #${lead_id}`;
        await db.promise().query(
          "INSERT INTO activities (message, user_name) VALUES (?, ?)",
          [activityMsg, updatedBy]
        );
      } catch (activityErr) {
        console.log("Activity Log Error:", activityErr.message);
      }

      res.json({
        success: true,
        message: "Assignee updated successfully for all quotations of this lead",
        updated_by: updatedBy,
        assignee,
        lead_id,
      });
    } catch (err) {
      console.log("UPDATE ASSIGNEE ERROR:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// =============================
// GET ASSIGNEE LOG FOR A LEAD
// Frontend thi call thay modal open thay tyare
// =============================

router.get("/assignee-log/:lead_id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const lead_id = req.params.lead_id;

    // Latest quotation no assignee_log fetch karvo
    const [rows] = await db.promise().query(
      `SELECT assignee_log FROM quotation 
       WHERE lead_id = ? 
       ORDER BY id DESC 
       LIMIT 1`,
      [lead_id]
    );

    if (!rows || rows.length === 0) {
      return res.json({ success: true, log: [] });
    }

    let log = [];
    try {
      if (rows[0].assignee_log) {
        log = JSON.parse(rows[0].assignee_log);
        if (!Array.isArray(log)) log = [];
      }
    } catch (e) {
      log = [];
    }

    // Reverse karvu — latest first
    log.reverse();

    res.json({ success: true, log });
  } catch (err) {
    console.log("GET ASSIGNEE LOG ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


























// =============================
// READ ALL QUOTATIONS
// Role-based: Admin/Super Admin sees all
// Others see only their assigned quotations
// =============================

router.get("/read", authenticateAndAuthorize(), async (req, res) => {
  try {
    const userRole = req.user?.role;
    const userName =
      req.user?.username || req.user?.name || req.user?.email || "";

    const isAdminOrSuper = ["Admin", "Super Admin"].includes(userRole);

    let rows;

    if (isAdminOrSuper) {
      [rows] = await db.promise().query(`
        SELECT 
          l.lead_id, 
          l.company_name, 
          l.customer_name, 
          l.reference, 
          l.status as lead_status,
          q.id as latest_quotation_id,
          q.quotation_no,
          q.quotation_date,
          q.quotation_status,
          q.grand_total,
          q.amount,
          q.discount,
          q.tax,
          q.activity_type,
          q.description,
          q.proforma_percentage,
          q.assignee,
          q.follow_up_date,
          q.updated_by,
          q.updated_at,
          q.created_at as quotation_created_at,
          q_first.first_quotation_date,
          IF(q_approved.approved_count > 0, 1, 0) AS has_approved
        FROM lead l
        LEFT JOIN (
          SELECT q1.*
          FROM quotation q1
          INNER JOIN (
            SELECT lead_id, 
                   COALESCE(
                     MAX(CASE WHEN quotation_status IN ('Approved', 'Won', 'Lost') THEN id END), 
                     MAX(id)
                   ) as max_id
            FROM quotation
            GROUP BY lead_id
          ) q2 ON q1.id = q2.max_id
        ) q ON l.lead_id = q.lead_id
        LEFT JOIN (
          SELECT lead_id, MIN(created_at) as first_quotation_date
          FROM quotation
          GROUP BY lead_id
        ) q_first ON l.lead_id = q_first.lead_id
        LEFT JOIN (
          SELECT lead_id, SUM(CASE WHEN quotation_status = 'Approved' THEN 1 ELSE 0 END) as approved_count
          FROM quotation
          GROUP BY lead_id
        ) q_approved ON l.lead_id = q_approved.lead_id
        WHERE l.status = 'Won'
        ORDER BY l.created_at DESC
      `);
    } else {
      [rows] = await db.promise().query(
        `
        SELECT 
          l.lead_id, 
          l.company_name, 
          l.customer_name, 
          l.reference, 
          l.status as lead_status,
          q.id as latest_quotation_id,
          q.quotation_no,
          q.quotation_date,
          q.quotation_status,
          q.grand_total,
          q.amount,
          q.discount,
          q.tax,
          q.activity_type,
          q.description,
          q.proforma_percentage,
          q.assignee,
          q.follow_up_date,
          q.updated_by,
          q.updated_at,
          q.created_at as quotation_created_at,
          q_first.first_quotation_date,
          IF(q_approved.approved_count > 0, 1, 0) AS has_approved
        FROM lead l
        LEFT JOIN (
          SELECT q1.*
          FROM quotation q1
          INNER JOIN (
            SELECT lead_id, 
                   COALESCE(
                     MAX(CASE WHEN quotation_status IN ('Approved', 'Won', 'Lost') THEN id END), 
                     MAX(id)
                   ) as max_id
            FROM quotation
            GROUP BY lead_id
          ) q2 ON q1.id = q2.max_id
        ) q ON l.lead_id = q.lead_id
        LEFT JOIN (
          SELECT lead_id, MIN(created_at) as first_quotation_date
          FROM quotation
          GROUP BY lead_id
        ) q_first ON l.lead_id = q_first.lead_id
        LEFT JOIN (
          SELECT lead_id, SUM(CASE WHEN quotation_status = 'Approved' THEN 1 ELSE 0 END) as approved_count
          FROM quotation
          GROUP BY lead_id
        ) q_approved ON l.lead_id = q_approved.lead_id
        WHERE l.status = 'Won'
          AND (
            FIND_IN_SET(?, q.assignee)
            OR EXISTS (
              SELECT 1 FROM quotation qa 
              WHERE qa.lead_id = l.lead_id 
                AND FIND_IN_SET(?, qa.assignee)
            )
          )
        ORDER BY l.created_at DESC
      `,
        [userName, userName]
      );
    }

    res.json({ success: true, result: rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// GET QUOTATION HISTORY
// =============================

router.get("/history/:lead_id", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT * FROM quotation WHERE lead_id = ? ORDER BY id DESC",
      [req.params.lead_id]
    );
    res.json({ success: true, result: rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// INSERT QUOTATION + FILES
// ✅ FIX: Insert પહેલાં empty draft quotations clean કરો
// =============================

router.post(
  "/insert",
  authenticateAndAuthorize(),
  upload.array("files", 5),
  async (req, res) => {
    try {
      const {
        lead_id,
        company_name,
        customer_name,
        reference,
        quotation_status,
        follow_up_date,
        quotation_no,
        quotation_date,
        grand_total,
        assignee,
        rate,
        discount,
        tax,
        amount,
        description,
        activity_type,
      } = req.body;

      const updatedBy =
        req.user?.username ||
        req.user?.name ||
        req.user?.email ||
        "Unknown";

      // ✅ FIX: New quotation insert કરતા પહેલાં
      // જૂની empty/draft rows delete કરો (Lead Won થઈ ત્યારે auto-create થયેલી)
      // જે rows માં quotation_no, grand_total, activity_type બધું NULL હોય
      if (lead_id) {
        await db.promise().query(
          `DELETE FROM quotation 
           WHERE lead_id = ? 
           AND (quotation_no IS NULL OR quotation_no = '')
           AND (grand_total IS NULL OR grand_total = 0)
           AND (activity_type IS NULL OR activity_type = '')`,
          [lead_id]
        );
      }

      const [result] = await db.promise().query(
        `INSERT INTO quotation 
         (
          lead_id,
          company_name,
          customer_name,
          reference,
          quotation_status,
          follow_up_date,
          quotation_no,
          quotation_date,
          grand_total,
          assignee,
          rate,
          discount,
          tax,
          amount,
          description,
          activity_type,
          updated_by,
          updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          lead_id || null,
          company_name || null,
          customer_name || null,
          reference || null,
          quotation_status || "Pending",
          follow_up_date || null,
          quotation_no || null,
          quotation_date || null,
          grand_total || null,
          assignee || null,
          rate || null,
          discount || null,
          tax || null,
          amount || null,
          description || null,
          activity_type || null,
          updatedBy,
        ]
      );

      const quotationId = result.insertId;

      if (req.files && req.files.length > 0) {
        const fileValues = req.files.map((f) => [
          quotationId,
          f.originalname,
          f.path,
          f.filename,
        ]);

        await db.promise().query(
          `INSERT INTO quotation_followup_files 
          (quot_follow_up_id, file_name, file_path, public_id)
          VALUES ?`,
          [fileValues]
        );
      }

      try {
        const userName =
          req.user?.username ||
          req.user?.name ||
          req.user?.email ||
          "Unknown User";

        const activityMsg = `${userName} created quotation ${quotation_no}`;

        await db.promise().query(
          "INSERT INTO activities (message, user_name) VALUES (?, ?)",
          [activityMsg, userName]
        );
      } catch (activityErr) {
        console.log("Activity Log Error:", activityErr.message);
      }

      return res.status(201).json({
        success: true,
        message: "Quotation created successfully",
        quotationId,
        updated_by: updatedBy,
      });
    } catch (err) {
      console.log("INSERT QUOTATION ERROR:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Something went wrong",
      });
    }
  }
);

// =============================
// FILTER QUOTATIONS
// Role-based filter applied here too
// =============================

router.get("/filter", authenticateAndAuthorize(), async (req, res) => {
  try {
    const {
      company_name,
      customer_name,
      reference,
      assignee,
      quotation_status,
      from_date,
      to_date,
    } = req.query;

    const userRole = req.user?.role;
    const userName =
      req.user?.username || req.user?.name || req.user?.email || "";
    const isAdminOrSuper = ["Admin", "Super Admin"].includes(userRole);

    let sql = `
      SELECT 
        l.lead_id, 
        l.company_name, 
        l.customer_name, 
        l.reference, 
        l.status as lead_status,
        q.id as latest_quotation_id,
        q.quotation_no,
        q.quotation_date,
        q.quotation_status,
        q.grand_total,
        q.amount,
        q.discount,
        q.tax,
        q.activity_type,
        q.description,
        q.assignee,
        q.follow_up_date,
        q.updated_by,
        q.updated_at,
        q.created_at as quotation_created_at,
        q_first.first_quotation_date,
        IF(q_approved.approved_count > 0, 1, 0) AS has_approved
      FROM lead l
      LEFT JOIN (
        SELECT q1.*
        FROM quotation q1
        INNER JOIN (
          SELECT lead_id, 
                 COALESCE(
                   MAX(CASE WHEN quotation_status IN ('Approved', 'Won', 'Lost') THEN id END), 
                   MAX(id)
                 ) as max_id
          FROM quotation
          GROUP BY lead_id
        ) q2 ON q1.id = q2.max_id
      ) q ON l.lead_id = q.lead_id
      LEFT JOIN (
        SELECT lead_id, MIN(created_at) as first_quotation_date
        FROM quotation
        GROUP BY lead_id
      ) q_first ON l.lead_id = q_first.lead_id
      LEFT JOIN (
        SELECT lead_id, SUM(CASE WHEN quotation_status = 'Approved' THEN 1 ELSE 0 END) as approved_count
        FROM quotation
        GROUP BY lead_id
      ) q_approved ON l.lead_id = q_approved.lead_id
      WHERE l.status = 'Won'
    `;
    const values = [];

    if (!isAdminOrSuper) {
      sql += `
        AND (
          FIND_IN_SET(?, q.assignee)
          OR EXISTS (
            SELECT 1 FROM quotation qa 
            WHERE qa.lead_id = l.lead_id 
              AND FIND_IN_SET(?, qa.assignee)
          )
        )
      `;
      values.push(userName, userName);
    }

    if (company_name) {
      sql += " AND l.company_name LIKE ?";
      values.push(`%${company_name}%`);
    }
    if (customer_name) {
      sql += " AND l.customer_name LIKE ?";
      values.push(`%${customer_name}%`);
    }
    if (reference) {
      sql += " AND l.reference LIKE ?";
      values.push(`%${reference}%`);
    }
    if (assignee) {
      sql += " AND FIND_IN_SET(?, q.assignee)";
      values.push(assignee);
    }
    if (quotation_status) {
      sql += " AND q.quotation_status = ?";
      values.push(quotation_status);
    }
    if (from_date && to_date) {
      sql += " AND DATE(l.created_at) BETWEEN ? AND ?";
      values.push(from_date, to_date);
    }

    sql += " ORDER BY l.lead_id DESC";

    const [rows] = await db.promise().query(sql, values);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// UPDATE QUOTATION DATA
// =============================

router.put("/update/:id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const {
      quotation_no,
      quotation_date,
      activity_type,
      amount,
      discount,
      tax,
      grand_total,
      description,
      assignee,
    } = req.body;

    const updatedBy =
      req.user?.username ||
      req.user?.name ||
      req.user?.email ||
      "Unknown";

    await db.promise().query(
      `UPDATE quotation SET 
        quotation_no = ?, 
        quotation_date = ?, 
        activity_type = ?, 
        amount = ?, 
        discount = ?, 
        tax = ?, 
        grand_total = ?, 
        description = ?, 
        assignee = ?,
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        quotation_no || null,
        quotation_date || null,
        activity_type || null,
        amount || null,
        discount || null,
        tax || null,
        grand_total || null,
        description || null,
        assignee || null,
        updatedBy,
        req.params.id,
      ]
    );

    try {
      const userName =
        req.user?.username ||
        req.user?.name ||
        req.user?.email ||
        "Unknown User";

      const activityMsg = `${userName} updated quotation ${quotation_no}`;

      await db.promise().query(
        "INSERT INTO activities (message, user_name) VALUES (?, ?)",
        [activityMsg, userName]
      );
    } catch (activityErr) {
      console.log("Activity Log Error:", activityErr.message);
    }

    res.json({
      success: true,
      message: "Quotation updated successfully",
      updated_by: updatedBy,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// UPDATE ASSIGNEE
// ✅ FIX: lead_id ની બધી quotations update કરો (સિર્ફ active નહીં)
// - Empty draft rows auto-create ની problem solve
// - Assignee હંમેશા correct row પર update થશે
// =============================

router.put(
  "/update-assignee/:lead_id",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const { assignee } = req.body;
      const lead_id = req.params.lead_id;

      if (assignee === undefined) {
        return res
          .status(400)
          .json({ success: false, message: "Assignee is required" });
      }

      const updatedBy =
        req.user?.username ||
        req.user?.name ||
        req.user?.email ||
        "Unknown";

      const activeQuotation = await getActiveQuotationForLead(lead_id);

      let quotationId;
      let quotation_no = null;

      if (activeQuotation) {
        quotationId = activeQuotation.id;
        quotation_no = activeQuotation.quotation_no;

        // ✅ FIX: Specific id ને બદલે lead_id ની બધી quotations update કરો
        // આ fix કરે છે: 131 (Vruda - empty draft) અને 132 (Yash) બંને update થશે
        await db.promise().query(
          `UPDATE quotation SET 
            assignee = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE lead_id = ?`,
          [assignee || null, updatedBy, lead_id]
        );
      } else {
        // કોઈ quotation નથી — lead info fetch કરીને minimal quotation create કરો
        const [leadRow] = await db.promise().query(
          "SELECT company_name, customer_name, reference FROM lead WHERE lead_id = ?",
          [lead_id]
        );

        if (!leadRow || leadRow.length === 0) {
          return res
            .status(404)
            .json({ success: false, message: "Lead not found" });
        }

        const lead = leadRow[0];

        const [insertResult] = await db.promise().query(
          `INSERT INTO quotation 
           (lead_id, company_name, customer_name, reference, quotation_status, assignee, updated_by, updated_at)
           VALUES (?, ?, ?, ?, 'Pending', ?, ?, CURRENT_TIMESTAMP)`,
          [
            lead_id,
            lead.company_name || null,
            lead.customer_name || null,
            lead.reference || null,
            assignee || null,
            updatedBy,
          ]
        );

        quotationId = insertResult.insertId;
      }

      // Activity log
      try {
        const activityMsg = `${updatedBy} assigned "${assignee}" on lead #${lead_id}`;
        await db.promise().query(
          "INSERT INTO activities (message, user_name) VALUES (?, ?)",
          [activityMsg, updatedBy]
        );
      } catch (activityErr) {
        console.log("Activity Log Error:", activityErr.message);
      }

      res.json({
        success: true,
        message: "Assignee updated successfully",
        updated_by: updatedBy,
        assignee,
        quotationId,
      });
    } catch (err) {
      console.log("UPDATE ASSIGNEE ERROR:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// =============================
// UPDATE STATUS
// =============================

router.put("/update-status/:id", async (req, res) => {
  try {
    const { quotation_status } = req.body;

    if (quotation_status === "Approved") {
      const [qRow] = await db
        .promise()
        .query("SELECT lead_id FROM quotation WHERE id = ?", [req.params.id]);
      const leadId = qRow[0]?.lead_id;

      if (leadId) {
        await db.promise().query(
          "UPDATE quotation SET quotation_status = 'Declined' WHERE lead_id = ? AND id != ?",
          [leadId, req.params.id]
        );
      }
    }

    await db.promise().query(
      "UPDATE quotation SET quotation_status = ? WHERE id = ?",
      [quotation_status, req.params.id]
    );
    res.json({ success: true, message: "Status updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// GET FILES FOR A QUOTATION
// =============================

router.get("/files/:id", async (req, res) => {
  try {
    const [files] = await db.promise().query(
      "SELECT * FROM quotation_followup_files WHERE quot_follow_up_id = ?",
      [req.params.id]
    );
    res.json({ success: true, files });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// DELETE QUOTATION
// =============================

router.delete("/:id", async (req, res) => {
  try {
    const [qRow] = await db.promise().query(
      "SELECT lead_id, quotation_status FROM quotation WHERE id = ?",
      [req.params.id]
    );
    const deletedQuotation = qRow[0];

    const [files] = await db.promise().query(
      "SELECT public_id FROM quotation_followup_files WHERE quot_follow_up_id = ?",
      [req.params.id]
    );

    for (const file of files) {
      if (file.public_id) {
        try {
          await cloudinary.uploader.destroy(file.public_id);
        } catch (e) {
          console.log("Cloudinary delete error:", e.message);
        }
      }
    }

    await db.promise().query(
      "DELETE FROM quotation_followup_files WHERE quot_follow_up_id = ?",
      [req.params.id]
    );

    await db
      .promise()
      .query("DELETE FROM quotation WHERE id = ?", [req.params.id]);

    if (
      deletedQuotation &&
      deletedQuotation.quotation_status === "Approved"
    ) {
      await db.promise().query(
        "UPDATE quotation SET quotation_status = 'Pending' WHERE lead_id = ?",
        [deletedQuotation.lead_id]
      );
    }

    res.json({ success: true, message: "Quotation deleted successfully" });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


<<<<<<< Updated upstream
module.exports = router;
=======
  let sql = `
    SELECT 
      l.lead_id,
      l.company_name,
      l.customer_name,
      l.reference,
      ls.name AS source,
      l.assignee,
      l.status,
      l.created_at,
      l.updated_by,
    l.updated_at,
NOW() AS server_time,
(
        SELECT f.follow_up_date
        FROM lead_follow_up f
        WHERE f.lead_id = l.lead_id
        ORDER BY f.follow_up_date DESC
        LIMIT 1
      ) AS next_follow_up_date
    FROM lead l
    LEFT JOIN inquiry_lead_source ls
      ON ls.id = l.source
    WHERE 1=1
  `;

  let values = [];

  if (company_name) {
    sql += " AND l.company_name LIKE ?";
    values.push(`%${company_name}%`);
  }

  if (customer_name) {
    sql += " AND l.customer_name LIKE ?";
    values.push(`%${customer_name}%`);
  }

  if (reference) {
    sql += " AND l.reference LIKE ?";
    values.push(`%${reference}%`);
  }

  if (source) {
    sql += " AND l.source = ?";
    values.push(source);
  }

  if (assignee) {
    sql += " AND FIND_IN_SET(?, l.assignee)";
    values.push(assignee);
  }

  if (status) {
    sql += " AND l.status = ?";
    values.push(status);
  }

  // ✅ FIXED: created date - single ya range banne handle thay
  if (from_created && to_created) {
    sql += " AND DATE(l.created_at) BETWEEN ? AND ?";
    values.push(from_created, to_created);
  } else if (from_created) {
    sql += " AND DATE(l.created_at) >= ?";
    values.push(from_created);
  } else if (to_created) {
    sql += " AND DATE(l.created_at) <= ?";
    values.push(to_created);
  }

  // ✅ FIXED: follow-up date - single ya range banne handle thay
  if (from_followup && to_followup) {
    sql += `
      AND (
        SELECT f.follow_up_date
        FROM lead_follow_up f
        WHERE f.lead_id = l.lead_id
        ORDER BY f.follow_up_date DESC
        LIMIT 1
      ) BETWEEN ? AND ?
    `;
    values.push(from_followup, to_followup);
  } else if (from_followup) {
    sql += `
      AND (
        SELECT f.follow_up_date
        FROM lead_follow_up f
        WHERE f.lead_id = l.lead_id
        ORDER BY f.follow_up_date DESC
        LIMIT 1
      ) >= ?
    `;
    values.push(from_followup);
  } else if (to_followup) {
    sql += `
      AND (
        SELECT f.follow_up_date
        FROM lead_follow_up f
        WHERE f.lead_id = l.lead_id
        ORDER BY f.follow_up_date DESC
        LIMIT 1
      ) <= ?
    `;
    values.push(to_followup);
  }

  sql += " ORDER BY l.lead_id DESC";

  db.query(sql, values, (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        error: err,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  });
});

/* =====================================
   GET CUSTOMER LIST FOR FILTER
===================================== */
router.get("/sales/leads/customers", authenticateAndAuthorize(), (req, res) => {
  const sql = `
    SELECT DISTINCT
      customer_name
    FROM lead
    WHERE customer_name IS NOT NULL
    AND customer_name != ''
    ORDER BY customer_name ASC
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        error: err,
      });
    }

    res.json({
      success: true,
      data: result,
    });
  });
});

module.exports = router;
>>>>>>> Stashed changes
