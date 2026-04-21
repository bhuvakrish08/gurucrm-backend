const express = require("express");
const db = require("../db");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

// Read all data
router.get("/read", async (req, res) => {

 try {

  const {
   search1,
   search2,
   search3,
   search4,
   search5,
   search6,
   search7,
   search8
  } = req.query;

  let query = `

   SELECT 
    pm.*,
    pc.name AS category_name

   FROM product_master pm

   LEFT JOIN product_category pc
    ON pc.id = pm.product_category

   WHERE 1=1

  `;

  const params = [];

  if (search1) {

   query += " AND pm.product_name LIKE ?";
   params.push(`%${search1}%`);

  }

  if (search2) {

   query += " AND pm.product_category = ?";
   params.push(search2);

  }

  if (search3) {

   query += " AND pm.product_code LIKE ?";
   params.push(`%${search3}%`);

  }

  if (search4) {

   query += " AND pm.unit LIKE ?";
   params.push(`%${search4}%`);

  }

  if (search5) {

   query += " AND pm.code LIKE ?";
   params.push(`%${search5}%`);

  }

  if (search6) {

   query += " AND pm.purchase_price LIKE ?";
   params.push(`%${search6}%`);

  }

  if (search7) {

   query += " AND pm.current_stocks LIKE ?";
   params.push(`%${search7}%`);

  }

  if (search8) {

   query += " AND pm.product_type LIKE ?";
   params.push(`%${search8}%`);

  }

  query += " ORDER BY pm.id ASC";

  const [rows] = await db.promise().query(query, params);

  res.json(rows);

 }

 catch (err) {

  console.log(err);

  res.status(500).json({

   message: "error"

  });

 }

});

// Insert data
router.post("/insert", (req, res) => {
    const {
        product_name,
        product_category,
        unit,
        product_code,
        product_type,
        purchase_price,
        sales_price,
        product_code_type,
        code,
        current_stocks,
        description,
    } = req.body;

    const query = `
    INSERT INTO product_master (product_name, product_category, unit, product_code, product_type, purchase_price, sales_price, product_code_type, code, current_stocks, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

    db.query(query, [product_name, product_category, unit, product_code, product_type, purchase_price, sales_price, product_code_type, code, current_stocks, description], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ status: 1, message: "Inserted successfully", result });
    });
});

// Update data
router.put("/update/:id", (req, res) => {
    const { id } = req.params;
    const {
        product_name,
        product_category,
        unit,
        product_code,
        product_type,
        purchase_price,
        sales_price,
        product_code_type,
        code,
        current_stocks,
        description,
    } = req.body;

    const query = `
    UPDATE product_master
    SET product_name = ?, product_category = ?, unit = ?, product_code = ?, product_type = ?, purchase_price = ?, sales_price = ?, product_code_type = ?, code = ?, current_stocks = ?, description = ?
    WHERE id = ?
  `;

    db.query(query, [product_name, product_category, unit, product_code, product_type, purchase_price, sales_price, product_code_type, code, current_stocks, description, id], (err, result) => {
        if (err) return res.status(500).json(err);
        if (result.affectedRows === 0)
            return res.status(404).json({ message: "Record not found" });
        res.json({ message: "Updated successfully" });
    });
});


router.get("/get-column-scroll", async (req, res) => {
    try {
        const { direction, offset = 0, limit = 10 } = req.query;

        const columns = ["product_name", "product_category", "product_code", "unit", "code", "purchase_price", "current_stocks", "product_type"];

        const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM product_master");
        const total = countRows[0]?.total || 0;

        let newOffset = Number(offset);
        if (direction === "down") {
            newOffset = Math.min(newOffset + 1, Math.max(total - limit, 0));
        } else if (direction === "up") {
            newOffset = Math.max(newOffset - 1, 0);
        }

        const query = `SELECT id, ${columns.map(c => `\`${c}\``).join(", ")} FROM product_master ORDER BY id ASC LIMIT ? OFFSET ? `;

        const [rows] = await db.promise().query(query, [Number(limit), newOffset]);

        res.json({ success: true, data: rows, newOffset, total });
    } catch (err) {

    }
});


module.exports = router;
