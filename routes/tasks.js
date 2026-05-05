const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

const router = express.Router();

// =============================
// FILE CONFIG
// =============================

const IMAGE_EXT = ["jpg", "jpeg", "png"];
const DOC_EXT = ["pdf", "txt", "doc", "xlsx", "csv", "pptx"];

// =============================
// CLOUDINARY STORAGE ✅
// =============================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: "crm/tasks",
    resource_type: "auto",
  }),
});

// =============================
// MULTER
// =============================

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();

    if (![...IMAGE_EXT, ...DOC_EXT].includes(ext)) {
      return cb(new Error("Unsupported file type"), false);
    }

    cb(null, true);
  },
});

// =============================
// INSERT TASK
// =============================

router.post("/insert", authenticateAndAuthorize(), upload.array("files", 5), async (req, res) => {
  try {

    const {
      task_name, status, priority, recurring_type,
      repeat_every, description, assignee, template,
      related_to, related_value, start_date, due_date
    } = req.body;

    const created_by_id = req.user.id;
    const created_by_name = req.user.username;

    const [result] = await db.promise().query(`
      INSERT INTO tasks 
      (task_name, status, priority, recurring_type, repeat_every,
      description, assignee, template, related_to,
      related_value, start_date, due_date,
      created_by_id, created_by_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      task_name,
      status,
      priority,
      recurring_type,
      repeat_every,
      description,
      Array.isArray(assignee) ? assignee.join(",") : assignee,
      template,
      related_to,
      related_value,
      start_date,
      due_date,
      created_by_id,
      created_by_name
    ]);

    const taskId = result.insertId;

    // SAVE FILES
    if (req.files?.length > 0) {
      const fileValues = req.files.map(f => [
        taskId,
        f.originalname,
        f.path,       // ✅ URL
        f.filename    // ✅ public_id
      ]);

      await db.promise().query(
        "INSERT INTO task_files (task_id, file_name, file_path, public_id) VALUES ?",
        [fileValues]
      );
    }

    // LOG ACTIVITY
    const activityMsg = `${created_by_name} created a new task: ${task_name}`;
    await db.promise().query("INSERT INTO activities (message, user_name) VALUES (?, ?)", [activityMsg, created_by_name]);

    res.json({ success: true, message: "Task created ✅" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});





router.get("/read", async (req, res) => {

    const {
        search,
        task_name,
        status,
        priority,
        assignee,
        start_from,
        due_from,
        created_by_name,
        created_at
    } = req.query;


    let sql = `
        SELECT 
            t.*,
            s.name AS status_name
        FROM tasks t
        LEFT JOIN task_status s 
            ON s.id = t.status
        WHERE 1=1
    `;

    let params = [];

    // Universal Search
    if (search) {

        sql += ` AND (
            t.task_name LIKE ?
            OR t.assignee LIKE ?
            OR t.created_by_name LIKE ?
            OR t.priority LIKE ?
            OR s.name LIKE ?
        )`;

        const sTerm = `%${search}%`;

        params.push(
            sTerm,
            sTerm,
            sTerm,
            sTerm,
            sTerm
        );

    }

    // Task Name
    if (task_name) {
        sql += " AND t.task_name LIKE ?";
        params.push(`%${task_name}%`);
    }

    // Status filter (by id)
    if (status) {
        sql += " AND t.status = ?";
        params.push(status);
    }

    // Priority
    if (priority) {
        sql += " AND t.priority = ?";
        params.push(priority);
    }

    // Assignee
    if (assignee) {
        sql += " AND t.assignee LIKE ?";
        params.push(`%${assignee}%`);
    }

    // Start Date
    if (start_from) {
        sql += " AND DATE(t.start_date) = ?";
        params.push(start_from);
    }

    // Due Date
    if (due_from) {
        sql += " AND DATE(t.due_date) = ?";
        params.push(due_from);
    }

    // Created By
    if (created_by_name) {
        sql += " AND t.created_by_name = ?";
        params.push(created_by_name);
    }

    // Created At
    if (created_at) {
        sql += " AND DATE(t.created_at) = ?";
        params.push(created_at);
    }

    sql += " ORDER BY t.id ASC";

    db.query(sql, params, (err, result) => {

        if (err) {

            return res.status(500).json({

                success:false,
                error: err

            });

        }

        res.json({

            success:true,
            result

        });

    });

});


// =============================
// GET FILES
// =============================

router.get("/files/:id", authenticateAndAuthorize(), async (req, res) => {
  const [files] = await db.promise().query(
    "SELECT * FROM task_files WHERE task_id=?",
    [req.params.id]
  );

  res.json({ success: true, files });
});

// =============================
// DELETE FILE (CLOUDINARY)
// =============================

router.delete("/delete/:id", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT public_id FROM task_files WHERE id=?",
      [req.params.id]
    );

    if (rows.length) {
      await cloudinary.uploader.destroy(rows[0].public_id);
      await db.promise().query("DELETE FROM task_files WHERE id=?", [req.params.id]);
    }

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// UPDATE TASK
// =============================

router.put("/update/:id", authenticateAndAuthorize(), upload.array("files", 5), async (req, res) => {
  try {
    const taskId = req.params.id;

    const {
      task_name, status, priority, recurring_type,
      repeat_every, description, assignee, template,
      related_to, related_value, start_date, due_date
    } = req.body;

    await db.promise().query(`
      UPDATE tasks SET 
        task_name=?, status=?, priority=?, recurring_type=?, repeat_every=?,
        description=?, assignee=?, template=?, related_to=?, related_value=?,
        start_date=?, due_date=? 
      WHERE id=?
    `, [
      task_name, status, priority, recurring_type, repeat_every,
      description,
      Array.isArray(assignee) ? assignee.join(",") : assignee,
      template, related_to, related_value,
      start_date, due_date,
      taskId
    ]);

    // DELETE removed files
    if (req.body.removed_files) {
      const removedIds = Array.isArray(req.body.removed_files)
        ? req.body.removed_files
        : [req.body.removed_files];

      for (const id of removedIds) {
        const [rows] = await db.promise().query(
          "SELECT public_id FROM task_files WHERE id=?",
          [id]
        );

        if (rows.length) {
          await cloudinary.uploader.destroy(rows[0].public_id);
        }

        await db.promise().query("DELETE FROM task_files WHERE id=?", [id]);
      }
    }

    // ADD new files
    if (req.files?.length > 0) {
      const inserts = req.files.map(f => [
        taskId,
        f.originalname,
        f.path,
        f.filename
      ]);

      await db.promise().query(
        "INSERT INTO task_files (task_id, file_name, file_path, public_id) VALUES ?",
        [inserts]
      );
    }

    res.json({ success: true, message: "Task updated ✅" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


router.get("/get-column-scroll", async (req, res) => {
    try {
        const { direction, offset = 0, limit = 10 } = req.query;

        const columns = ["task_name", "start_date", "due_date", "priority", "assignee", "status"];

        const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM tasks");
        const total = countRows[0]?.total || 0;

        let newOffset = Number(offset);
        if (direction === "down") {
            newOffset = Math.min(newOffset + 1, Math.max(total - limit, 0));
        } else if (direction === "up") {
            newOffset = Math.max(newOffset - 1, 0);
        }

        const query = `SELECT id, ${columns.map(c => `\`${c}\``).join(", ")} FROM tasks ORDER BY id ASC LIMIT ? OFFSET ? `;

        const [rows] = await db.promise().query(query, [Number(limit), newOffset]);

        res.json({ success: true, data: rows, newOffset, total });
    } catch (err) {
        console.log("Something went wrong", err)
    }
});

// ADD THIS ONE ROUTE — paste after the existing DELETE /delete/:id route
router.delete("/delete-task/:id", async (req, res) => {
  try {
    const taskId = req.params.id;

    // Delete associated files from Cloudinary first
    const [files] = await db.promise().query(
      "SELECT public_id FROM task_files WHERE task_id = ?",
      [taskId]
    );

    for (const file of files) {
      if (file.public_id) {
        await cloudinary.uploader.destroy(file.public_id);
      }
    }

    // Delete files from DB
    await db.promise().query(
      "DELETE FROM task_files WHERE task_id = ?", 
      [taskId]
    );

    // Delete the task
    await db.promise().query(
      "DELETE FROM tasks WHERE id = ?", 
      [taskId]
    );

    res.json({ success: true, message: "Task deleted successfully" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});


module.exports = router;