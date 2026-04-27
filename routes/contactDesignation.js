const express = require("express")
const db = require("../db")
const authenticateToken = require("../middlewares/authMiddleware");


const router = express.Router()

// read data from table
router.get("/read", (req, res) => {
    const { search2 = "", status } = req.query;

    let query = "SELECT * FROM contact_designation WHERE 1=1";
    const params = [];

    if (search2) {
        query += " AND name LIKE ?";
        params.push(`%${search2}%`);
    }
    if (status === "1" || status === "0") {
        query += " AND status = ?";
        params.push(status);
    }

    db.query(query, params, (err, result) => {
        if (err) return res.status(500).json(err);
        res.json(result);
    });


});


// insert data into table
router.post("/insert", (req, res) => {
    const { name } = req.body;

    db.query("INSERT INTO contact_designation (name) VALUES (?)",
        [name],
        (err, result) => {
            if (err) return res.status(500).json(err);
            res.json({ status: 1, message: "Success", result });
        }
    )
})

router.put("/update/:id", (req, res) => {
    const { id } = req.params
    const { name } = req.body;

    db.query("UPDATE contact_designation SET name = ? WHERE id = ? ",
        [name, id],
        (err, result) => {
            if (err) return res.status(500).json(err);
            if (result.affectedRows === 0)
                return res.status(404).json({ message: "designationName not found or not yours" });
            res.json({ message: "designationName updated successfully" });
        }
    )
})


// Update only status field
router.put("/status/:id", (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    db.query(
        "UPDATE contact_designation SET status = ? WHERE id = ?",
        [status, id],
        (err, result) => {
            if (err) return res.status(500).json(err);
            if (result.affectedRows === 0)
                return res.status(404).json({ message: "Designation not found" });
            res.json({ message: "Status updated successfully" });
        }
    );
});

router.get("/get-column-scroll", async (req, res) => {
  try {
    const { column, direction, offset = 0, limit = 10 } = req.query;

    const allowedColumns = ["name"];
    if (!allowedColumns.includes(column)) {
      return res.status(400).json({ success: false, message: "Invalid column" });
    }

    // Get total records
    const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM contact_designation");
    const total = countRows[0].total;

    // Calculate new offset
    let newOffset = Number(offset);
    if (direction === "down") newOffset = Math.min(newOffset + 1, total - limit);
    else if (direction === "up") newOffset = Math.max(newOffset - 1, 0);

    //  Fixed query
    const query = `SELECT \`${column}\` FROM contact_designation ORDER BY id ASC LIMIT ? OFFSET ?`;
    const [rows] = await db.promise().query(query, [Number(limit), newOffset]);

    res.json({ success: true, data: rows, newOffset, total });
  } catch (err) {
    
  }
  
});


module.exports = router;