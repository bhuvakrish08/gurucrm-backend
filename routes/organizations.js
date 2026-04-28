const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/add", authenticateAndAuthorize(), (req, res) => {
    const {
        organization_name,
        industry,
        email,
        address_1,
        address_2,
        country,
        state,
        city,
        pincode,
        gst_number,
        contact_1,
        contact_2,
        benificiary_name,
        bank_name,
        account_no,
        account_type,
        ifsc_code,
        micr_code,
    } = req.body;


    const sql = `INSERT INTO organizations (
    organization_name, industry, email, address_1, address_2, country, state, city, pincode, gst_number, contact_1,
    contact_2, benificiary_name, bank_name, account_no, account_type, ifsc_code, micr_code 
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) `;

    const values = [
        organization_name,
        industry,
        email,
        address_1,
        address_2,
        country,
        state,
        city,
        pincode,
        gst_number,
        contact_1,
        contact_2,
        benificiary_name,
        bank_name,
        account_no,
        account_type,
        ifsc_code,
        micr_code,
    ];

    db.query(sql, values, (err, result) => {
        if (err) {
            console.error("Error inserting data:", err);
            return res.status(500).json({ error: "Database error" });
        }
        res.status(200).json({ message: "Organization added successfully" });
    })
})


router.get("/read", (req, res) => {
    try {

        const page = parseInt(req.query.page) || 1;
        const limit = 5;
        const offset = (page - 1) * limit

        const countSql = `SELECT COUNT(*) AS total FROM organizations`;

        const dataSql = `SELECT organization_name, email, address_1, country, state FROM organizations
        LIMIT ? OFFSET ?`;

        db.query(countSql, (countErr, countResult) => {
            if (countErr) {
                console.error(countErr);
                return res.status(500).json({ error: "Count query failed" });
            }

            const total = countResult[0].total;
            const totalPages = Math.ceil(total / limit);

            db.query(dataSql, [limit, offset], (err, results) => {
                if (err) {
                    console.error(err);
                    return res.status(500).json({ error: "Data fetch failed" });
                }

                res.status(200).json({
                    currentPage: page,
                    totalPages,
                    totalRecords: total,
                    limit,
                    data: results,
                })
            })
        })

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Internal server error" });
    }
})



router.get("/get-column-scroll", async (req, res) => {
  const { column, direction, offset = 0, limit = 5 } = req.query;

  const allowedColumns = ["organization_name", "email", "address_1", "country", "state"];
  if (!allowedColumns.includes(column)) {
    return res.status(400).json({ success: false, message: "Invalid column" });
  }

  const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM organizations");
  const total = countRows[0].total;

  let newOffset = Number(offset);
  if (direction === "down") newOffset = Math.min(newOffset + 1, total - limit);
  else if (direction === "up") newOffset = Math.max(newOffset - 1, 0);

  const [rows] = await db.promise().query(
    `SELECT ?? FROM organizations ORDER BY id ASC LIMIT ? OFFSET ?`,
    [column, Number(limit), newOffset]
  );

  res.json({ success: true, data: rows, newOffset, total });
});


router.get("/organization-name", (req, res) => {
  const sql = ` SELECT id, organization_name FROM organizations ORDER BY organization_name ASC `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Error fetching organizations:", err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err.message,
      });
    }

    res.json({success: true, data: rows});
  });
});





module.exports = router;