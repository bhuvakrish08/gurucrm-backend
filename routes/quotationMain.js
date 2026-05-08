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

router.get("/read", async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT 
        l.lead_id, 
        l.company_name, 
        l.customer_name, 
        l.lead_title, 
        l.status as lead_status,
        q.id as latest_quotation_id,
        q.quotation_no,
        q.quotation_date,
        q.quotation_status,
        q.grand_total,
        q.amount,
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
// ✅ updated_by = logged-in user name
// ✅ updated_at = CURRENT_TIMESTAMP (auto)
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
        lead_title,
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

      // ✅ Get logged-in user name from JWT token
      const updatedBy =
        req.user?.username ||
        req.user?.name ||
        req.user?.email ||
        "Unknown";

      // =============================
      // INSERT QUOTATION
      // ✅ updated_by saves who inserted
      // ✅ updated_at saves CURRENT_TIMESTAMP
      // =============================

      const [result] = await db.promise().query(
        `INSERT INTO quotation 
         (
          lead_id,
          company_name,
          customer_name,
          lead_title,
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
          lead_title || null,
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
          updatedBy, // ✅ logged-in user name saved on INSERT
        ]
      );

      const quotationId = result.insertId;

      // =============================
      // SAVE FILES
      // =============================

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

      // =============================
      // ACTIVITY LOG (SAFE)
      // =============================

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
        updated_by: updatedBy, // ✅ Return to frontend for display
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

router.get("/filter", async (req, res) => {
  try {
    const {
      company_name,
      customer_name,
      lead_title,
      assignee,
      quotation_status,
      from_date,
      to_date,
    } = req.query;

    let sql = `
      SELECT 
        l.lead_id, 
        l.company_name, 
        l.customer_name, 
        l.lead_title, 
        l.status as lead_status,
        q.id as latest_quotation_id,
        q.quotation_no,
        q.quotation_date,
        q.quotation_status,
        q.grand_total,
        q.amount,
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

    if (company_name) {
      sql += " AND l.company_name LIKE ?";
      values.push(`%${company_name}%`);
    }
    if (customer_name) {
      sql += " AND l.customer_name LIKE ?";
      values.push(`%${customer_name}%`);
    }
    if (lead_title) {
      sql += " AND l.lead_title LIKE ?";
      values.push(`%${lead_title}%`);
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
// ✅ updated_by = logged-in user name (je edit kare te)
// ✅ updated_at = CURRENT_TIMESTAMP (auto set)
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

    // ✅ Get logged-in user name from JWT token
    // Je user login hoi ene naam UPDATE THAASHE - ALWAYS
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
        updatedBy, // ✅ logged-in user name saved on UPDATE
        req.params.id,
      ]
    );

    // ✅ Activity log for update too
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
      updated_by: updatedBy, // ✅ Return to frontend
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

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

module.exports = router;