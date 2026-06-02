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

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "crm/quotations",
    resource_type: "auto",
  }),
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
// READ ALL QUOTATIONS
// =============================

router.get("/read", authenticateAndAuthorize(), async (req, res) => {
  try {
    let loggedInFullName = "";
    if (req.user?.id) {
      const [uRows] = await db.promise().query("SELECT name FROM users WHERE id = ?", [req.user.id]);
      if (uRows.length > 0) {
        loggedInFullName = uRows[0].name;
      }
    }
    const userName =
      loggedInFullName || req.user?.username || req.user?.name || req.user?.email || "";

    const userRole = req.user?.role;
    const isAdminOrSuper = ["Admin", "Super Admin", "Sales", "Estimation", "Leads Management"].includes(userRole);

    let rows;

    if (isAdminOrSuper) {
      [rows] = await db.promise().query(`
        SELECT 
          l.lead_id, 
          l.company_name, 
          l.customer_name, 
          l.reference, 
          COALESCE(ls.name, l.source) AS source,
          l.assignee AS lead_assignee,
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
          q.assignee_log,
          q.follow_up_date,
          q.updated_by,
          q.updated_at,
          q.created_at as quotation_created_at,
          q_first.first_quotation_date,
          IF(q_approved.approved_count > 0, 1, 0) AS has_approved
        FROM lead l
        LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
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
          COALESCE(ls.name, l.source) AS source,
          l.assignee AS lead_assignee,
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
          q.assignee_log,
          q.follow_up_date,
          q.updated_by,
          q.updated_at,
          q.created_at as quotation_created_at,
          q_first.first_quotation_date,
          IF(q_approved.approved_count > 0, 1, 0) AS has_approved
        FROM lead l
        LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
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
            FIND_IN_SET(?, l.assignee)
            OR FIND_IN_SET(?, q.assignee)
            OR EXISTS (
              SELECT 1 FROM quotation qa 
              WHERE qa.lead_id = l.lead_id 
                AND FIND_IN_SET(?, qa.assignee)
            )
          )
        ORDER BY l.created_at DESC
      `,
        [userName, userName, userName]
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
// GET ASSIGNEE LOG FOR A LEAD
// =============================

router.get("/assignee-log/:lead_id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const lead_id = req.params.lead_id;

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

    // Reverse — latest first
    log.reverse();

    res.json({ success: true, log });
  } catch (err) {
    console.log("GET ASSIGNEE LOG ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// INSERT QUOTATION + FILES
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

      // Get lead's source
      let source = null;
      if (lead_id) {
        const [leadRows] = await db.promise().query(
          `SELECT COALESCE(ls.name, l.source) AS source 
           FROM lead l 
           LEFT JOIN inquiry_lead_source ls ON ls.id = l.source 
           WHERE l.lead_id = ?`,
          [lead_id]
        );
        if (leadRows.length > 0) {
          source = leadRows[0].source;
        }
      }

      // Safe Numeric Parser
      const parseNum = (val) => {
        if (val === undefined || val === null || val === '') return null;
        const cleanStr = String(val).replace(/[^0-9.-]/g, "");
        const num = parseFloat(cleanStr);
        return isNaN(num) ? null : num;
      };

      // Safe Date Parser
      const parseDate = (val) => {
        if (!val || val === '' || val === 'null' || val === 'undefined') return null;
        if (typeof val === 'string' && val.includes('-')) {
          const parts = val.split('-');
          if (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4) {
            return `${parts[2]}-${parts[1]}-${parts[0]}`;
          }
        }
        return val;
      };

      const parsedRate = parseNum(rate);
      const parsedDiscount = parseNum(discount);
      const parsedTax = parseNum(tax);
      const parsedAmount = parseNum(amount);
      const parsedGrandTotal = parseNum(grand_total);

      const parsedFollowUpDate = parseDate(follow_up_date);
      const parsedQuotationDate = parseDate(quotation_date);

      const [result] = await db.promise().query(
        `INSERT INTO quotation 
         (
          lead_id,
          company_name,
          customer_name,
          reference,
          source,
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
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          lead_id || null,
          company_name || null,
          customer_name || null,
          reference || null,
          source || null,
          quotation_status || "Pending",
          parsedFollowUpDate,
          quotation_no || null,
          parsedQuotationDate,
          parsedGrandTotal,
          assignee || null,
          parsedRate,
          parsedDiscount,
          parsedTax,
          parsedAmount,
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
        sqlMessage: err.sqlMessage,
        code: err.code,
        stack: err.stack,
      });
    }
  }
);

// =============================
// FILTER QUOTATIONS
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

    let loggedInFullName = "";
    if (req.user?.id) {
      const [uRows] = await db.promise().query("SELECT name FROM users WHERE id = ?", [req.user.id]);
      if (uRows.length > 0) {
        loggedInFullName = uRows[0].name;
      }
    }
    const userName =
      loggedInFullName || req.user?.username || req.user?.name || req.user?.email || "";
    const userRole = req.user?.role;
    const isAdminOrSuper = ["Admin", "Super Admin"].includes(userRole);

    let sql = `
      SELECT 
        l.lead_id, 
        l.company_name, 
        l.customer_name, 
        l.reference, 
        COALESCE(ls.name, l.source) AS source,
        l.assignee AS lead_assignee,
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
      LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
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
          FIND_IN_SET(?, l.assignee)
          OR FIND_IN_SET(?, q.assignee)
          OR EXISTS (
            SELECT 1 FROM quotation qa 
            WHERE qa.lead_id = l.lead_id 
              AND FIND_IN_SET(?, qa.assignee)
          )
        )
      `;
      values.push(userName, userName, userName);
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

    const parseNum = (val) => {
      if (val === undefined || val === null || val === '') return null;
      const cleanStr = String(val).replace(/[^0-9.-]/g, "");
      const num = parseFloat(cleanStr);
      return isNaN(num) ? null : num;
    };

    const parseDate = (val) => {
      if (!val || val === '' || val === 'null' || val === 'undefined') return null;
      if (typeof val === 'string' && val.includes('-')) {
        const parts = val.split('-');
        if (parts.length === 3 && parts[0].length === 2 && parts[2].length === 4) {
          return `${parts[2]}-${parts[1]}-${parts[0]}`;
        }
      }
      return val;
    };

    const parsedAmount = parseNum(amount);
    const parsedDiscount = parseNum(discount);
    const parsedTax = parseNum(tax);
    const parsedGrandTotal = parseNum(grand_total);
    const parsedQuotationDate = parseDate(quotation_date);

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
        parsedQuotationDate,
        activity_type || null,
        parsedAmount,
        parsedDiscount,
        parsedTax,
        parsedGrandTotal,
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
// UPDATE ASSIGNEE (WITH HISTORY LOG + DESCRIPTION)
// =============================

router.put(
  "/update-assignee/:lead_id",
  authenticateAndAuthorize(),
  upload.array("files", 5),
  async (req, res) => {
    try {
      const { assignee, description } = req.body;

      const lead_id = req.params.lead_id;

      if (!assignee) {
        return res.status(400).json({
          success: false,
          message: "Assignee required",
        });
      }

      const updatedBy =
        req.user?.username || req.user?.name || req.user?.email || "Unknown";

      const [quotationRows] = await db.promise().query(
        `SELECT id,
                  assignee,
                  assignee_log,
                  quotation_status
           FROM quotation
           WHERE lead_id = ?
           ORDER BY id DESC
           LIMIT 1`,
        [lead_id],
      );

      let quotationId = null;

      let logs = [];

      if (quotationRows.length > 0) {
        const quotation = quotationRows[0];

        quotationId = quotation.id;
        const currentStatus = quotation.quotation_status || "Pending";
        const nextStatus = currentStatus === "Sent" ? "Revision" : currentStatus;

        try {
          logs = quotation.assignee_log
            ? JSON.parse(quotation.assignee_log)
            : [];

          if (!Array.isArray(logs)) {
            logs = [];
          }
        } catch {
          logs = [];
        }

        const previousAssignee =
          logs.length > 0 ? logs[logs.length - 1].new_assignee : "";

        logs.push({
          previous_assignee: previousAssignee,
          new_assignee: assignee,
          changed_by: updatedBy,
          changed_at: new Date().toISOString(),
        });

        await db.promise().query(
          `UPDATE quotation
           SET assignee=?,
               updated_by=?,
               updated_at=CURRENT_TIMESTAMP,
               assignee_log=?,
               quotation_status=?
           WHERE id=?`,
          [assignee, updatedBy, JSON.stringify(logs), nextStatus, quotationId],
        );

        await db.promise().query(
          "UPDATE `lead` SET assignee=? WHERE lead_id=?",
          [assignee, lead_id]
        );
      } else {
        const [leadData] = await db.promise().query(
          `SELECT l.company_name,
                  l.customer_name,
                  l.reference,
                  COALESCE(ls.name, l.source) AS source
           FROM lead l
           LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
           WHERE l.lead_id=?`,
          [lead_id],
        );

        if (!leadData.length) {
          return res.status(404).json({
            success: false,
            message: "Lead not found",
          });
        }

        const lead = leadData[0];

        const initialLog = JSON.stringify([
          {
            previous_assignee: "",
            new_assignee: assignee,
            changed_by: updatedBy,
            changed_at: new Date().toISOString(),
          },
        ]);

        const [insertResult] = await db.promise().query(
          `INSERT INTO quotation
            (
              lead_id,
              company_name,
              customer_name,
              reference,
              source,
              quotation_status,
              assignee,
              updated_by,
              assignee_log
            )
            VALUES
            (?, ?, ?, ?, ?, 'Pending', ?, ?, ?)`,
          [
            lead_id,
            lead.company_name,
            lead.customer_name,
            lead.reference,
            lead.source || null,
            assignee,
            updatedBy,
            initialLog,
          ],
        );

        quotationId = insertResult.insertId;

        await db.promise().query(
          "UPDATE `lead` SET assignee=? WHERE lead_id=?",
          [assignee, lead_id]
        );
      }

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          await db.promise().query(
            `INSERT INTO quotation_assignee_files
            (
              quotation_id,
              filename,
              filepath,
              description,
              public_id
            )
            VALUES
            (?, ?, ?, ?, ?)`,
            [
              quotationId,
              file.originalname,
              file.path,
              description || null,
              file.filename || file.public_id || null,
            ],
          );
        }
      }

      res.json({
        success: true,
        message: "History stored successfully",
        assignee_history: logs,
      });
    } catch (err) {
      console.log(err);
      res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  },
);

// =============================
// UPDATE STATUS
// ✅ FIX: source pan quotation thi fetch kari PI ma insert karyo
// =============================

router.put("/update-status/:id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const { quotation_status } = req.body;
    const updatedBy =
      req.user?.username || req.user?.name || req.user?.email || "Unknown";

    if (quotation_status === "Approved") {

      // ✅ source pan fetch karo quotation ma thi
      const [qRow] = await db.promise().query(
        `SELECT 
          lead_id, 
          assignee, 
          customer_name, 
          quotation_no, 
          grand_total, 
          assignee_log,
          source
         FROM quotation WHERE id = ?`,
        [req.params.id]
      );

      if (qRow.length > 0) {
        const leadId          = qRow[0].lead_id;
        const currentAssignee = qRow[0].assignee || "";
        const customerName    = qRow[0].customer_name || null;
        const quotationNo     = qRow[0].quotation_no || null;  
        const grandTotal      = qRow[0].grand_total || 0;
        const source          = qRow[0].source || null;

        // Decline other quotations for this lead
        if (leadId) {
          await db.promise().query(
            "UPDATE quotation SET quotation_status = 'Declined' WHERE lead_id = ? AND id != ?",
            [leadId, req.params.id]
          );
        }

        // Find or assign user with Proforma invoices role
        let piUser = req.body.assigned_pi_user;
        if (piUser) {
          piUser = piUser.split(" ")[0];
        } else {
          const [piUsers] = await db.promise().query(
            "SELECT name FROM users WHERE role = 'Proforma invoices' LIMIT 1"
          );
          piUser = piUsers.length > 0
            ? (piUsers[0].name ? piUsers[0].name.split(" ")[0] : "Vruta")
            : "Vruta";
        }

        // Parse assignee log
        let logs = [];
        try {
          logs = qRow[0].assignee_log ? JSON.parse(qRow[0].assignee_log) : [];
          if (!Array.isArray(logs)) logs = [];
        } catch {
          logs = [];
        }

        logs.push({
          previous_assignee: currentAssignee,
          new_assignee: piUser,
          changed_by: updatedBy,
          changed_at: new Date().toISOString(),
        });

        // Update quotation assignee, assignee_log, status to Approved
        await db.promise().query(
          "UPDATE quotation SET assignee = ?, assignee_log = ?, quotation_status = 'Approved' WHERE id = ?",
          [piUser, JSON.stringify(logs), req.params.id]
        );

        // ✅ PI create karo source sathe
        const [existingPI] = await db.promise().query(
          "SELECT pi_id FROM proforma_invoices WHERE quotation_id = ?",
          [req.params.id]
        );

        if (existingPI.length === 0) {
          const piNo = quotationNo ? `PI-${quotationNo}` : `PI-${Date.now()}`;  // ✅ null safe
          await db.promise().query(
            `INSERT INTO proforma_invoices 
             (
               quotation_id, 
               pi_no, 
               pi_date, 
               customer_name, 
               quotation_no, 
               assignee, 
               source,
               total, 
               proforma_percentage, 
               status
             )
             VALUES (?, ?, CURRENT_DATE, ?, ?, ?, ?, ?, 0.00, 'draft')`,
            [
              req.params.id,
              piNo,
              customerName,
              quotationNo,
              piUser,
              source,       // ✅ source insert thay che heve
              grandTotal,
            ]
          );
        }

        // Update lead status to Won and assignee to piUser
        if (leadId) {
          await db.promise().query(
            "UPDATE `lead` SET status = 'Won', assignee = ? WHERE lead_id = ?",
            [piUser, leadId]
          );
        }
      }

    } else if (quotation_status === "Revision") {

      const [qRows] = await db.promise().query(
        "SELECT lead_id, assignee, assignee_log FROM quotation WHERE id = ?",
        [req.params.id]
      );

      if (qRows.length > 0) {
        const leadId = qRows[0].lead_id;
        const currentAssignee = qRows[0].assignee || "";

        const [estUsers] = await db.promise().query(
          "SELECT name FROM users WHERE role = 'Estimation' LIMIT 1"
        );
        const estUser = estUsers.length > 0 ? estUsers[0].name : "Khushali";

        let logs = [];
        try {
          logs = qRows[0].assignee_log ? JSON.parse(qRows[0].assignee_log) : [];
          if (!Array.isArray(logs)) logs = [];
        } catch {
          logs = [];
        }

        logs.push({
          previous_assignee: currentAssignee,
          new_assignee: estUser,
          changed_by: updatedBy,
          changed_at: new Date().toISOString(),
        });

        await db.promise().query(
          "UPDATE quotation SET assignee = ?, assignee_log = ?, quotation_status = ? WHERE id = ?",
          [estUser, JSON.stringify(logs), quotation_status, req.params.id]
        );

        if (leadId) {
          await db.promise().query(
            "UPDATE `lead` SET assignee = ? WHERE lead_id = ?",
            [estUser, leadId]
          );
        }
      }

    } else {
      await db.promise().query(
        "UPDATE quotation SET quotation_status = ? WHERE id = ?",
        [quotation_status, req.params.id]
      );
    }

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

    await db.promise().query("DELETE FROM quotation WHERE id = ?", [req.params.id]);

    if (deletedQuotation && deletedQuotation.quotation_status === "Approved") {
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

// =============================
// UPDATE MAIN STATUS
// =============================

router.put("/update-main-status/:id", async (req, res) => {
  try {
    await db.promise().query(
      "UPDATE quotation SET quotation_status = 'Won' WHERE id = ?",
      [req.params.id]
    );
    res.json({
      success: true,
      message: "Main quotation status updated successfully",
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =====================================
// GET COMPLETE QUOTATION DETAILS
// =====================================

router.get(
  "/full-details/:quotation_id",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const quotation_id = req.params.quotation_id;

      const [rows] = await db.promise().query(
        `
        SELECT
          q.id,
          q.lead_id,
          q.company_name,
          q.customer_name,
          q.reference,
          q.source,
          q.quotation_status,
          q.follow_up_date,
          q.quotation_no,
          q.quotation_date,
          q.grand_total,
          q.assignee,
          q.rate,
          q.discount,
          q.tax,
          q.amount,
          q.description,
          q.activity_type,
          q.proforma_percentage,
          q.updated_by,
          q.updated_at,
          q.created_at,

          l.status as lead_status,
          l.assignee as lead_assignee,

          (
            SELECT COUNT(*)
            FROM quotation q2
            WHERE q2.lead_id = q.lead_id
          ) as total_quotations

        FROM quotation q
        LEFT JOIN lead l ON l.lead_id = q.lead_id
        WHERE q.id = ?
        `,
        [quotation_id]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Quotation not found",
        });
      }

      res.json({ success: true, data: rows[0] });
    } catch (err) {
      console.log(err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

module.exports = router;