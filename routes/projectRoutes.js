const express = require("express");
const router = express.Router();
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

// Get All Projects
router.get("/list", authenticateAndAuthorize(), async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
        SELECT
          id,
          quotation_id,
          company_name,
          customer_name,
          reference,
          source,
          quotation_no,
          quotation_date,
          grand_total,
          architecture_net_amount,
          expense_net_amount,
          net_revenue_amount,
          created_at,
          updated_at
        FROM project
        ORDER BY id DESC
      `);

    res.status(200).json({
      success: true,
      totalRecords: rows.length,
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

module.exports = router;
