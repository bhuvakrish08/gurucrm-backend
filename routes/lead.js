const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");
const cloudinary = require("../utils/cloudinary");

const router = express.Router();
// 🚦 Traffic light thresholds from .env
const YELLOW_HOURS = parseFloat(process.env.YELLOW_HOURS) || 24;
const RED_HOURS = parseFloat(process.env.RED_HOURS) || 48;

/* =====================================
   READ ALL LEADS (for table listing)
===================================== */
router.get("/read", authenticateAndAuthorize(), (req, res) => {
  const loggedInRole = req.user.role;

  db.query(
    "SELECT name FROM users WHERE id = ?",
    [req.user.id],
    (err, uRows) => {
      let loggedInUser = req.user.username;
      if (!err && uRows && uRows.length > 0) {
        loggedInUser = uRows[0].name;
      }

      let sql = `
      SELECT 
    l.lead_id,
    l.company_name,
    l.customer_name,
    l.mobile_no,
    l.reference,
    COALESCE(ls.name, l.source) AS source,
    l.strategy_category_id,
    ssc.name AS strategy_category_name,
    ssc.code AS strategy_category_code,
    ssc.badge_background AS strategy_category_badge_bg,
    ssc.badge_text_color AS strategy_category_badge_text,
    l.assignee,
    l.location,
    l.architecture,
    l.status,
    l.lost_reason,
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
    ) AS next_follow_up_date,
    TIMESTAMPDIFF(HOUR,
      COALESCE(last_fu.last_followup_at, l.created_at),
      NOW()
    ) AS hours_since_last_activity,
    CASE
      WHEN l.status IN ('Won', 'Lost') THEN COALESCE(l.followup_status, 'green')
      WHEN l.followup_status = 'red' OR TIMESTAMPDIFF(SECOND,
        COALESCE(last_fu.last_followup_at, l.created_at),
        NOW()
      ) / 3600.0 >= ${RED_HOURS} THEN 'red'
      WHEN l.followup_status = 'yellow' OR TIMESTAMPDIFF(SECOND,
        COALESCE(last_fu.last_followup_at, l.created_at),
        NOW()
      ) / 3600.0 >= ${YELLOW_HOURS} THEN 'yellow'
      ELSE 'green'
    END AS follow_up_status
      FROM lead l
      LEFT JOIN inquiry_lead_source ls
        ON ls.id = l.source
      LEFT JOIN strategy_source_categories ssc
        ON ssc.id = l.strategy_category_id
      LEFT JOIN (
        SELECT lead_id, MAX(created_at) AS last_followup_at
        FROM lead_follow_up
        GROUP BY lead_id
      ) last_fu ON last_fu.lead_id = l.lead_id
    `;

      let values = [];

      if (
        loggedInRole !== "Admin" &&
        loggedInRole !== "Super Admin" &&
        loggedInRole !== "Leads Management" &&
        loggedInRole !== "Sales" &&
        loggedInRole !== "Estimation"
      ) {
        sql += `
        WHERE (FIND_IN_SET(?, REPLACE(l.assignee, ', ', ',')) OR l.created_by = ?)
      `;
        values.push(loggedInUser, loggedInUser);
      }

      sql += ` ORDER BY l.lead_id DESC`;

      db.query(sql, values, (err, result) => {
        if (err) {
          console.log(err);
          return res.status(500).json({ success: false, error: err });
        }
        res.json({ success: true, result });
      });
    },
  );
});

/* =====================================
   GET ALL LEADS (sales route)
===================================== */
router.get("/sales/leads", authenticateAndAuthorize(), (req, res) => {
  const loggedInUser = req.user.username;
  const loggedInRole = req.user.role;

  let sql = `
    SELECT
      l.lead_id,
      l.company_name,
      l.customer_name,
      l.mobile_no,
      l.reference,
      COALESCE(ls.name, l.source) AS source,
      l.strategy_category_id,
      ssc.name AS strategy_category_name,
      ssc.code AS strategy_category_code,
      ssc.badge_background AS strategy_category_badge_bg,
      ssc.badge_text_color AS strategy_category_badge_text,
      l.priority,
      l.assignee,
      l.status,
      l.lost_reason,
      lc.name AS category,
      l.description,
      l.created_at,
      l.updated_by,
      l.updated_at
    FROM lead l
    LEFT JOIN inquiry_lead_source ls ON ls.id = l.source
    LEFT JOIN inquiry_lead_category lc ON lc.id = l.category
    LEFT JOIN strategy_source_categories ssc ON ssc.id = l.strategy_category_id
    WHERE 1=1
  `;

  let values = [];

  if (
    loggedInRole !== "Admin" &&
    loggedInRole !== "Super Admin" &&
    loggedInRole !== "Leads Management" &&
    loggedInRole !== "Sales" &&
    loggedInRole !== "Estimation"
  ) {
    sql +=
      " AND (FIND_IN_SET(?, REPLACE(l.assignee, ', ', ',')) OR l.created_by = ?)";
    values.push(loggedInUser, loggedInUser);
  }

  sql += " ORDER BY l.lead_id DESC";

  db.query(sql, values, (err, result) => {
    if (err) {
      return res.status(500).json({ success: false, error: err });
    }
    res.json({ success: true, count: result.length, data: result });
  });
});

/* =====================================
   VIEW SINGLE LEAD DETAILS (for View Modal)
===================================== */
router.get(
  "/sales/leads/view-details/:id",
  authenticateAndAuthorize(),
  (req, res) => {
    const id = req.params.id;

    const sql = `
    SELECT
    l.lead_id,
    l.company_name,
    l.customer_name,
    l.mobile_no,
    l.reference,

    COALESCE(ls.name,l.source) AS source,
    l.strategy_category_id,
    ssc.name AS strategy_category_name,
    ssc.code AS strategy_category_code,
    ssc.badge_background AS strategy_category_badge_bg,
    ssc.badge_text_color AS strategy_category_badge_text,

    l.location,
    l.architecture,

    l.priority,
    l.assignee,

    lc.name AS category,

    l.description,
    l.status,
    l.lost_reason,

    l.created_at,
    l.updated_by,
    l.updated_at

FROM lead l

LEFT JOIN inquiry_lead_source ls
ON ls.id=l.source

LEFT JOIN inquiry_lead_category lc
ON lc.id=l.category

LEFT JOIN strategy_source_categories ssc
ON ssc.id=l.strategy_category_id

WHERE l.lead_id=?
  `;

    db.query(sql, [id], (err, result) => {
      if (err) {
        console.log(err);
        return res.status(500).json({ success: false, error: err });
      }
      if (!result || result.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Lead not found" });
      }
      res.json({ success: true, lead: result[0] });
    });
  },
);

/* =====================================
   VIEW SINGLE LEAD (for Edit page)
   ✅ FIXED: removed double comma after l.mobile_no
===================================== */
router.get(
  "/sales/leads/view-leads/:id",
  authenticateAndAuthorize(),
  (req, res) => {
    const id = req.params.id;

    const sql = `
    SELECT
    l.lead_id,
    l.company_name,
    l.customer_name,
    l.mobile_no,
    l.reference,
    l.source,
    l.strategy_category_id,
    ssc.name AS strategy_category_name,
    ssc.code AS strategy_category_code,
    l.location,
    l.architecture,
    l.priority,
    l.assignee,
    l.category,
    l.description,
    l.status,
    l.lost_reason,
    l.created_at
FROM lead l
LEFT JOIN strategy_source_categories ssc ON ssc.id = l.strategy_category_id
WHERE l.lead_id = ?
  `;

    db.query(sql, [id], (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: err });
      }
      if (!result || result.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Lead not found" });
      }
      res.json({ success: true, lead: result[0] });
    });
  },
);

/* =====================================
   UPDATE LEAD
===================================== */
router.put("/update/:id", authenticateAndAuthorize(), (req, res) => {
  const leadId = req.params.id;

  const {
    company_name,
    customer_name,
    mobile_no, // ✅ ADDED
    reference,
    source,
    strategy_category_id,
    location,
    architecture,
    status,
    priority,
    assignee,
    category,
    description,
  } = req.body;

  const updated_by = req.user.username;

  db.query(
    "SELECT status FROM lead WHERE lead_id = ?",
    [leadId],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ success: false, message: "Database error", error: err });
      }

      if (
        rows &&
        rows.length > 0 &&
        rows[0].status === "Won" &&
        status !== "Won" &&
        req.user.role !== "Admin" &&
        req.user.role !== "Super Admin"
      ) {
        return res.status(403).json({
          success: false,
          message: "Only Admin can change status after lead is Won",
        });
      }

      const sql = `
      UPDATE lead
      SET
company_name=?,
customer_name=?,
mobile_no=?,
reference=?,
source=?,
strategy_category_id=?,
location=?,
architecture=?,
status=?,
priority=?,
assignee=?,
category=?,
description=?,
updated_by=?,
        updated_at = CURRENT_TIMESTAMP
      WHERE lead_id = ?
    `;

      db.query(
        sql,
        [
company_name,
customer_name,
mobile_no,
reference,
source,
strategy_category_id ? Number(strategy_category_id) : null,
location,
architecture,
status,
priority,
assignee,
category,
description,
updated_by,
leadId
],
        (err, result) => {
          if (err) {
            console.error(err);
            return res
              .status(500)
              .json({
                success: false,
                message: "Error updating lead",
                error: err,
              });
          }

          // Resync closed quotations for this lead to reflect updated strategy category
          try {
            const scs = require("../services/StrategyCalculationService");
            db.query(
              "SELECT id FROM quotation WHERE lead_id = ? AND quotation_status IN ('Approved', 'Won')",
              [leadId],
              async (qErr, qRows) => {
                if (!qErr && qRows && qRows.length > 0) {
                  for (const q of qRows) {
                    await scs.syncWonQuotationContribution(q.id).catch(() => {});
                  }
                }
              }
            );
          } catch (syncErr) {
            console.error("Quotation sync error on lead update:", syncErr);
          }

          res.json({ success: true, message: "Lead updated successfully" });
        },
      );
    },
  );
});

/* =====================================
   ADD NEW LEAD
   ✅ FIXED: mobile_no added to INSERT
===================================== */
router.post("/insert", authenticateAndAuthorize(), (req, res) => {
  console.log("Incoming lead data:", req.body);

  const userName = req.user?.username || "Unknown User";

  const {
    company_name,
    customer_name,
    mobile_no,
    reference,
    source,
    strategy_category_id,
    location,
    architecture,
    status,
    priority,
    assignee,
    category,
    description,
  } = req.body;
  const sql = `
    INSERT INTO \`lead\`
    (
      company_name,
customer_name,
mobile_no,
reference,
source,
strategy_category_id,
location,
architecture,
status,
priority,
assignee,
category,
description,
created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    company_name,
    customer_name,
    mobile_no,
    reference,
    source,
    strategy_category_id ? Number(strategy_category_id) : null,
    location,
    architecture,
    status,
    priority,
    assignee,
    category,
    description,
    userName,
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("MYSQL INSERT ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Database insert failed",
        error: err.message,
      });
    }

    const activityMsg = `${userName} added a new lead: ${reference} for ${company_name || "N/A"}`;
    db.query(
      "INSERT INTO activities (message, user_name) VALUES (?, ?)",
      [activityMsg, userName],
      (actErr) => {
        if (actErr) console.error("Activity log error:", actErr);
      },
    );

    res.json({
      success: true,
      message: "Lead saved successfully",
      lead_id: result.insertId,
    });
  });
});

/* =====================================
   UPDATE STATUS ONLY
   ✅ UPDATED: Lost status now requires a lost_reason
   which gets saved to the `lost_reason` column.
===================================== */
router.put("/update-status/:id", authenticateAndAuthorize(), (req, res) => {
  const id = req.params.id;
  const { status, lost_reason } = req.body; // ✅ lost_reason added
  const loggedInRole = req.user.role;

  // ✅ Lost status requires a non-empty reason
  if (status === "Lost" && (!lost_reason || !lost_reason.trim())) {
    return res.status(400).json({
      success: false,
      message: "Lost reason is required",
    });
  }

  db.query("SELECT status FROM lead WHERE lead_id = ?", [id], (err, rows) => {
    if (err) {
      console.log(err);
      return res
        .status(500)
        .json({ success: false, message: "Database error", error: err });
    }

    if (
      rows &&
      rows.length > 0 &&
      rows[0].status === "Won" &&
      loggedInRole !== "Admin" &&
      loggedInRole !== "Super Admin"
    ) {
      return res.status(403).json({
        success: false,
        message: "Only Admin can change status after lead is Won",
      });
    }

    const updated_by = req.user.username;

    // Fetch elapsed hours using JOIN (no correlated subquery, float precision)
    db.query(
      `SELECT 
         l.assignee,
         l.followup_status,
         ROUND(
           TIMESTAMPDIFF(SECOND,
             COALESCE(last_fu.last_followup_at, l.created_at),
             NOW()
           ) / 3600.0, 5
         ) AS hours_elapsed
       FROM \`lead\` l
       LEFT JOIN (
         SELECT lead_id, MAX(created_at) AS last_followup_at
         FROM lead_follow_up GROUP BY lead_id
       ) last_fu ON last_fu.lead_id = l.lead_id
       WHERE l.lead_id = ?`,
      [id],
      (fetchErr, fetchRows) => {
        const hoursElapsed =
          !fetchErr && fetchRows && fetchRows[0]
            ? parseFloat(fetchRows[0].hours_elapsed || 0)
            : 0;
        const assigneeVal =
          !fetchErr && fetchRows && fetchRows[0]
            ? fetchRows[0].assignee || updated_by
            : updated_by;
        const storedColor =
          !fetchErr && fetchRows && fetchRows[0]
            ? fetchRows[0].followup_status || "green"
            : "green";

        let statusColor = "green";
        if (storedColor === "red" || hoursElapsed >= RED_HOURS)
          statusColor = "red";
        else if (storedColor === "yellow" || hoursElapsed >= YELLOW_HOURS)
          statusColor = "yellow";

        // Log the status update event
        db.query(
          `INSERT INTO lead_followup_status_log
           (lead_id, assignee, status_color, hours_elapsed, trigger_event)
           VALUES (?, ?, ?, ?, ?)`,
          [
            id,
            assigneeVal,
            statusColor,
            hoursElapsed,
            `status_updated_to_${status.toLowerCase()}`,
          ],
          (logErr) => {
            if (logErr)
              console.error("Traffic light status update log error:", logErr);
          },
        );

        let sql;
        let values;

        if (status === "Won") {
          sql = `
            UPDATE \`lead\`
            SET
              status = ?,
              assignee = ?,
              updated_by = ?,
              followup_status = ?,
              followup_status_updated_at = NOW(),
              won_at = NOW(),
              updated_at = CURRENT_TIMESTAMP
            WHERE lead_id = ?
          `;
          values = [
            status,
            "Khushali", // exact assignee name
            updated_by,
            statusColor,
            id,
          ];
        } else if (status === "Lost") {
          // ✅ NEW BRANCH — save lost_reason along with status
          sql = `
            UPDATE \`lead\`
            SET
              status = ?,
              lost_reason = ?,
              updated_by = ?,
              followup_status = ?,
              followup_status_updated_at = NOW(),
              updated_at = CURRENT_TIMESTAMP
            WHERE lead_id = ?
          `;
          values = [status, lost_reason.trim(), updated_by, statusColor, id];
        } else {
          sql = `
            UPDATE \`lead\`
            SET
              status = ?,
              updated_by = ?,
              followup_status = ?,
              followup_status_updated_at = NOW(),
              updated_at = CURRENT_TIMESTAMP
            WHERE lead_id = ?
          `;
          values = [status, updated_by, statusColor, id];
        }

        db.query(sql, values, (err, result) => {
          if (err) {
            console.log(err);
            return res.status(500).json({
              success: false,
              message: "Database error",
              error: err,
            });
          }

          res.json({
            success: true,
            message: "Status updated successfully",
          });
        });
      },
    );
  });
});

/* =====================================
   DELETE LEAD (with full cascading dependencies cleanup)
===================================== */
router.delete("/:id", authenticateAndAuthorize(), async (req, res) => {
  const leadId = req.params.id;

  try {
    await db.promise().query("START TRANSACTION");

    // 1. Check if lead exists
    const [lead] = await db
      .promise()
      .query("SELECT lead_id FROM `lead` WHERE lead_id = ?", [leadId]);
    if (lead.length === 0) {
      await db.promise().query("ROLLBACK");
      return res.status(404).json({ message: "Lead not found" });
    }

    // 2. Fetch all quotations linked to this lead
    const [quotations] = await db
      .promise()
      .query("SELECT id FROM quotation WHERE lead_id = ?", [leadId]);
    const quotationIds = quotations.map((q) => q.id);

    if (quotationIds.length > 0) {
      // 2a. Delete PI follow-up details
      await db
        .promise()
        .query(
          "DELETE FROM pi_follow_up WHERE pi_id IN (SELECT pi_id FROM proforma_invoices WHERE quotation_id IN (?))",
          [quotationIds],
        );

      // 2b. Delete proforma invoices
      await db
        .promise()
        .query("DELETE FROM proforma_invoices WHERE quotation_id IN (?)", [
          quotationIds,
        ]);

      // 2c. Fetch all projects associated with these quotations
      const [projects] = await db
        .promise()
        .query("SELECT id FROM project WHERE quotation_id IN (?)", [
          quotationIds,
        ]);
      const projectIds = projects.map((p) => p.id);

      if (projectIds.length > 0) {
        // Delete project architectures
        await db
          .promise()
          .query("DELETE FROM project_architecture WHERE project_id IN (?)", [
            projectIds,
          ]);
        // Delete project expenses
        await db
          .promise()
          .query("DELETE FROM project_expense WHERE project_id IN (?)", [
            projectIds,
          ]);
        // Delete projects
        await db
          .promise()
          .query("DELETE FROM project WHERE id IN (?)", [projectIds]);
      }

      // 2d. Fetch and delete quotation revisions & their files
      const [revisions] = await db
        .promise()
        .query("SELECT id FROM quotation_revision WHERE quotation_id IN (?)", [
          quotationIds,
        ]);
      const revisionIds = revisions.map((r) => r.id);

      if (revisionIds.length > 0) {
        await db
          .promise()
          .query(
            "DELETE FROM quotation_revision_files WHERE quotation_revision_id IN (?)",
            [revisionIds],
          );
        await db
          .promise()
          .query("DELETE FROM quotation_revision WHERE quotation_id IN (?)", [
            quotationIds,
          ]);
      }

      // 2e. Fetch and delete quotation files
      const [quotationFiles] = await db
        .promise()
        .query(
          "SELECT public_id FROM quotation_followup_files WHERE quot_follow_up_id IN (?)",
          [quotationIds],
        );
      for (const file of quotationFiles) {
        if (file.public_id) {
          try {
            const ext = file.file_name
              ? file.file_name.split(".").pop().toLowerCase()
              : "";
            const isRaw = !["jpg", "jpeg", "png", "pdf"].includes(ext);
            await cloudinary.uploader.destroy(file.public_id, {
              resource_type: isRaw ? "raw" : "image",
            });
          } catch (e) {
            console.log("Cloudinary destroy error:", e.message);
          }
        }
      }

      await db
        .promise()
        .query(
          "DELETE FROM quotation_followup_files WHERE quot_follow_up_id IN (?)",
          [quotationIds],
        );

      // 2f. Delete quotation splits
      await db
        .promise()
        .query("DELETE FROM quotation_splits WHERE quotation_id IN (?)", [
          quotationIds,
        ]);

      // 2g. Delete quotation traffic light logs
      await db
        .promise()
        .query(
          "DELETE FROM quotation_traffic_light_log WHERE quotation_id IN (?)",
          [quotationIds],
        );

      // 2h. Delete quotations
      try {
        const scs = require("../services/StrategyCalculationService");
        for (const qId of quotationIds) {
          await scs.removeQuotationContribution(qId);
        }
      } catch (strategyErr) {
        console.error(`[Strategy Sync Warning] Failed to remove strategy contributions on lead delete:`, strategyErr.message);
      }

      await db
        .promise()
        .query("DELETE FROM quotation WHERE lead_id = ?", [leadId]);
    }

    // 3. Delete lead follow ups and their files
    const [followUps] = await db
      .promise()
      .query("SELECT follow_up_id FROM lead_follow_up WHERE lead_id = ?", [
        leadId,
      ]);
    const followUpIds = followUps.map((f) => f.follow_up_id);

    if (followUpIds.length > 0) {
      await db
        .promise()
        .query("DELETE FROM lead_follow_up_files WHERE follow_up_id IN (?)", [
          followUpIds,
        ]);
    }

    await db
      .promise()
      .query("DELETE FROM lead_follow_up WHERE lead_id = ?", [leadId]);

    // 4. Delete lead follow-up status logs
    await db
      .promise()
      .query("DELETE FROM lead_followup_status_log WHERE lead_id = ?", [
        leadId,
      ]);

    // 5. Delete the lead itself
    await db.promise().query("DELETE FROM `lead` WHERE lead_id = ?", [leadId]);

    await db.promise().query("COMMIT");

    res.json({
      success: true,
      message:
        "Lead and all its associated quotations, PIs, projects, revisions, follow-ups, and logs deleted successfully",
    });
  } catch (err) {
    await db.promise().query("ROLLBACK");
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/* =====================================
   FILTER LEADS
===================================== */
router.get("/sales/leads/filter", authenticateAndAuthorize(), (req, res) => {
  const {
    company_name,
    customer_name,
    reference,
    source,
    mobile_no,
    status,
    from_created,
    to_created,
    from_followup,
    to_followup,
  } = req.query;

  const loggedInUser = req.user.username;
  const loggedInRole = req.user.role;

  let sql = `
    SELECT 
      l.lead_id,
      l.company_name,
      l.customer_name,
      l.mobile_no,
      l.reference,
      COALESCE(ls.name, l.source) AS source,
      l.strategy_category_id,
      ssc.name AS strategy_category_name,
      ssc.code AS strategy_category_code,
      ssc.badge_background AS strategy_category_badge_bg,
      ssc.badge_text_color AS strategy_category_badge_text,
      l.status,
      l.lost_reason,
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
      ) AS next_follow_up_date,
      TIMESTAMPDIFF(HOUR,
        COALESCE(last_fu.last_followup_at, l.created_at),
        NOW()
      ) AS hours_since_last_activity,
      CASE
        WHEN l.status IN ('Won', 'Lost') THEN COALESCE(l.followup_status, 'green')
        WHEN l.followup_status = 'red' OR TIMESTAMPDIFF(SECOND,
          COALESCE(last_fu.last_followup_at, l.created_at),
          NOW()
        ) / 3600.0 >= ${RED_HOURS} THEN 'red'
        WHEN l.followup_status = 'yellow' OR TIMESTAMPDIFF(SECOND,
          COALESCE(last_fu.last_followup_at, l.created_at),
          NOW()
        ) / 3600.0 >= ${YELLOW_HOURS} THEN 'yellow'
        ELSE 'green'
      END AS follow_up_status
    FROM lead l
    LEFT JOIN inquiry_lead_source ls
      ON ls.id = l.source
    LEFT JOIN strategy_source_categories ssc
      ON ssc.id = l.strategy_category_id
    LEFT JOIN (
      SELECT lead_id, MAX(created_at) AS last_followup_at
      FROM lead_follow_up
      GROUP BY lead_id
    ) last_fu ON last_fu.lead_id = l.lead_id
    WHERE 1=1
  `;

  let values = [];

  if (
    loggedInRole !== "Admin" &&
    loggedInRole !== "Super Admin" &&
    loggedInRole !== "Leads Management"
  ) {
    sql +=
      " AND (FIND_IN_SET(?, REPLACE(l.assignee, ', ', ',')) OR l.created_by = ?)";
    values.push(loggedInUser, loggedInUser);
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
  if (source) {
    sql += " AND l.source = ?";
    values.push(source);
  }
  if (mobile_no) {
    sql += " AND FIND_IN_SET(?, l.mobile_no)";
    values.push(mobile_no);
  }
  if (status) {
    sql += " AND l.status = ?";
    values.push(status);
  }

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

  if (from_followup && to_followup) {
    sql += `
      AND (SELECT f.follow_up_date FROM lead_follow_up f WHERE f.lead_id = l.lead_id ORDER BY f.follow_up_date DESC LIMIT 1)
      BETWEEN ? AND ?
    `;
    values.push(from_followup, to_followup);
  } else if (from_followup) {
    sql += `
      AND (SELECT f.follow_up_date FROM lead_follow_up f WHERE f.lead_id = l.lead_id ORDER BY f.follow_up_date DESC LIMIT 1)
      >= ?
    `;
    values.push(from_followup);
  } else if (to_followup) {
    sql += `
      AND (SELECT f.follow_up_date FROM lead_follow_up f WHERE f.lead_id = l.lead_id ORDER BY f.follow_up_date DESC LIMIT 1)
      <= ?
    `;
    values.push(to_followup);
  }

  sql += " ORDER BY l.lead_id DESC";

  db.query(sql, values, (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ success: false, error: err });
    }
    res.json({ success: true, data: result });
  });
});

/* =====================================
   GET CUSTOMER LIST FOR FILTER
===================================== */
router.get("/sales/leads/customers", authenticateAndAuthorize(), (req, res) => {
  const sql = `
    SELECT DISTINCT customer_name
    FROM lead
    WHERE customer_name IS NOT NULL AND customer_name != ''
    ORDER BY customer_name ASC
  `;

  db.query(sql, (err, result) => {
    if (err) {
      console.log(err);
      return res.status(500).json({ success: false, error: err });
    }
    res.json({ success: true, data: result });
  });
});

/* =====================================
   GET TRAFFIC LIGHT ANALYTICS DATA
===================================== */
router.get(
  "/analytics/traffic-light",
  authenticateAndAuthorize(),
  (req, res) => {
    const sql = `
    SELECT 
      assignee,
      SUM(CASE WHEN status_color = 'green' THEN 1 ELSE 0 END) AS green_count,
      SUM(CASE WHEN status_color = 'yellow' THEN 1 ELSE 0 END) AS yellow_count,
      SUM(CASE WHEN status_color = 'red' THEN 1 ELSE 0 END) AS red_count,
      AVG(hours_elapsed) AS avg_hours_elapsed,
      COUNT(*) AS total_logs
    FROM lead_followup_status_log
    GROUP BY assignee
  `;
    db.query(sql, (err, result) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ success: false, error: err });
      }
      res.json({ success: true, result });
    });
  },
);

module.exports = router;
