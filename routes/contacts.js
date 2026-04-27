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
    } = req.query;

    let query = `

      SELECT 

        c.id,
        c.customer_id,
        c.company_name,
        c.customer_name,
        c.contact_person,
        c.contact_number,
        c.email,
        c.contact_designation,
        d.name AS designation_name
      FROM contacts c

      LEFT JOIN contact_designation d
        ON c.contact_designation = d.id

      WHERE 1=1

    `;

    const params = [];

    // company name filter
    if (search1) {
      query += " AND c.company_name LIKE ?";
      params.push(`%${search1}%`);
    }

    // customer name
    if (search2) {
      query += " AND c.customer_name LIKE ?";
      params.push(`%${search2}%`);
    }

    // contact person
    if (search3) {
      query += " AND c.contact_person LIKE ?";
      params.push(`%${search3}%`);
    }

    // contact number
    if (search4) {
      query += " AND c.contact_number LIKE ?";
      params.push(`%${search4}%`);
    }

    // email
    if (search5) {
      query += " AND c.email LIKE ?";
      params.push(`%${search5}%`);
    }

    // designation filter (by id)
    if (search6) {
      query += " AND c.contact_designation = ?";
      params.push(search6);
    }

    query += " ORDER BY c.id ASC";

    const [rows] = await db.promise().query(query, params);

    res.json({
      success: true,
      data: rows
    });

  } catch (err) {
    console.error("Error in /read:", err);

    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: err.message,
    });

  }

});


// Insert data
router.post("/insert", (req, res) => {
  const {
    company_name,
    customer_id,
    customer_name,
    contact_person,
    contact_number,
    email,
    contact_designation
  } = req.body;

  const query = `
    INSERT INTO contacts (company_name, customer_id, customer_name, contact_person, contact_number, email, contact_designation)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(query, [company_name, customer_id, customer_name, contact_person, contact_number, email, contact_designation], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ status: 1, message: "Inserted successfully", result });
  });
});

// Update data
router.put("/update/:id", (req, res) => {
  const { id } = req.params;
  const {
    company_name,
    customer_id,
    customer_name,
    contact_person,
    contact_number,
    email,
    contact_designation
  } = req.body;

  const query = `
    UPDATE contacts
    SET company_name = ?, customer_id = ?, customer_name = ?, contact_person = ?, contact_number = ?, email = ?, contact_designation = ?
    WHERE id = ?`;

  db.query(query, [company_name, customer_id, customer_name, contact_person, contact_number, email, contact_designation, id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.affectedRows === 0)
      return res.status(404).json({ message: "Record not found" });
    res.json({ message: "Updated successfully" });
  });
});

// delete data

router.delete("/delete/:id", (req, res) => {
  const { id } = req.params;

  const query = "DELETE FROM contacts WHERE id = ?";

  db.query(query, [id], (err, result) => {
    if (err) return res.status(500).json(err);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Record not found" });
    }

    res.json({ message: "Deleted successfully" });
  });
});

router.get("/get-column-scroll", async (req, res) => {
  try {
    const { direction, offset = 0, limit = 10 } = req.query;

    const columns = ["company_name", "customer_name", "contact_person", "contact_number", "email", "contact_designation"];

    const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM contacts");
    const total = countRows[0]?.total || 0;

    let newOffset = Number(offset);
    if (direction === "down") {
      newOffset = Math.min(newOffset + 1, Math.max(total - limit, 0));
    } else if (direction === "up") {
      newOffset = Math.max(newOffset - 1, 0);
    }

    const query = `SELECT id, ${columns.map(c => `\`${c}\``).join(", ")} FROM contacts ORDER BY id ASC LIMIT ? OFFSET ? `;

    const [rows] = await db.promise().query(query, [Number(limit), newOffset]);

    res.json({ success: true, data: rows, newOffset, total });
  } catch (err) {

  }
});


module.exports = router;