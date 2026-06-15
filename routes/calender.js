const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

// =======================
// CREATE ACTIVITY
// =======================
router.post("/create", authenticateAndAuthorize(), async (req, res) => {
  try {
    const {
      title,
      description,
      activity_date,
      activity_time,
      assignee,
      priority,
    } = req.body;

    const created_by = req.user.id;

    const [result] = await db.query(
      `INSERT INTO calendar_activities
      (
        title,
        description,
        activity_date,
        activity_time,
        assignee,
        priority,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        description,
        activity_date,
        activity_time,
        assignee,
        priority,
        created_by,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Activity created successfully",
      id: result.insertId,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =======================
// GET ALL ACTIVITIES
// =======================
router.get("/list", authenticateAndAuthorize(), async (req, res) => {
  try {
    let sql;
    let values = [];

    if (req.user.role === "Admin") {
      sql = `
        SELECT
          c.*,
          u.name AS assignee_name
        FROM calendar_activities c
        LEFT JOIN users u
        ON c.assignee = u.id
        ORDER BY c.activity_date ASC, c.activity_time ASC
      `;
    } else {
      sql = `
        SELECT
          c.*,
          u.name AS assignee_name
        FROM calendar_activities c
        LEFT JOIN users u
        ON c.assignee = u.id
        WHERE c.assignee = ?
        ORDER BY c.activity_date ASC, c.activity_time ASC
      `;

      values.push(req.user.id);
    }

    const [rows] = await db.query(sql, values);

    res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =======================
// GET SINGLE ACTIVITY
// =======================
router.get("/:id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `SELECT *
       FROM calendar_activities
       WHERE id = ?`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Activity not found",
      });
    }

    res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =======================
// UPDATE ACTIVITY
// =======================
router.put("/:id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const { id } = req.params;

    const {
      title,
      description,
      activity_date,
      activity_time,
      assignee,
      priority,
    } = req.body;

    await db.query(
      `UPDATE calendar_activities
       SET
         title = ?,
         description = ?,
         activity_date = ?,
         activity_time = ?,
         assignee = ?,
         priority = ?
       WHERE id = ?`,
      [
        title,
        description,
        activity_date,
        activity_time,
        assignee,
        priority,
        id,
      ]
    );

    res.json({
      success: true,
      message: "Activity updated successfully",
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =======================
// DELETE ACTIVITY
// =======================
router.delete("/:id", authenticateAndAuthorize(), async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      `DELETE FROM calendar_activities
       WHERE id = ?`,
      [id]
    );

    res.json({
      success: true,
      message: "Activity deleted successfully",
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// =======================
// UPDATE STATUS
// =======================
router.put(
  "/status/:id",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      await db.query(
        `UPDATE calendar_activities
         SET status = ?
         WHERE id = ?`,
        [status, id]
      );

      res.json({
        success: true,
        message: "Status updated successfully",
      });
    } catch (error) {
      console.log(error);

      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
);

module.exports = router;