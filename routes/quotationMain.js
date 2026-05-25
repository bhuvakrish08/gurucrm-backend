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
// UPDATE ASSIGNEE (WITH HISTORY LOG)
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

      // Check if any quotations exist for this lead
      const [existingQuotations] = await db.promise().query(
        "SELECT id, assignee, assignee_log FROM quotation WHERE lead_id = ? ORDER BY id DESC LIMIT 1",
        [lead_id]
      );

      if (existingQuotations && existingQuotations.length > 0) {
        const latestQuotation = existingQuotations[0];
        const previousAssignee = latestQuotation.assignee || "";

        // Parse existing log
        let assigneeLog = [];
        try {
          if (latestQuotation.assignee_log) {
            assigneeLog = JSON.parse(latestQuotation.assignee_log);
            if (!Array.isArray(assigneeLog)) assigneeLog = [];
          }
        } catch (e) {
          assigneeLog = [];
        }

        // Push new log entry
        assigneeLog.push({
          previous_assignee: previousAssignee,
          new_assignee: assignee || "",
          changed_by: updatedBy,
          changed_at: new Date().toISOString(),
        });

        const updatedLog = JSON.stringify(assigneeLog);

        // Update all other quotations for this lead (without log)
        await db.promise().query(
          `UPDATE quotation SET 
            assignee = ?,
            updated_by = ?,
            updated_at = CURRENT_TIMESTAMP
           WHERE lead_id = ? AND id != ?`,
          [assignee || null, updatedBy, lead_id, latestQuotation.id]
        );

        // Update latest quotation with log
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
        // No quotation — fetch lead info and create minimal quotation with log
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

// =============================
// UPDATE MAIN STATUS
// =============================

router.put("/update-main-status/:id", async (req, res) => {
  try {
    // ONLY latest quotation convert to WON
    await db
      .promise()
      .query("UPDATE quotation SET quotation_status = 'Won' WHERE id = ?", [
        req.params.id,
      ]);

    res.json({
      success: true,
      message: "Main quotation status updated successfully",
    });
  } catch (err) {
    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
});

module.exports = router;