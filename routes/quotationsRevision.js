const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const router = express.Router();

// =============================
// GET FULL DETAILS BY QUOTATION ID
// Route: GET /api/quotation/:quotation_id/full-details
// Fetches:
//   1. quotation_revision        (by quotation_id)
//   2. quotation_revision_files  (by quotation_revision_id)
//   3. lead_follow_up            (by lead_id from quotation)
//   4. lead_follow_up_files      (by follow_up_id)
// =============================

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

module.exports = router;