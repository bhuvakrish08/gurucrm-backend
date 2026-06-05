const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const multer = require("multer");

// ❌ REMOVE THESE (NO LOCAL STORAGE NEEDED)
// const path = require("path");
// const fs = require("fs");

const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

const router = express.Router();

// =============================
// FILE CONFIG
// =============================

const IMAGE_EXT = ["jpg", "jpeg", "png"];
const DOC_EXT = ["pdf", "txt", "doc", "xlsx", "csv", "pptx", "dwg"];

const MAX_IMG_SIZE = 5 * 1024 * 1024;
const MAX_DOC_SIZE = 5 * 1024 * 1024;

// =============================
// CLOUDINARY STORAGE (NEW)
// =============================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: "crm/followups", // 👈 folder in cloudinary
    resource_type: "auto",   // 👈 supports image/pdf/excel
  }),
});

// =============================
// MULTER
// =============================

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
// VALIDATION (KEEP YOUR LOGIC)
// =============================

function validateUploadedFiles(req) {
  if (!req.files) return null;

  for (const file of req.files) {
    const ext = file.originalname.split(".").pop().toLowerCase();

    if (IMAGE_EXT.includes(ext) && file.size > MAX_IMG_SIZE) {
      return "Image > 5MB not allowed";
    }

    if (DOC_EXT.includes(ext) && file.size > MAX_DOC_SIZE) {
      return "Document > 15MB not allowed";
    }
  }

  return null;
}

// =============================
// INSERT FOLLOW-UP + FILES
// =============================

router.post(
  "/insert",
  authenticateAndAuthorize(),
  (req, res, next) => {
    upload.array("files", 5)(req, res, (err) => {
      if (err) {
        console.log("MULTER ERROR =>", err);
        return res.status(400).json({
          success: false,
          message: err.message,
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      const sizeError = validateUploadedFiles(req);
      if (sizeError) {
        return res.status(400).json({ success: false, message: sizeError });
      }

      const {
        lead_id,
        follow_up_date,
        activity_type,
        follow_up_by,
        contact_person,
        description,
        status,
        remarks,
      } = req.body;

      // =============================
      // INSERT FOLLOW-UP
      // =============================

      const [result] = await db.promise().query(
        `INSERT INTO lead_follow_up 
        (lead_id, follow_up_date, activity_type, follow_up_by, contact_person, description, status, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          lead_id,
          follow_up_date,
          activity_type,
          follow_up_by,
          contact_person,
          description,
          status,
          remarks,
        ]
      );

      const followUpId = result.insertId;

      // =============================
      // SAVE FILES (UPDATED)
      // =============================

      if (req.files?.length > 0) {
        const fileValues = req.files.map((f) => [
          followUpId,
          f.originalname,
          f.path,       // ✅ Cloudinary URL
          f.filename,   // ✅ public_id
        ]);

        await db.promise().query(
          `INSERT INTO lead_follow_up_files 
          (follow_up_id, file_name, file_path, public_id) 
          VALUES ?`,
          [fileValues]
        );
      }

      res.json({
        success: true,
        message: "Follow-up created with files (Cloudinary) ✅",
      });
    } catch (err) {
      console.log(err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// =============================
// GET FILES (NO CHANGE)
// =============================

router.get("/files/:id", async (req, res) => {
  const [files] = await db.promise().query(
    "SELECT * FROM lead_follow_up_files WHERE follow_up_id=?",
    [req.params.id]
  );

  res.json({ success: true, files });
});

// =============================
// DELETE FILE (UPDATED)
// =============================

router.delete("/delete/:id", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      "SELECT public_id FROM lead_follow_up_files WHERE id=?",
      [req.params.id]
    );


    if (rows.length) {
      // ✅ DELETE FROM CLOUDINARY
      await cloudinary.uploader.destroy(public_id);

      // ✅ DELETE FROM DB
      await db.promise().query(
        "DELETE FROM lead_follow_up_files WHERE id=?",
        [req.params.id]
      );
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// =============================
// HISTORY (NO CHANGE)
// =============================

router.get("/history/:lead_id", async (req, res) => {
  try {
    const [rows] = await db.promise().query(
      `SELECT * FROM lead_follow_up 
       WHERE lead_id = ? ORDER BY created_at DESC`,
      [req.params.lead_id]
    );
    res.json({ success: true, result: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;