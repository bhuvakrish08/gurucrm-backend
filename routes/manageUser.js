const express = require("express");
const db = require("../db");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

// Read all data
router.get("/read", async (req, res) => {

    try {

        const { search1, search2, search3, search4, search5, search6, search7, search8 } = req.query;

        let query = `

            SELECT 

                id,
                name,
                email,
                mobile,

                DATE(date_of_birth) AS date_of_birth,
                DATE(date_of_joining) AS date_of_joining,

                role,
                organization,
                designation,
                country,
                state,
                city,
                pincode,
                address,
                status

            FROM users

            WHERE 1=1

        `;

        const params = [];

        // name search
        if (search1) {
            query += " AND name LIKE ?";
            params.push(`%${search1}%`);
        }

        // email search
        if (search2) {
            query += " AND email LIKE ?";
            params.push(`%${search2}%`);
        }

        // mobile search
        if (search3) {
            query += " AND mobile LIKE ?";
            params.push(`%${search3}%`);
        }

        // dob search
        if (search4) {
            query += " AND date_of_birth LIKE ?";
            params.push(`%${search4}%`);
        }

        // role search (search by id)
        if (search5) {
            query += " AND role LIKE ?";
            params.push(`%${search5}%`);
        }

        // designation search
        if (search6) {
            query += " AND designation LIKE ?";
            params.push(`%${search6}%`);
        }

        // joining date search
        if (search7) {
            query += " AND date_of_joining LIKE ?";
            params.push(`%${search7}%`);
        }

        // status search
        if (search8) {
            query += " AND status LIKE ?";
            params.push(`%${search8}%`);
        }

        query += " ORDER BY id ASC";

        const [rows] = await db.promise().query(query, params);

        res.json(rows);

    } catch (err) {

        console.error("Error in /read:", err);

        res.status(500).json({

            success: false,
            message: "Internal Server Error",
            error: err.message

        });

    }

});


router.get("/read/:id", async (req, res) => {

    try {

        const [rows] = await db.promise().query(`
            SELECT 

                id,
                name,
                email,
                mobile,
                DATE(date_of_birth) AS date_of_birth,
                DATE(date_of_joining) AS date_of_joining,
                password,
                role,
                organization,
                designation,
                country,
                state,
                city,
                pincode,
                address,
                status

            FROM users

            WHERE id = ?

        `, [req.params.id]);

        if (rows.length === 0) {

            return res.status(404).json({

                success: false,
                message: "User not found"

            });

        }

        return res.json({

            success: true,
            data: rows[0]

        });

    } catch (err) {

        console.error(err);

        res.status(500).json({

            success: false,
            error: err.message

        });

    }

});


// Insert data
router.post("/insert", (req, res) => {
    const {
        first_name,
        middle_name,
        last_name,
        email,
        mobile,
        date_of_birth,
        date_of_joining,
        password,
        role,
        organization,
        designation,
        country,
        state,
        city,
        pincode,
        address,
        status
    } = req.body;

    // Combine name
    const fullName = [first_name, middle_name, last_name].filter(Boolean).join(" ");

    const sql = `
    INSERT INTO users 
    (name, email, mobile, date_of_birth, date_of_joining, password, role, organization, designation, country, state, city, pincode, address, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

    db.query(sql, [
        fullName,
        email,
        mobile,
        date_of_birth,
        date_of_joining,
        password,
        role,
        organization,
        designation,
        country,
        state,
        city,
        pincode,
        address,
        status ?? 1
    ], (err, result) => {
        if (err) {
            console.error("Insert Error:", err);
            return res.status(500).json({ message: "Insert failed", error: err });
        }
        res.json({ message: "Employee inserted successfully!", id: result.insertId });
    });
});


// Update data
router.put("/update/:id", (req, res) => {
    const {
        first_name,
        middle_name,
        last_name,
        email,
        mobile,
        date_of_birth,
        date_of_joining,
        password,
        role,
        organization,
        designation,
        country,
        state,
        city,
        pincode,
        address,
    } = req.body;

    const fullName = [first_name, middle_name, last_name].filter(Boolean).join(" ");

    const sql = `
        UPDATE users
        SET 
            name=?, 
            email=?, 
            mobile=?, 
            date_of_birth=?, 
            date_of_joining=?, 
            password=?, 
            role=?, 
            organization=?, 
            designation=?, 
            country=?, 
            state=?, 
            city=?, 
            pincode=?, 
            address=?
        WHERE id=?
    `;

    db.query(sql, [
        fullName,
        email,
        mobile,
        date_of_birth,
        date_of_joining,
        password,
        role,
        organization,
        designation,
        country,
        state,
        city,
        pincode,
        address,
        req.params.id
    ], (err, result) => {
        if (err) {
            console.error("Update Error:", err);
            return res.status(500).json({ message: "Update failed", error: err });
        }
        res.json({ message: "Employee updated successfully!" });
    });
});



router.get("/get-column-scroll", async (req, res) => {
    try {
        const { direction, offset = 0, limit = 10 } = req.query;

        const columns = ["name", "email", "mobile", "date_of_birth", "role", "designation", "date_of_joining"];

        const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM users");
        const total = countRows[0]?.total || 0;

        let newOffset = Number(offset);
        if (direction === "down") {
            newOffset = Math.min(newOffset + 1, Math.max(total - limit, 0));
        } else if (direction === "up") {
            newOffset = Math.max(newOffset - 1, 0);
        }

        const query = `SELECT id, ${columns.map(c => `\`${c}\``).join(", ")} FROM users ORDER BY id ASC LIMIT ? OFFSET ? `;

        const [rows] = await db.promise().query(query, [Number(limit), newOffset]);

        res.json({ success: true, data: rows, newOffset, total });
    } catch (err) {
        console.log("Something went wrong", err)
    }
});

// reads email
router.get("/read-email", (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ message: "Email is required" });

    const sql = "SELECT id FROM users WHERE email = ?";
    db.query(sql, [email], (err, results) => {
        if (err) return res.status(500).json({ message: "Database error", error: err });
        if (results.length > 0) {
            return res.status(200).json({ exists: true });
        } else {
            return res.status(200).json({ exists: false });
        }
    });
});


// update toggle
router.put("/status/:id", (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    const query = "UPDATE users SET status = ? WHERE id = ?";
    db.query(query, [status, id], (err, result) => {
        if (err) return res.status(500).json(err);
        if (result.affectedRows === 0)
            return res.status(404).json({ message: "Record not found" });
        res.json({ message: "Status updated successfully" });
    });
});



router.get("/asignee", (req, res) => {
    const { status } = req.query;

    let sql = "SELECT id, name FROM users";
    const values = [];

    // Apply status filter if provided
    if (status) {
        sql += " WHERE status = ?";
        values.push(status);
    }

    sql += " ORDER BY name ASC";

    db.query(sql, values, (err, rows) => {
        if (err) {
            console.error("Error fetching source names:", err);
            return res.status(500).json({
                success: false,
                message: "Database error",
                error: err.message,
            });
        }

        res.json({
            success: true,
            data: rows,
        });
    });
});



module.exports = router;
