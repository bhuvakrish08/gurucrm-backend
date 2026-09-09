const express = require("express");
const db = require("../db");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

// Read all data
router.get("/read", async (req, res) => {

  try {

    const page = parseInt(req.query.page) || 1;
    const limitQuery = req.query.limit;

    const {
      search,
      search1,
      search2,
      search3,
      search4,
      search5,
      search6,
    } = req.query;

    let whereClause = " WHERE 1=1";
    const params = [];

    if (search) {
      whereClause += " AND (c.company_name LIKE ? OR c.customer_name LIKE ? OR c.contact_person LIKE ? OR c.contact_number LIKE ? OR c.email LIKE ?)";
      const sTerm = `%${search}%`;
      params.push(sTerm, sTerm, sTerm, sTerm, sTerm);
    }

    // company name filter
    if (search1) {
      whereClause += " AND c.company_name LIKE ?";
      params.push(`%${search1}%`);
    }

    // customer name
    if (search2) {
      whereClause += " AND c.customer_name LIKE ?";
      params.push(`%${search2}%`);
    }

    // contact person
    if (search3) {
      whereClause += " AND c.contact_person LIKE ?";
      params.push(`%${search3}%`);
    }

    // contact number
    if (search4) {
      whereClause += " AND c.contact_number LIKE ?";
      params.push(`%${search4}%`);
    }

    // email
    if (search5) {
      whereClause += " AND c.email LIKE ?";
      params.push(`%${search5}%`);
    }

    // designation filter (by id)
    if (search6) {
      whereClause += " AND c.contact_designation = ?";
      params.push(search6);
    }

    const [countResult] = await db.promise().query(`SELECT COUNT(*) AS total FROM contacts c ${whereClause}`, params);
    const totalRecords = countResult[0]?.total || 0;

    const limit = limitQuery === "all" ? null : (parseInt(limitQuery) || 25);
    const offset = (page - 1) * (limit || 25);

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
      ${whereClause}
      ORDER BY c.id ASC
    `;

    let queryParams = [...params];
    if (limit !== null) {
      query += ` LIMIT ? OFFSET ?`;
      queryParams.push(limit, offset);
    }

    const [rows] = await db.promise().query(query, queryParams);

    res.json({
      success: true,
      totalRecords,
      data: rows,
      pagination: {
        total: totalRecords,
        page,
        limit: limit || totalRecords,
        totalPages: limit ? Math.ceil(totalRecords / limit) : 1,
      },
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