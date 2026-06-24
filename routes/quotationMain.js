const express = require("express");
const db = require("../db");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const router = express.Router();

const YELLOW_HOURS = parseFloat(process.env.YELLOW_HOURS || "24");
const RED_HOURS = parseFloat(process.env.RED_HOURS || "48");
// =============================
// ASSIGNEE ROLE VALIDATION HELPER
// =============================
async function validateAssignee(assignee, assignerRole) {
  if (!assignee) return null;
  const assigneeName = String(assignee).trim();
  if (!assigneeName) return null;

  const [userRows] = await db
    .promise()
    .query(
      "SELECT role, name FROM users WHERE SUBSTRING_INDEX(name, ' ', 1) = ? AND status = 1",
      [assigneeName],
    );

  if (userRows.length === 0) {
    const [userRowsFull] = await db
      .promise()
      .query("SELECT role, name FROM users WHERE name = ? AND status = 1", [
        assigneeName,
      ]);
    if (userRowsFull.length === 0) {
      return `Assignee user "${assigneeName}" not found or inactive`;
    }
    userRows.push(...userRowsFull);
  }

  const targetRole = userRows[0].role;
  if (targetRole === "Super Admin") {
    return "Cannot assign to Super Admin";
  }

  if (assignerRole === "Sales" && targetRole !== "Estimation") {
    return "Sales users can only assign Estimation users";
  }
  if (assignerRole === "Estimation" && targetRole !== "Sales") {
    return "Estimation users can only assign Sales users";
  }

  return null;
}

async function resolveUserName(assigneeName) {
  if (!assigneeName) return "";
  const name = String(assigneeName).trim();
  if (!name) return "";

  const [rows1] = await db
    .promise()
    .query(
      "SELECT name FROM users WHERE SUBSTRING_INDEX(name, ' ', 1) = ? AND status = 1",
      [name],
    );
  if (rows1.length > 0) return rows1[0].name;

  const [rows2] = await db
    .promise()
    .query("SELECT name FROM users WHERE name = ? AND status = 1", [name]);
  if (rows2.length > 0) return rows2[0].name;

  return name;
}

// =============================
// CLOUDINARY STORAGE
// =============================

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    const isRaw = !["jpg", "jpeg", "png", "pdf"].includes(ext);
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1E9);
    const nameWithoutExt = file.originalname.substring(0, file.originalname.lastIndexOf("."));
    const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9]/g, "_");
    const publicId = isRaw ? `${cleanName}-${uniqueSuffix}.${ext}` : `${cleanName}-${uniqueSuffix}`;
    return {
      folder: "crm/quotations",
      resource_type: isRaw ? "raw" : "auto",
      public_id: publicId,
    };
  },
});

const IMAGE_EXT = ["jpg", "jpeg", "png"];
const EXCEL_EXT = ["xlsx", "xls", "csv", "excel"];
const CAD_EXT = ["dwg", "dxf"];
const DOC_EXT = ["pdf", "txt", "doc", "docx"];

const MAX_DOC_SIZE = 5 * 1024 * 1024;

const upload = multer({
  storage,
  limits: { fileSize: MAX_DOC_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();
    if (![...IMAGE_EXT, ...EXCEL_EXT, ...CAD_EXT, ...DOC_EXT].includes(ext)) {
      return cb(new Error("Unsupported file type"), false);
    }
    cb(null, true);
  },
});


async function logQuotationTrafficLight(lead_id, quotation_id, role_type, assignee) {
  if (!lead_id) return;
  try {
    let hours = 0;
    let color = 'green';
    if (role_type === 'Estimation') {
      let startTime = null;
      if (quotation_id) {
        const [qRows] = await db.promise().query('SELECT estimation_assigned_at FROM quotation WHERE id = ?', [quotation_id]);
        if (qRows.length > 0 && qRows[0].estimation_assigned_at) {
          startTime = qRows[0].estimation_assigned_at;
        }
      }
      if (!startTime) {
        const [lRows] = await db.promise().query('SELECT won_at FROM lead WHERE lead_id = ?', [lead_id]);
        if (lRows.length > 0 && lRows[0].won_at) {
          startTime = lRows[0].won_at;
        }
      }
      if (startTime) {
        const [diffQuery] = await db.promise().query('SELECT TIMESTAMPDIFF(SECOND, ?, NOW()) / 3600.0 as hrs', [startTime]);
        hours = diffQuery[0].hrs || 0;
      }
    } else if (role_type === 'Sales' && quotation_id) {
      const [qRows] = await db.promise().query('SELECT sales_assigned_at, quotation_status, follow_up_date, updated_at FROM quotation WHERE id = ?', [quotation_id]);
      if (qRows.length > 0) {
        const q = qRows[0];
        let startTime = q.sales_assigned_at;
        if (q.quotation_status === 'Sent') {
          if (q.follow_up_date) {
            const fuDate = new Date(q.follow_up_date);
            fuDate.setHours(0, 0, 0, 0);
            startTime = fuDate;
          } else {
            startTime = q.updated_at;
          }
        }
        if (startTime) {
          const [diffQuery] = await db.promise().query('SELECT TIMESTAMPDIFF(SECOND, ?, NOW()) / 3600.0 as hrs', [startTime]);
          hours = diffQuery[0].hrs || 0;
        }
      }
    }

    if (hours >= RED_HOURS) color = 'red';
    else if (hours >= YELLOW_HOURS) color = 'yellow';

    await db.promise().query(
      'INSERT INTO quotation_traffic_light_log (lead_id, quotation_id, role_type, assignee, status_color, hours_elapsed) VALUES (?, ?, ?, ?, ?, ?)',
      [lead_id, quotation_id || null, role_type, assignee || 'Unknown', color, hours]
    );
  } catch (e) {
    console.error('Traffic Light Log Error:', e);
  }
}

async function getUserRoleMap() {
  try {
    const [rows] = await db.promise().query("SELECT name, role FROM users");
    const roleMap = {};
    rows.forEach(r => {
      if (r.name) {
        const fullName = r.name.toLowerCase().trim();
        roleMap[fullName] = r.role;  // full name e.g. "darshil shah"
        const firstName = fullName.split(' ')[0];
        if (firstName && !roleMap[firstName]) {
          roleMap[firstName] = r.role; // first name e.g. "darshil"
        }
      }
    });
    return roleMap;
  } catch (err) {
    console.error('getUserRoleMap Error:', err);
    return {};
  }
}


function determineStage(assignee, roleMap) {
  if (!assignee) return 'Estimation';
  const names = assignee.split(',').map(n => n.trim().toLowerCase());
  for (const name of names) {
    const role = roleMap[name];
    if (role === 'Estimation') return 'Estimation';
  }
  for (const name of names) {
    const role = roleMap[name];
    if (role === 'Sales') return 'Sales';
  }
  return 'Estimation';
}

function validateUploadedFiles(req) {
  if (!req.files) return null;

  for (const file of req.files) {
    const ext = file.originalname.split(".").pop().toLowerCase();

    if (EXCEL_EXT.includes(ext)) {
      if (file.size > 2 * 1024 * 1024) {
        return `Excel file "${file.originalname}" size should be less than 2MB`;
      }
    } else if (CAD_EXT.includes(ext)) {
      if (file.size > 5 * 1024 * 1024) {
        return `CAD file "${file.originalname}" size should be less than 5MB`;
      }
    } else if (IMAGE_EXT.includes(ext)) {
      if (file.size > 5 * 1024 * 1024) {
        return `Image file "${file.originalname}" size should be less than 5MB`;
      }
    } else if (DOC_EXT.includes(ext)) {
      if (file.size > 5 * 1024 * 1024) {
        return `Document file "${file.originalname}" size should be less than 5MB`;
      }
    }
  }

  return null;
}

// =============================
// READ ALL QUOTATIONS
// =============================

router.get("/read", authenticateAndAuthorize(), async (req, res) => {
  try {
    let loggedInFullName = "";
    if (req.user?.id) {
      const [uRows] = await db
        .promise()
        .query("SELECT name FROM users WHERE id = ?", [req.user.id]);
      if (uRows.length > 0) {
        loggedInFullName = uRows[0].name;
      }
    }
    const userName =
      loggedInFullName ||
      req.user?.username ||
      req.user?.name ||
      req.user?.email ||
      "";

    const userRole = req.user?.role;
    const isAdminOrSuper = [
      "Admin",
      "Super Admin",
      "Sales",
      "Estimation",
      "Leads Management",
    ].includes(userRole);

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
          IF(q_approved.approved_count > 0, 1, 0) AS has_approved,
          l.won_at,
          q.sales_assigned_at,
          q.estimation_assigned_at,
          q.estimation_assigned_at
        FROM lead l
        LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
        LEFT JOIN (
          SELECT q1.*
          FROM quotation q1
          INNER JOIN (
            SELECT lead_id, 
                   MAX(id) as max_id
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
          IF(q_approved.approved_count > 0, 1, 0) AS has_approved,
          l.won_at,
          q.sales_assigned_at,
          q.estimation_assigned_at,
          q.estimation_assigned_at
        FROM lead l
        LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
        LEFT JOIN (
          SELECT q1.*
          FROM quotation q1
          INNER JOIN (
            SELECT lead_id, 
                   MAX(id) as max_id
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
        [userName, userName, userName],
      );
    }
    // Compute quotation_dot_color for each row
    const roleMap = await getUserRoleMap();
    const now = new Date();
    const enrichedRows = rows.map(row => {
      let activeColor = 'green';
      const status = row.quotation_status || 'Pending';
      const stage = determineStage(row.assignee, roleMap);

      if (['Won', 'Lost', 'Approved'].includes(status)) {
        activeColor = 'green';
      } else if (status === 'Revision') {
        // Revision + Estimation assignee: always GREEN (fresh restart, Khushali working on it)
        // Revision + Sales assignee: clock-based from sales_assigned_at (24h → yellow, 48h → red)
        if (stage === 'Estimation') {
          activeColor = 'green';
        } else {
          const startTime = row.sales_assigned_at;
          if (startTime) {
            const elapsed = (now - new Date(startTime)) / (1000 * 3600);
            if (elapsed >= RED_HOURS) activeColor = 'red';
            else if (elapsed >= YELLOW_HOURS) activeColor = 'yellow';
            else activeColor = 'green';
          } else {
            activeColor = 'green';
          }
        }
      } else if (status === 'Pending') {
        // Pending: Estimation clock from won_at, Sales clock from sales_assigned_at
        let startTime = null;
        if (stage === 'Estimation') {
          startTime = row.won_at;
        } else {
          startTime = row.sales_assigned_at;
        }

        if (startTime) {
          const elapsed = (now - new Date(startTime)) / (1000 * 3600);
          if (elapsed >= RED_HOURS) activeColor = 'red';
          else if (elapsed >= YELLOW_HOURS) activeColor = 'yellow';
          else activeColor = 'green';
        } else {
          activeColor = 'green';
        }
      } else if (status === 'Sent') {
        let startTime = null;
        if (row.follow_up_date) {
          const fuDate = new Date(row.follow_up_date);
          fuDate.setHours(0, 0, 0, 0);
          if (now > fuDate) {
            startTime = fuDate;
          }
        } else {
          startTime = row.updated_at || row.sales_assigned_at;
        }

        if (startTime) {
          const elapsed = (now - new Date(startTime)) / (1000 * 3600);
          if (elapsed >= RED_HOURS) activeColor = 'red';
          else if (elapsed >= YELLOW_HOURS) activeColor = 'yellow';
          else activeColor = 'green';
        } else {
          activeColor = 'green';
        }
      }
      return { ...row, quotation_dot_color: activeColor };
    });

    // Fetch worst-case logged status color ONLY for completed stages
    // Active stages (Pending/Sent/Revision) show fresh active clock - no log inheritance
    for (const row of enrichedRows) {
      if (!['Won', 'Lost', 'Approved'].includes(row.quotation_status)) continue;
      try {
        const [logRows] = await db.promise().query(
          `SELECT status_color FROM quotation_traffic_light_log 
           WHERE lead_id = ? 
           ORDER BY created_at DESC 
           LIMIT 1`,
          [row.lead_id]
        );
        if (logRows.length > 0) {
          const loggedColor = logRows[0].status_color;
          const activeColor = row.quotation_dot_color || 'green';
          let finalColor = 'green';
          if (activeColor === 'red' || loggedColor === 'red') finalColor = 'red';
          else if (activeColor === 'yellow' || loggedColor === 'yellow') finalColor = 'yellow';
          row.quotation_dot_color = finalColor;
        }
      } catch (e) { /* ignore */ }
    }

    res.json({ success: true, result: enrichedRows });
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
    const [rows] = await db
      .promise()
      .query(
        `SELECT q.*, 
                qs.amount_9, qs.amount_18, qs.tax_percent_9, qs.tax_percent_18, qs.tax_9, qs.tax_18, qs.grand_total as split_grand_total
         FROM quotation q
         LEFT JOIN quotation_splits qs ON q.id = qs.quotation_id
         WHERE q.lead_id = ? 
         ORDER BY q.id DESC`,
        [req.params.lead_id],
      );
    res.json({ success: true, result: rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// GET QUOTATION SPLIT
// =============================
router.get("/split/:quotation_id", async (req, res) => {
  try {
    const [rows] = await db
      .promise()
      .query("SELECT * FROM quotation_splits WHERE quotation_id = ?", [
        req.params.quotation_id,
      ]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "No split found" });
    }
    res.json({ success: true, split: rows[0] });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// GET ASSIGNEE LOG FOR A LEAD
// =============================

router.get(
  "/assignee-log/:lead_id",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const lead_id = req.params.lead_id;

      const [rows] = await db.promise().query(
        `SELECT assignee_log FROM quotation 
       WHERE lead_id = ?`,
        [lead_id],
      );

      let combinedLog = [];
      const seen = new Set();

      for (const row of rows) {
        if (row.assignee_log) {
          try {
            const parsed = JSON.parse(row.assignee_log);
            if (Array.isArray(parsed)) {
              for (const entry of parsed) {
                const uniqueKey = `${entry.changed_at}_${entry.new_assignee}`;
                if (!seen.has(uniqueKey)) {
                  seen.add(uniqueKey);
                  combinedLog.push(entry);
                }
              }
            }
          } catch (e) {
            // ignore row parsing errors
          }
        }
      }

      // Sort descending (latest first)
      combinedLog.sort(
        (a, b) => new Date(b.changed_at) - new Date(a.changed_at),
      );

      res.json({ success: true, log: combinedLog });
    } catch (err) {
      console.log("GET ASSIGNEE LOG ERROR:", err);
      res.status(500).json({ success: false, message: err.message });
    }
  },
);

// =============================
// INSERT QUOTATION + FILES
// =============================

router.post(
  "/insert",
  authenticateAndAuthorize(),
  upload.array("files", 5),
  async (req, res) => {
    try {
      const sizeError = validateUploadedFiles(req);
      if (sizeError) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            if (file.filename || file.public_id) {
              const ext = file.originalname ? file.originalname.split(".").pop().toLowerCase() : "";
              const isRaw = !["jpg", "jpeg", "png", "pdf"].includes(ext);
              await cloudinary.uploader.destroy(file.filename || file.public_id, {
                resource_type: isRaw ? "raw" : "image"
              });
            }
          }
        }
        return res.status(400).json({ success: false, message: sizeError });
      }
      let {
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
        amount_9,
        amount_18,
        tax_percent_9,
        tax_percent_18,
        tax_9,
        tax_18,
      } = req.body;

      const updatedBy =
        req.user?.username || req.user?.name || req.user?.email || "Unknown";

      let prevAssignee = "";
      if (lead_id) {
        const [prevQuotation] = await db.promise().query(
          `SELECT assignee FROM quotation
           WHERE lead_id = ?
           ORDER BY id DESC
           LIMIT 1`,
          [lead_id],
        );
        if (prevQuotation.length > 0) {
          prevAssignee = prevQuotation[0].assignee || "";
        } else {
          const [leadRows] = await db
            .promise()
            .query("SELECT assignee FROM lead WHERE lead_id = ?", [lead_id]);
          if (leadRows.length > 0) {
            prevAssignee = leadRows[0].assignee || "";
          }
        }
      }

      if (quotation_status === "Revision") {
        const [estUsers] = await db.promise().query(
          "SELECT name FROM users WHERE role = 'Estimation' LIMIT 1"
        );
        assignee = estUsers.length > 0 ? estUsers[0].name : "Khushali";
      }

      const resolvedAssignee = await resolveUserName(assignee);
      const resolvedPrevAssignee = await resolveUserName(prevAssignee);

      const normalizeName = (name) =>
        String(name || "")
          .trim()
          .toLowerCase();
      if (
        assignee &&
        normalizeName(resolvedAssignee) !== normalizeName(resolvedPrevAssignee)
      ) {
        const assigneeErr = await validateAssignee(assignee, req.user?.role);
        if (assigneeErr) {
          return res.status(400).json({ success: false, message: assigneeErr });
        }
      }

      // Get lead's source
      let source = null;
      if (lead_id) {
        const [leadRows] = await db.promise().query(
          `SELECT COALESCE(ls.name, l.source) AS source 
           FROM lead l 
           LEFT JOIN inquiry_lead_source ls ON ls.id = l.source 
           WHERE l.lead_id = ?`,
          [lead_id],
        );
        if (leadRows.length > 0) {
          source = leadRows[0].source;
        }
      }

      // Safe Numeric Parser
      const parseNum = (val) => {
        if (val === undefined || val === null || val === "") return null;
        const cleanStr = String(val).replace(/[^0-9.-]/g, "");
        const num = parseFloat(cleanStr);
        return isNaN(num) ? null : num;
      };

      // Safe Date Parser
      const parseDate = (val) => {
        if (!val || val === "" || val === "null" || val === "undefined")
          return null;
        if (typeof val === "string" && val.includes("-")) {
          const parts = val.split("-");
          if (
            parts.length === 3 &&
            parts[0].length === 2 &&
            parts[2].length === 4
          ) {
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

      const parsedAmount9 = parseNum(amount_9 || 0);
      const parsedAmount18 = parseNum(amount_18 || 0);
      const parsedTaxPercent9 = parseNum(tax_percent_9 !== undefined ? tax_percent_9 : 9);
      const parsedTaxPercent18 = parseNum(tax_percent_18 !== undefined ? tax_percent_18 : 18);
      const parsedTax9 = parseNum(tax_9 || 0);
      const parsedTax18 = parseNum(tax_18 || 0);

      let assigneeLog = [];
      if (lead_id) {
        const [prevQuotation] = await db.promise().query(
          `SELECT assignee_log, assignee FROM quotation
           WHERE lead_id = ?
           ORDER BY id DESC
           LIMIT 1`,
          [lead_id],
        );
        if (prevQuotation.length > 0) {
          try {
            assigneeLog = prevQuotation[0].assignee_log
              ? JSON.parse(prevQuotation[0].assignee_log)
              : [];
            if (!Array.isArray(assigneeLog)) assigneeLog = [];
          } catch (e) {
            assigneeLog = [];
          }

          const prevAssignee = prevQuotation[0].assignee || "";
          if (assignee && assignee !== prevAssignee) {
            assigneeLog.push({
              previous_assignee: prevAssignee,
              new_assignee: assignee,
              changed_by: updatedBy,
              changed_at: new Date().toISOString(),
              description: "Assigned upon quotation creation",
              files: [],
            });
          }
        } else {
          if (assignee) {
            assigneeLog.push({
              previous_assignee: "",
              new_assignee: assignee,
              changed_by: updatedBy,
              changed_at: new Date().toISOString(),
              description: "Assigned upon quotation creation",
              files: [],
            });
          }
        }
      }


      const roleMap = await getUserRoleMap();
      const stage = determineStage(assignee, roleMap);
      let salesAssignedAt = null;
      let estimationAssignedAt = null;
      if (stage === 'Sales') {
        salesAssignedAt = new Date();
      } else {
        estimationAssignedAt = new Date();
      }
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
          assignee_log,
          updated_at,
          sales_assigned_at,
          estimation_assigned_at
         )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?)`,
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
          assigneeLog.length > 0 ? JSON.stringify(assigneeLog) : null,
          salesAssignedAt,
          estimationAssignedAt,
        ],
      );

      const quotationId = result.insertId;

      if (parsedAmount9 > 0 || parsedAmount18 > 0) {
        await db.promise().query(
          `INSERT INTO quotation_splits 
           (quotation_id, amount_9, amount_18, tax_percent_9, tax_percent_18, tax_9, tax_18, grand_total) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            quotationId,
            parsedAmount9,
            parsedAmount18,
            parsedTaxPercent9,
            parsedTaxPercent18,
            parsedTax9,
            parsedTax18,
            parsedGrandTotal || 0,
          ]
        );
      }

      // Log Estimation Traffic Light: only if phase is completed (i.e. assigned to Sales)
      if (stage === 'Sales') {
        await logQuotationTrafficLight(lead_id, quotationId, 'Estimation', req.user?.name || updatedBy);
      }

      if (quotation_status === "Revision" && lead_id) {
        await db.promise().query(
          "UPDATE `lead` SET assignee = ? WHERE lead_id = ?",
          [assignee, lead_id]
        );
      }

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
          [fileValues],
        );
      }

      try {
        const userName =
          req.user?.username ||
          req.user?.name ||
          req.user?.email ||
          "Unknown User";

        const activityMsg = `${userName} created quotation ${quotation_no}`;

        await db
          .promise()
          .query("INSERT INTO activities (message, user_name) VALUES (?, ?)", [
            activityMsg,
            userName,
          ]);
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
  },
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
      const [uRows] = await db
        .promise()
        .query("SELECT name FROM users WHERE id = ?", [req.user.id]);
      if (uRows.length > 0) {
        loggedInFullName = uRows[0].name;
      }
    }
    const userName =
      loggedInFullName ||
      req.user?.username ||
      req.user?.name ||
      req.user?.email ||
      "";
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
        IF(q_approved.approved_count > 0, 1, 0) AS has_approved,
        l.won_at,
          q.sales_assigned_at,
          q.estimation_assigned_at,
          q.estimation_assigned_at
      FROM lead l
      LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
      LEFT JOIN (
        SELECT q1.*
        FROM quotation q1
        INNER JOIN (
          SELECT lead_id, 
                 MAX(id) as max_id
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
      if (quotation_status === "Won") {
        sql += " AND (q.quotation_status = 'Approved' OR q.quotation_status = 'Won')";
      } else if (quotation_status === "Pending") {
        sql += " AND (q.quotation_status IS NULL OR q.quotation_status = 'Pending' OR q.quotation_status = 'Declined')";
      } else {
        sql += " AND q.quotation_status = ?";
        values.push(quotation_status);
      }
    }
    if (from_date && to_date) {
      sql += " AND DATE(l.created_at) BETWEEN ? AND ?";
      values.push(from_date, to_date);
    }

    sql += " ORDER BY l.lead_id DESC";

    const [rows] = await db.promise().query(sql, values);

    // Compute quotation_dot_color for each row
    const roleMap = await getUserRoleMap();
    const now = new Date();
    const enrichedRows = rows.map(row => {
      let activeColor = 'green';
      const status = row.quotation_status || 'Pending';
      const stage = determineStage(row.assignee, roleMap);

      if (['Won', 'Lost', 'Approved'].includes(status)) {
        activeColor = 'green';
      } else if (status === 'Revision') {
        // Revision + Estimation assignee: always GREEN (fresh restart, Khushali working on it)
        // Revision + Sales assignee: clock-based from sales_assigned_at (24h → yellow, 48h → red)
        if (stage === 'Estimation') {
          activeColor = 'green';
        } else {
          const startTime = row.sales_assigned_at;
          if (startTime) {
            const elapsed = (now - new Date(startTime)) / (1000 * 3600);
            if (elapsed >= RED_HOURS) activeColor = 'red';
            else if (elapsed >= YELLOW_HOURS) activeColor = 'yellow';
            else activeColor = 'green';
          } else {
            activeColor = 'green';
          }
        }
      } else if (status === 'Pending') {
        // Pending: Estimation clock from won_at, Sales clock from sales_assigned_at
        let startTime = null;
        if (stage === 'Estimation') {
          startTime = row.won_at;
        } else {
          startTime = row.sales_assigned_at;
        }

        if (startTime) {
          const elapsed = (now - new Date(startTime)) / (1000 * 3600);
          if (elapsed >= RED_HOURS) activeColor = 'red';
          else if (elapsed >= YELLOW_HOURS) activeColor = 'yellow';
          else activeColor = 'green';
        } else {
          activeColor = 'green';
        }
      } else if (status === 'Sent') {
        let startTime = null;
        if (row.follow_up_date) {
          const fuDate = new Date(row.follow_up_date);
          fuDate.setHours(0, 0, 0, 0);
          if (now > fuDate) {
            startTime = fuDate;
          }
        } else {
          startTime = row.updated_at || row.sales_assigned_at;
        }

        if (startTime) {
          const elapsed = (now - new Date(startTime)) / (1000 * 3600);
          if (elapsed >= RED_HOURS) activeColor = 'red';
          else if (elapsed >= YELLOW_HOURS) activeColor = 'yellow';
          else activeColor = 'green';
        } else {
          activeColor = 'green';
        }
      }
      return { ...row, quotation_dot_color: activeColor };
    });

    // Fetch worst-case logged status color ONLY for completed stages
    // Active stages (Pending/Sent/Revision) show fresh active clock - no log inheritance
    for (const row of enrichedRows) {
      if (!['Won', 'Lost', 'Approved'].includes(row.quotation_status)) continue;
      try {
        const [logRows] = await db.promise().query(
          `SELECT status_color FROM quotation_traffic_light_log 
           WHERE lead_id = ? 
           ORDER BY created_at DESC 
           LIMIT 1`,
          [row.lead_id]
        );
        if (logRows.length > 0) {
          const loggedColor = logRows[0].status_color;
          const activeColor = row.quotation_dot_color || 'green';
          let finalColor = 'green';
          if (activeColor === 'red' || loggedColor === 'red') finalColor = 'red';
          else if (activeColor === 'yellow' || loggedColor === 'yellow') finalColor = 'yellow';
          row.quotation_dot_color = finalColor;
        }
      } catch (e) { /* ignore */ }
    }

    res.json({ success: true, data: enrichedRows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// UPDATE QUOTATION DATA
// =============================

router.put(
  "/update/:id",
  authenticateAndAuthorize(),
  upload.array("files", 5),
  async (req, res) => {
    try {
      const {
        quotation_no,
        quotation_date,
        activity_type,
        quotation_status,
        amount,
        discount,
        tax,
        grand_total,
        description,
        assignee,
        amount_9,
        amount_18,
        tax_percent_9,
        tax_percent_18,
        tax_9,
        tax_18,
      } = req.body;

      const updatedBy =
        req.user?.username || req.user?.name || req.user?.email || "Unknown";

      let prevAssignee = "";
      const [currentQuotation] = await db
        .promise()
        .query("SELECT assignee FROM quotation WHERE id = ?", [req.params.id]);
      if (currentQuotation.length > 0) {
        prevAssignee = currentQuotation[0].assignee || "";
      }

      const resolvedAssignee = await resolveUserName(assignee);
      const resolvedPrevAssignee = await resolveUserName(prevAssignee);

      const normalizeName = (name) =>
        String(name || "")
          .trim()
          .toLowerCase();
      if (
        assignee &&
        normalizeName(resolvedAssignee) !== normalizeName(resolvedPrevAssignee)
      ) {
        const assigneeErr = await validateAssignee(assignee, req.user?.role);
        if (assigneeErr) {
          return res.status(400).json({ success: false, message: assigneeErr });
        }
      }

      const parseNum = (val) => {
        if (val === undefined || val === null || val === "") return null;
        const cleanStr = String(val).replace(/[^0-9.-]/g, "");
        const num = parseFloat(cleanStr);
        return isNaN(num) ? null : num;
      };

      const parseDate = (val) => {
        if (!val || val === "" || val === "null" || val === "undefined")
          return null;
        if (typeof val === "string" && val.includes("-")) {
          const parts = val.split("-");
          if (
            parts.length === 3 &&
            parts[0].length === 2 &&
            parts[2].length === 4
          ) {
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
      const parsedAmount9 = parseNum(amount_9 || 0);
      const parsedAmount18 = parseNum(amount_18 || 0);
      const parsedTaxPercent9 = parseNum(tax_percent_9 !== undefined ? tax_percent_9 : 9);
      const parsedTaxPercent18 = parseNum(tax_percent_18 !== undefined ? tax_percent_18 : 18);
      const parsedTax9 = parseNum(tax_9 || 0);
      const parsedTax18 = parseNum(tax_18 || 0);

      await db.promise().query(
        `UPDATE quotation SET 
        quotation_no = ?, 
        quotation_date = ?, 
        activity_type = ?, 
        quotation_status = ?,
        amount = ?, 
        discount = ?, 
        tax = ?, 
        grand_total = ?, 
        description = ?, 
        assignee = ?,
        assignee_log = COALESCE(?, assignee_log),
        updated_by = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
        [
          quotation_no || null,
          parsedQuotationDate,
          activity_type || null,
          quotation_status || "Pending",
          parsedAmount,
          parsedDiscount,
          parsedTax,
          parsedGrandTotal,
          description || null,
          assignee || null,
          null, // for assignee_log
          updatedBy,
          req.params.id,
        ],
      );

      // Handle split details insertion or update
      if (parsedAmount9 > 0 || parsedAmount18 > 0) {
        const [existingSplit] = await db.promise().query(
          "SELECT id FROM quotation_splits WHERE quotation_id = ?",
          [req.params.id]
        );

        if (existingSplit.length > 0) {
          await db.promise().query(
            `UPDATE quotation_splits SET 
             amount_9 = ?, amount_18 = ?, tax_percent_9 = ?, tax_percent_18 = ?, tax_9 = ?, tax_18 = ?, grand_total = ?
             WHERE quotation_id = ?`,
            [
              parsedAmount9,
              parsedAmount18,
              parsedTaxPercent9,
              parsedTaxPercent18,
              parsedTax9,
              parsedTax18,
              parsedGrandTotal || 0,
              req.params.id,
            ]
          );
        } else {
          await db.promise().query(
            `INSERT INTO quotation_splits 
             (quotation_id, amount_9, amount_18, tax_percent_9, tax_percent_18, tax_9, tax_18, grand_total) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              req.params.id,
              parsedAmount9,
              parsedAmount18,
              parsedTaxPercent9,
              parsedTaxPercent18,
              parsedTax9,
              parsedTax18,
              parsedGrandTotal || 0,
            ]
          );
        }
      }

      try {
        const userName =
          req.user?.username ||
          req.user?.name ||
          req.user?.email ||
          "Unknown User";

        const activityMsg = `${userName} updated quotation ${quotation_no}`;

        await db
          .promise()
          .query("INSERT INTO activities (message, user_name) VALUES (?, ?)", [
            activityMsg,
            userName,
          ]);
      } catch (activityErr) {
        console.log("Activity Log Error:", activityErr.message);
      }

      // Save files if uploaded
      if (req.files && req.files.length > 0) {
        const fileValues = req.files.map((file) => [
          req.params.id,
          file.originalname,
          file.path,
          file.filename || file.public_id || null,
        ]);

        await db.promise().query(
          `INSERT INTO quotation_followup_files 
         (quot_follow_up_id, file_name, file_path, public_id)
         VALUES ?`,
          [fileValues],
        );
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
  },
);

// =============================
// UPDATE ASSIGNEE (WITH HISTORY LOG + DESCRIPTION)
// =============================

router.put(
  "/update-assignee/:lead_id",
  authenticateAndAuthorize(),
  upload.array("files", 5),
  async (req, res) => {
    try {
      const sizeError = validateUploadedFiles(req);
      if (sizeError) {
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            if (file.filename || file.public_id) {
              const ext = file.originalname ? file.originalname.split(".").pop().toLowerCase() : "";
              const isRaw = !["jpg", "jpeg", "png", "pdf"].includes(ext);
              await cloudinary.uploader.destroy(file.filename || file.public_id, {
                resource_type: isRaw ? "raw" : "image"
              });
            }
          }
        }
        return res.status(400).json({ success: false, message: sizeError });
      }
      const { assignee, description } = req.body;

      const lead_id = req.params.lead_id;

      if (!assignee) {
        return res.status(400).json({
          success: false,
          message: "Assignee required",
        });
      }

      const assigneeErr = await validateAssignee(assignee, req.user?.role);
      if (assigneeErr) {
        return res.status(400).json({ success: false, message: assigneeErr });
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
        const nextStatus =
          currentStatus === "Sent" ? "Revision" : currentStatus;

        // Fetch and merge logs from ALL quotations for this lead
        const [allQuotations] = await db
          .promise()
          .query(`SELECT assignee_log FROM quotation WHERE lead_id = ?`, [
            lead_id,
          ]);

        const seen = new Set();
        for (const qRow of allQuotations) {
          if (qRow.assignee_log) {
            try {
              const parsed = JSON.parse(qRow.assignee_log);
              if (Array.isArray(parsed)) {
                for (const entry of parsed) {
                  const uniqueKey = `${entry.changed_at}_${entry.new_assignee}`;
                  if (!seen.has(uniqueKey)) {
                    seen.add(uniqueKey);
                    logs.push(entry);
                  }
                }
              }
            } catch (e) { }
          }
        }

        logs.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

        const uploadedFiles = [];
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            uploadedFiles.push({
              file_name: file.originalname,
              file_path: file.path,
            });
          }
        }

        const previousAssignee =
          logs.length > 0 ? logs[logs.length - 1].new_assignee : "";

        logs.push({
          previous_assignee: previousAssignee,
          new_assignee: assignee,
          changed_by: updatedBy,
          changed_at: new Date().toISOString(),
          description: description || null,
          files: uploadedFiles,
        });

        await db.promise().query(
          `UPDATE quotation
           SET assignee=?,
               updated_by=?,
               updated_at=CURRENT_TIMESTAMP,
               assignee_log=?,
               quotation_status=?,
               sales_assigned_at=NOW()
           WHERE id=?`,
          [assignee, updatedBy, JSON.stringify(logs), nextStatus, quotationId],
        );

        await db
          .promise()
          .query("UPDATE `lead` SET assignee=? WHERE lead_id=?", [
            assignee,
            lead_id,
          ]);
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

        const uploadedFiles = [];
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            uploadedFiles.push({
              file_name: file.originalname,
              file_path: file.path,
            });
          }
        }

        const initialLogObj = [
          {
            previous_assignee: "",
            new_assignee: assignee,
            changed_by: updatedBy,
            changed_at: new Date().toISOString(),
            description: description || null,
            files: uploadedFiles,
          },
        ];

        logs = initialLogObj;
        const initialLog = JSON.stringify(initialLogObj);

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

        await db
          .promise()
          .query("UPDATE `lead` SET assignee=? WHERE lead_id=?", [
            assignee,
            lead_id,
          ]);
      }

      if (req.files && req.files.length > 0) {
        for (const file of req.files) {
          await db.promise().query(
            `INSERT INTO quotation_followup_files
            (
              quot_follow_up_id,
              file_name,
              file_path,
              public_id
            )
            VALUES
            (?, ?, ?, ?)`,
            [
              quotationId,
              file.originalname,
              file.path,
              file.filename || file.public_id || null,
            ],
          );
        }
      }

      // Log traffic light for the role that just completed their task
      const assignerRole = req.user?.role || '';
      if (assignerRole === 'Estimation') {
        await logQuotationTrafficLight(lead_id, quotationId, 'Estimation', req.user?.name || updatedBy);
      } else if (assignerRole === 'Sales') {
        await logQuotationTrafficLight(lead_id, quotationId, 'Sales', req.user?.name || updatedBy);
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
// ✅ BUG FIX: PI insert માં VALUES array ને columns સાથે correct match કર્યો
//    - CURRENT_DATE, 0.00, 'draft' hardcoded છે → 3 ? ઓછા
//    - grandTotal હવે સાચા 'total' slot પર insert થાય છે
//    - reference હવે સાચા 'reference' slot પર insert થાય છે
// =============================

// =============================
// UPDATE STATUS
// ✅ FIXED: Approved block માં project insert add કર્યો
// ✅ FIXED: Won block પણ project insert સાથે કામ કરે છે
// =============================

router.put("/update-status/:id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const { quotation_status } = req.body;
    const updatedBy =
      req.user?.username || req.user?.name || req.user?.email || "Unknown";

    const isKhushaliEstimation =
      req.user?.role === "Estimation" &&
      req.user?.username?.toLowerCase().startsWith("khushali");

    if (
      isKhushaliEstimation &&
      (quotation_status === "Approved" || quotation_status === "Declined")
    ) {
      return res.status(403).json({
        success: false,
        message: "Estimation users are not authorized to approve or decline quotations.",
      });
    }

    // ============================================================
    // ✅ APPROVED BLOCK
    // ============================================================
    if (quotation_status === "Approved") {
      const [qRow] = await db.promise().query(
        `SELECT
    q.lead_id,
    q.assignee,
    q.customer_name,
    q.quotation_no,
    q.company_name,
    q.reference,
    q.source,
    q.quotation_date,
    COALESCE(qs.grand_total, q.grand_total) AS grand_total,
    COALESCE(qs.amount_9 + qs.amount_18, q.amount) AS amount,

    qs.amount_9,
    qs.amount_18,
    qs.tax_9,
    qs.tax_18,

    q.assignee_log
  FROM quotation q
  LEFT JOIN quotation_splits qs ON q.id = qs.quotation_id
  WHERE q.id = ?`,
        [req.params.id]
      );

      if (qRow.length > 0) {
        const leadId = qRow[0].lead_id;
        const currentAssignee = qRow[0].assignee || "";
        const customerName = qRow[0].customer_name || null;
        const quotationNo = qRow[0].quotation_no || null;
        
        const grandTotal = qRow[0].grand_total || 0;
        const amount = qRow[0].amount || 0;
        const source = qRow[0].source || null;
        const amount9 = qRow[0].amount_9 || 0;
        const amount18 = qRow[0].amount_18 || 0;

        const tax9 = qRow[0].tax_9 || 0;
        const tax18 = qRow[0].tax_18 || 0;

        const total9 = amount9 + tax9;
        const total18 = amount18 + tax18;
        const reference = qRow[0].reference || null;
        const companyName = qRow[0].company_name || null;
        const quotationDate = qRow[0].quotation_date || null;

        // Decline other quotations for this lead
        if (leadId) {
          await db.promise().query(
            "UPDATE quotation SET quotation_status = 'Declined' WHERE lead_id = ? AND id != ?",
            [leadId, req.params.id],
          );
        }

        // Find Proforma Invoice user
        let piUser = req.body.assigned_pi_user;
        if (piUser) {
          piUser = piUser.split(" ")[0];
        } else {
          const [piUsers] = await db.promise().query(
            "SELECT name FROM users WHERE role = 'Proforma invoices' LIMIT 1",
          );
          piUser =
            piUsers.length > 0
              ? piUsers[0].name
                ? piUsers[0].name.split(" ")[0]
                : "Vruta"
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
          description: null,
          files: [],
        });




        // Log completed Sales phase BEFORE reassigning to PI user
        await logQuotationTrafficLight(
          leadId,
          parseInt(req.params.id),
          "Sales",
          currentAssignee || updatedBy,
        );

        // Update quotation → Approved + new assignee
        await db.promise().query(
          "UPDATE quotation SET assignee = ?, assignee_log = ?, quotation_status = 'Approved' WHERE id = ?",
          [piUser, JSON.stringify(logs), req.params.id],
        );

        // ✅ Create Proforma Invoice if not exists — WITH quotation_splits data
        const [existingPI] = await db.promise().query(
          "SELECT pi_id FROM proforma_invoices WHERE quotation_id = ?",
          [req.params.id],
        );

        if (existingPI.length === 0) {
          const piNo = quotationNo ? `PI-${quotationNo}` : `PI-${Date.now()}`;

          await db.promise().query(
            `INSERT INTO proforma_invoices 
              (quotation_id, pi_no, pi_date, customer_name, quotation_no, assignee, source, reference,
               total, amount_9, amount_18, tax_9, tax_18, total_9, total_18, proforma_percentage, status)
              VALUES (?, ?, CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.00, 'draft')`,
            [
              req.params.id,
              piNo,
              customerName,
              quotationNo,
              piUser,
              source,
              reference,
              grandTotal,   // total = grand_total
              amount9,
              amount18,
              tax9,
              tax18,
              total9,
              total18,
            ],
          );
          console.log("✅ Proforma Invoice created with splits data for quotation:", req.params.id);
        }

        // Update lead → Won + assignee = piUser
        if (leadId) {
          await db.promise().query(
            "UPDATE `lead` SET status = 'Won', assignee = ? WHERE lead_id = ?",
            [piUser, leadId],
          );
        }

        // ✅ PROJECT TABLE INSERT
        if (leadId) {
          const [existingProject] = await db.promise().query(
            "SELECT id FROM project WHERE quotation_id = ?",
            [req.params.id],
          );

          if (existingProject.length === 0) {
            await db.promise().query(
              `INSERT INTO project (
                quotation_id,
                company_name,
                customer_name,
                reference,
                source,
                quotation_no,
                quotation_date,
                grand_total,
                amount,
                architecture_net_amount,
                expense_net_amount,
                net_revenue_amount
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                req.params.id,
                companyName,
                customerName,
                reference,
                source,
                quotationNo,
                quotationDate,
                grandTotal,
                amount,
                0,
                0,
                amount,
              ],
            );
            console.log("✅ Project created from Approved quotation:", req.params.id);
          } else {
            console.log("ℹ️ Project already exists for quotation:", req.params.id);
          }
        }
      }

      // ============================================================
      // REVISION BLOCK
      // ============================================================
    } else if (quotation_status === "Revision") {
      const [qRows] = await db.promise().query(
        "SELECT lead_id, assignee, assignee_log FROM quotation WHERE id = ?",
        [req.params.id],
      );

      if (qRows.length > 0) {
        const leadId = qRows[0].lead_id;
        const currentAssignee = qRows[0].assignee || "";

        const [estUsers] = await db.promise().query(
          "SELECT name FROM users WHERE role = 'Estimation' LIMIT 1",
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
          description: null,
          files: [],
        });

        await logQuotationTrafficLight(
          leadId,
          parseInt(req.params.id),
          "Sales",
          currentAssignee || updatedBy,
        );

        await db.promise().query(
          "UPDATE quotation SET assignee = ?, assignee_log = ?, quotation_status = ?, estimation_assigned_at = NOW(), sales_assigned_at = NULL WHERE id = ?",
          [estUser, JSON.stringify(logs), quotation_status, req.params.id],
        );

        if (leadId) {
          await db.promise().query(
            "UPDATE `lead` SET assignee = ? WHERE lead_id = ?",
            [estUser, leadId],
          );
        }
      }

      // ============================================================
      // OTHER STATUS (Pending, Sent, Lost, Won direct)
      // ============================================================
    } else {
      await db.promise().query(
        "UPDATE quotation SET quotation_status = ? WHERE id = ?",
        [quotation_status, req.params.id],
      );

      if (quotation_status && quotation_status.trim().toLowerCase() === "won") {
        const [quotationRows] = await db.promise().query(
          `SELECT q.id, q.company_name, q.customer_name, q.reference, q.source, q.quotation_no, q.quotation_date, 
                  COALESCE(qs.grand_total, q.grand_total) AS grand_total, 
                  COALESCE(qs.amount_9 + qs.amount_18, q.amount) AS amount
           FROM quotation q
           LEFT JOIN quotation_splits qs ON q.id = qs.quotation_id
           WHERE q.id = ?`,
          [req.params.id],
        );

        if (quotationRows.length > 0) {
          const quotation = quotationRows[0];

          const [projectRows] = await db.promise().query(
            "SELECT id FROM project WHERE quotation_id = ?",
            [quotation.id],
          );

          if (projectRows.length === 0) {
            await db.promise().query(
              `INSERT INTO project (
                quotation_id,
                company_name,
                customer_name,
                reference,
                source,
                quotation_no,
                quotation_date,
                grand_total,
                amount,
                architecture_net_amount,
                expense_net_amount,
                net_revenue_amount
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                quotation.id,
                quotation.company_name,
                quotation.customer_name,
                quotation.reference,
                quotation.source,
                quotation.quotation_no,
                quotation.quotation_date,
                quotation.grand_total,
                quotation.amount || 0,
                0,
                0,
                quotation.amount || 0,
              ],
            );
            console.log("✅ Project Created from Won quotation:", quotation.id);
          }
        }
      }

      if (["Sent", "Won", "Lost"].includes(quotation_status)) {
        try {
          const [qInfo] = await db.promise().query(
            "SELECT lead_id, assignee FROM quotation WHERE id = ?",
            [req.params.id],
          );
          if (qInfo.length > 0) {
            await logQuotationTrafficLight(
              qInfo[0].lead_id,
              parseInt(req.params.id),
              "Sales",
              qInfo[0].assignee || updatedBy,
            );
          }
        } catch (e) {
          console.error("Traffic light log error (status update):", e);
        }
      }
    }

    res.json({ success: true, message: "Status updated successfully" });
  } catch (err) {
    console.error("UPDATE STATUS ERROR:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});


// =============================
// GET FILES FOR A QUOTATION
// =============================

router.get("/files/:id", async (req, res) => {
  try {
    const [files] = await db
      .promise()
      .query(
        "SELECT * FROM quotation_followup_files WHERE quot_follow_up_id = ?",
        [req.params.id],
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
    await db.promise().query("START TRANSACTION");

    const [qRow] = await db
      .promise()
      .query("SELECT lead_id, quotation_status FROM quotation WHERE id = ?", [
        req.params.id,
      ]);
    const deletedQuotation = qRow[0];

    // Fetch and delete associated project if it exists
    const [projects] = await db
      .promise()
      .query("SELECT id FROM project WHERE quotation_id = ?", [req.params.id]);
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length > 0) {
      await db
        .promise()
        .query("DELETE FROM project_architecture WHERE project_id IN (?)", [projectIds]);
      await db
        .promise()
        .query("DELETE FROM project_expense WHERE project_id IN (?)", [projectIds]);
      await db
        .promise()
        .query("DELETE FROM project WHERE id IN (?)", [projectIds]);
    }

    const [files] = await db
      .promise()
      .query(
        "SELECT public_id FROM quotation_followup_files WHERE quot_follow_up_id = ?",
        [req.params.id],
      );

    for (const file of files) {
      if (file.public_id) {
        try {
          const ext = file.file_name ? file.file_name.split(".").pop().toLowerCase() : "";
          const isRaw = !["jpg", "jpeg", "png", "pdf"].includes(ext);
          await cloudinary.uploader.destroy(file.public_id, {
            resource_type: isRaw ? "raw" : "image"
          });
        } catch (e) {
          console.log("Cloudinary delete error:", e.message);
        }
      }
    }

    await db
      .promise()
      .query(
        "DELETE FROM quotation_followup_files WHERE quot_follow_up_id = ?",
        [req.params.id],
      );

    await db
      .promise()
      .query("DELETE FROM quotation WHERE id = ?", [req.params.id]);

    if (deletedQuotation && deletedQuotation.quotation_status === "Approved") {
      await db
        .promise()
        .query(
          "UPDATE quotation SET quotation_status = 'Pending' WHERE lead_id = ?",
          [deletedQuotation.lead_id],
        );
    }

    await db.promise().query("COMMIT");
    res.json({ success: true, message: "Quotation and all associated projects deleted successfully" });
  } catch (err) {
    await db.promise().query("ROLLBACK");
    console.log(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// UPDATE MAIN STATUS
// =============================

router.put("/update-main-status/:id", async (req, res) => {
  try {
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
          ) as total_quotations,

          qs.amount_9,
          qs.amount_18,
          qs.tax_percent_9,
          qs.tax_percent_18,
          qs.tax_9,
          qs.tax_18,
          qs.grand_total as split_grand_total

        FROM quotation q
        LEFT JOIN lead l ON l.lead_id = q.lead_id
        LEFT JOIN quotation_splits qs ON q.id = qs.quotation_id
        WHERE q.id = ?
        `,
        [quotation_id],
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
  },
);

module.exports = router;
