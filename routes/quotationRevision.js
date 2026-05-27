const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const multer = require("multer");

const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

const router = express.Router();

// ======================================
// FILE CONFIG
// ======================================

const IMAGE_EXT = ["jpg", "jpeg", "png"];
const DOC_EXT = ["pdf", "txt", "doc", "docx", "xlsx", "csv", "pptx"];

const MAX_IMG_SIZE = 5 * 1024 * 1024;
const MAX_DOC_SIZE = 15 * 1024 * 1024;

// ======================================
// CLOUDINARY STORAGE
// ======================================

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => ({
    folder: "crm/quotation_revision",
    resource_type: "auto",
  }),
});

// ======================================
// MULTER
// ======================================

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

// ======================================
// FILE VALIDATION
// ======================================

function validateUploadedFiles(req) {
  if (!req.files) return null;

  for (const file of req.files) {
    const ext = file.originalname.split(".").pop().toLowerCase();

    if (IMAGE_EXT.includes(ext) && file.size > MAX_IMG_SIZE) {
      return "Image size should be less than 5MB";
    }

    if (DOC_EXT.includes(ext) && file.size > MAX_DOC_SIZE) {
      return "Document size should be less than 15MB";
    }
  }

  return null;
}

// ======================================
// INSERT QUOTATION REVISION
// ======================================

router.post(
  "/insert",
  authenticateAndAuthorize(),
  upload.array("files", 5),
  async (req, res) => {
    try {
      // ======================================
      // FILE SIZE VALIDATION
      // ======================================

      const sizeError = validateUploadedFiles(req);

      if (sizeError) {
        return res.status(400).json({
          success: false,
          message: sizeError,
        });
      }

      // ======================================
      // BODY DATA
      // ======================================

      const {
        quotation_id,
        follow_up_date,
        activity_type,
        follow_up_by,
        contact_person,
        quotation_no,
        description,
      } = req.body;

      // ======================================
      // INSERT INTO quotation_revision
      // ======================================

      const [result] = await db.promise().query(
        `
        INSERT INTO quotation_revision
        (
          quotation_id,
          follow_up_date,
          activity_type,
          follow_up_by,
          contact_person,
          quotation_no,
          description
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [
          quotation_id,
          follow_up_date,
          activity_type,
          follow_up_by,
          contact_person,
          quotation_no,
          description,
        ],
      );

      const quotationRevisionId = result.insertId;

      // ======================================
      // INSERT FILES
      // ======================================

      if (req.files && req.files.length > 0) {
        // ======================================
        // DUPLICATE FILE CHECK
        // ======================================

        const uploadedNames = req.files.map((f) =>
          f.originalname.toLowerCase(),
        );

        const uniqueNames = [...new Set(uploadedNames)];

        if (uploadedNames.length !== uniqueNames.length) {
          return res.status(400).json({
            success: false,
            message: "Same file cannot be uploaded multiple times",
          });
        }

        // ======================================
        // SAVE FILES
        // ======================================

        const fileValues = req.files.map((file) => [
          quotationRevisionId,
          file.originalname,
          file.path,
          file.filename,
        ]);

        await db.promise().query(
          `
    INSERT INTO quotation_revision_files
    (
      quotation_revision_id,
      filename,
      file_path,
      public_id
    )
    VALUES ?
    `,
          [fileValues],
        );
      }

      // ======================================
      // SUCCESS RESPONSE
      // ======================================

      res.status(200).json({
        success: true,
        message: "Quotation revision created successfully",
        quotation_revision_id: quotationRevisionId,
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

router.get(
  "/:quotation_id/full-details",
  authenticateAndAuthorize(),
  async (req, res) => {
    try {
      const { quotation_id } = req.params;

      // =============================
      // STEP 1: GET lead_id FROM quotation
      // =============================
      const [quotationRows] = await db.promise().query(
        `SELECT lead_id FROM quotation WHERE id = ?`,
        [quotation_id]
      );

      if (quotationRows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Quotation not found",
        });
      }

      const lead_id = quotationRows[0].lead_id;

      // =============================
      // STEP 2: GET quotation_revision
      // =============================
      const [revisions] = await db.promise().query(
        `SELECT * FROM quotation_revision WHERE quotation_id = ? ORDER BY created_at DESC`,
        [quotation_id]
      );

      // =============================
      // STEP 3: GET quotation_revision_files (for each revision)
      // =============================
      const revisionsWithFiles = await Promise.all(
        revisions.map(async (revision) => {
          const [files] = await db.promise().query(
            `SELECT * FROM quotation_revision_files WHERE quotation_revision_id = ?`,
            [revision.id]
          );
          return { ...revision, files };
        })
      );

      // =============================
      // STEP 4: GET lead_follow_up
      // =============================
      const [followUps] = await db.promise().query(
        `SELECT * FROM lead_follow_up WHERE lead_id = ? ORDER BY created_at DESC`,
        [lead_id]
      );

      // =============================
      // STEP 5: GET lead_follow_up_files (for each follow up)
      // =============================
      const followUpsWithFiles = await Promise.all(
        followUps.map(async (followUp) => {
          const [files] = await db.promise().query(
            `SELECT * FROM lead_follow_up_files WHERE follow_up_id = ?`,
            [followUp.follow_up_id]
          );
          return { ...followUp, files };
        })
      );

      // =============================
      // FINAL RESPONSE
      // =============================
      res.json({
        success: true,
        data: {
          revisions: revisionsWithFiles,   // quotation_revision + quotation_revision_files
          follow_ups: followUpsWithFiles,  // lead_follow_up + lead_follow_up_files
        },
      });

    } catch (err) {
      console.error("Error:", err);
      res.status(500).json({
        success: false,
        message: err.message,
      });
    }
  }
);

// ======================================
// EXPORT
// ======================================

module.exports = router;
