const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

// =======================
// CREATE ACTIVITY
// =======================
router.post("/insert-event", authenticateAndAuthorize(), (req, res) => {
  console.log("🔥 /insert-event hit");
  console.log("Body:", req.body);
  console.log("User:", req.user);

  if (!req.user || !req.user.id) {
    return res.status(401).json({ message: "Unauthorized: user not found in token" });
  }

  const { title, description, activity_date, activity_time, assignee, priority, status } = req.body;

  if (!title || !activity_date || !activity_time) {
    return res.status(400).json({
      message: "title, activity_date, and activity_time are required",
      received: { title, activity_date, activity_time },
    });
  }

  const created_by = req.user.id;
  const finalStatus = status || "Pending";
  const finalAssignee = Array.isArray(assignee)
    ? assignee.join(",")
    : assignee || String(req.user.id);

  const insertQuery = `
    INSERT INTO calendar_activities 
      (title, description, activity_date, activity_time, assignee, priority, created_by, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    title,
    description || null,
    activity_date,
    activity_time,
    finalAssignee,
    priority || null,
    created_by,
    finalStatus,
  ];

  console.log("📦 Insert values:", values);

  db.query(insertQuery, values, (err, result) => {
    if (err) {
      console.error("❌ Insert DB error:", err);
      return res.status(500).json({ message: "DB insert error", error: err.message });
    }

    console.log("✅ Inserted ID:", result.insertId);

    const fetchQuery = `SELECT ca.* FROM calendar_activities ca WHERE ca.id = ?`;

    db.query(fetchQuery, [result.insertId], (err2, rows) => {
      if (err2) {
        console.error("❌ Fetch DB error:", err2);
        return res.status(500).json({ message: "DB fetch error", error: err2.message });
      }

      return res.status(201).json({
        message: "Event created successfully",
        event: rows[0],
      });
    });
  });
});

// =======================
// GET LIST ACTIVITY
// =======================
router.get("/list", authenticateAndAuthorize(), (req, res) => {
  let sql;
  let values = [];

  if (req.user.role === "Admin") {
    sql = `
      SELECT
        c.*,
        u.name AS assignee_name
      FROM calendar_activities c
      LEFT JOIN users u ON c.assignee = u.id
      ORDER BY c.activity_date ASC, c.activity_time ASC
    `;
  } else {
    sql = `
      SELECT
        c.*,
        u.name AS assignee_name
      FROM calendar_activities c
      LEFT JOIN users u ON c.assignee = u.id
      WHERE c.assignee = ?
      ORDER BY c.activity_date ASC, c.activity_time ASC
    `;
    values.push(req.user.id);
  }

  db.query(sql, values, (err, rows) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    return res.json({
      success: true,
      data: rows,
    });
  });
});

// =======================
// GET SINGLE ACTIVITY
// =======================
router.get("/:id", authenticateAndAuthorize(), (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid activity ID",
    });
  }

  db.query(
    `SELECT * FROM calendar_activities WHERE id = ?`,
    [id],
    (err, rows) => {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Activity not found",
        });
      }

      return res.json({
        success: true,
        data: rows[0],
      });
    }
  );
});

// =======================
// UPDATE ACTIVITY
// =======================
router.put("/:id", authenticateAndAuthorize(), (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid activity ID",
    });
  }

  const { title, description, activity_date, activity_time, assignee, priority, status } = req.body;

  if (!title || !activity_date || !activity_time || !assignee) {
    return res.status(400).json({
      success: false,
      message: "Title, activity_date, activity_time, and assignee are required",
    });
  }

  db.query(
    `UPDATE calendar_activities
     SET
       title = ?,
       description = ?,
       activity_date = ?,
       activity_time = ?,
       assignee = ?,
       priority = ?,
       status = ?
     WHERE id = ?`,
    [
      title,
      description || null,
      activity_date,
      activity_time,
      assignee,
      priority || null,
      status || "Pending",
      id,
    ],
    (err, result) => {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Activity not found",
        });
      }

      return res.json({
        success: true,
        message: "Activity updated successfully",
      });
    }
  );
});

// =======================
// DELETE ACTIVITY
// =======================
router.delete("/:id", authenticateAndAuthorize(), (req, res) => {
  const { id } = req.params;

  if (!id || isNaN(id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid activity ID",
    });
  }

  db.query(
    `SELECT id FROM calendar_activities WHERE id = ?`,
    [id],
    (err, rows) => {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      if (!rows || rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Activity not found",
        });
      }

      db.query(
        `DELETE FROM calendar_activities WHERE id = ?`,
        [id],
        (deleteErr, result) => {
          if (deleteErr) {
            console.error("Delete Error:", deleteErr);
            return res.status(500).json({
              success: false,
              message: "Database error",
              error: deleteErr.message,
            });
          }

          if (result.affectedRows === 0) {
            return res.status(404).json({
              success: false,
              message: "Activity not found",
            });
          }

          return res.json({
            success: true,
            message: "Activity deleted successfully",
          });
        }
      );
    }
  );
});

// =======================
// UPDATE STATUS
// =======================
router.put("/status/:id", authenticateAndAuthorize(), (req, res) => {
  const activityId = parseInt(req.params.id);
  const { status } = req.body;

  // Validation
  if (!activityId || isNaN(activityId)) {
    return res.status(400).json({
      success: false,
      message: "Valid activity ID is required",
    });
  }
  
  if (!status || status.trim() === "") {
    return res.status(400).json({
      success: false,
      message: "Status is required",
    });
  }

  const sql = `
    UPDATE calendar_activities
    SET status = ?
    WHERE id = ?
  `;

  db.query(sql, [status, activityId], (err, result) => {
    if (err) {
      console.error("Update Status Error:", err);

      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Activity not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Status updated successfully",
      data: {
        id: activityId,
        status,
      },
    });
  });
});

module.exports = router;