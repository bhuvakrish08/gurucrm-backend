const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");
const multer = require("multer");
// const path = require("path");
// const fs = require("fs");

const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

const router = express.Router();

// const UPLOAD_PATH = "uploads/contracts/";


const IMAGE_EXT = ["jpg", "jpeg", "png"];
const DOC_EXT = ["pdf", "txt", "doc", "xlsx", "csv", "pptx"];

const MAX_IMG_SIZE = 5 * 1024 * 1024;  // 5MB
const MAX_DOC_SIZE = 15 * 1024 * 1024; // 15MB


// =============================
// CLOUDINARY STORAGE
// =============================

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "crm/contracts",   // ✅ CONTRACT FOLDER
    resource_type: "auto",
  }),
});


// =============================
// MULTER
// =============================

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split(".").pop().toLowerCase();

    if (![...IMAGE_EXT, ...DOC_EXT].includes(ext)) {
      return cb(new Error("Unsupported file type"), false);
    }
    // ✅ Save type for size check later
    file.fileType = IMAGE_EXT.includes(ext) ? "image" : "doc";

    cb(null, true);
  },
  limits: {
    fileSize: MAX_DOC_SIZE // max allowed overall (15MB)
  }
});



router.get("/read", authenticateAndAuthorize(), async (req, res) => {


    const {
        search,
        company_name,
        customer_name,
        contract_name,
        contract_type,
        contract_value,
        start_date,
        end_date,
        assignee,
        created_by_name,
        created_at
    } = req.query;

    let sql = `
    SELECT 
        c.id,

        c.company_name AS company_id,
        org.organization_name AS company_name,

        c.customer_name,
        c.contract_name,

        c.contract_type AS contract_type_id,
        ct.name AS contract_type,

        c.contract_value,
        c.start_date,
        c.end_date,
        c.description,
        c.assignee,
        c.created_by_name,
        c.created_at

    FROM contracts c

    LEFT JOIN organizations org
        ON c.company_name = org.id

    LEFT JOIN contract_types ct
        ON c.contract_type = ct.id

    WHERE 1=1
    `;

    let params = [];

    // global search
    if (search) {
        sql += ` AND (
            org.organization_name LIKE ?
            OR c.customer_name LIKE ?
            OR c.contract_name LIKE ?
            OR ct.name LIKE ?
            OR c.contract_value LIKE ?
            OR c.assignee LIKE ?
            OR c.created_by_name LIKE ?
        )`;

        const s = `%${search}%`;
        params.push(s, s, s, s, s, s, s);
    }

    if (company_name) {
        sql += " AND org.organization_name LIKE ?";
        params.push(`%${company_name}%`);
    }

    if (customer_name) {
        sql += " AND c.customer_name LIKE ?";
        params.push(`%${customer_name}%`);
    }

    if (contract_name) {
        sql += " AND c.contract_name LIKE ?";
        params.push(`%${contract_name}%`);
    }

    if (contract_type) {
        sql += " AND ct.id = ?";
        params.push(contract_type);
    }

    if (contract_value) {
        sql += " AND c.contract_value LIKE ?";
        params.push(`%${contract_value}%`);
    }

    if (start_date) {
        sql += " AND DATE(c.start_date) = ?";
        params.push(start_date);
    }

    if (end_date) {
        sql += " AND DATE(c.end_date) = ?";
        params.push(end_date);
    }

    if (created_at) {
        sql += " AND DATE(c.created_at) = ?";
        params.push(created_at);
    }

    if (assignee) {
        sql += " AND c.assignee LIKE ?";
        params.push(`%${assignee}%`);
    }

    if (created_by_name) {
        sql += " AND c.created_by_name LIKE ?";
        params.push(`%${created_by_name}%`);
    }

    sql += " ORDER BY c.id ASC";

    db.query(sql, params, (err, result) => {

        if (err) {
            console.log("SQL ERROR:", err);
            return res.status(500).json({ error: err });
        }

        res.json({
            message: "Filtered",
            result
        });

    });

});




router.post("/insert", authenticateAndAuthorize(), upload.array("files", 5), async (req, res) => {

    

     try {
    const {
        company_name,
        customer_name,
        contract_name,
        contract_type,
        contract_value,
        start_date,
        end_date,
        description,
        assignee,
    } = req.body;

    const created_by_id = req.user.id;
    const created_by_name = req.user.username;

    const sql = `
        INSERT INTO contracts 
        (company_name, customer_name, contract_name, contract_type, contract_value,
         start_date, end_date, description, assignee, created_by_id, created_by_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        company_name,
        customer_name,
        contract_name,
        contract_type,
        contract_value,
        start_date,
        end_date,
        description,
        Array.isArray(assignee) ? assignee.join(",") : assignee,
        created_by_id,
        created_by_name
    ]

    const [result] = await db.promise().query(sql, values);
    const contractId = result.insertId;

    if (req.files?.length > 0) {
        const fileValues = req.files.map(f => [
            contractId, f.originalname, f.path, f.filename
        ]);

        await db.promise().query(
            "INSERT INTO contract_files (contract_id, file_name, file_path, public_id) VALUES ?",
            [fileValues]
        );
    }

    res.json({ success: true, message: "Contract created", contract_id: contractId });
     }
     catch (err) {
        console.error("Error in /insert:", err);
        res.status(500).json({ success: false, message: "Failed to create contract" });
     }
});


router.put("/update/:id", authenticateAndAuthorize(), upload.array("files", 5), async (req, res) => {

    const id = req.params.id;

    

    const {
        company_name,
        customer_name,
        contract_name,
        contract_type,
        contract_value,
        start_date,
        end_date,
        description,
        assignee,
    } = req.body;

    await db.promise().query(`
        UPDATE contracts SET
        company_name = ?, customer_name = ?, contract_name = ?, contract_type = ?,
        contract_value = ?, start_date = ?, end_date = ?, description = ?,
        assignee = ? WHERE id = ?
    `,
        [
            company_name,
            customer_name,
            contract_name,
            contract_type,
            contract_value,
            start_date,
            end_date,
            description,
            Array.isArray(assignee) ? assignee.join(",") : assignee,
            id
        ]);

    // If new files uploaded, replace old files in DB
    if (req.files.length > 0) {

        // 1. Insert new files
        const inserts = req.files.map(f => [id, f.originalname, f.path, f.filename]);
        await db.promise().query(
            "INSERT INTO contract_files (contract_id, file_name, file_path, public_id) VALUES ?",
            [inserts]
        );
    }

    res.json({ success: true, message: "contract updated, files replaced if new uploaded" });

});


// DELETE contract by id
router.delete("/delete/:id", authenticateAndAuthorize(), (req, res) => {
    const id = req.params.id;

    // 1. Delete files first (child table)
    const deleteFilesSQL = "DELETE FROM contract_files WHERE contract_id = ?";

    db.query(deleteFilesSQL, [id], (err) => {
        if (err) {
            console.log("SQL ERROR (delete files):", err);
            return res.status(500).json({ success: false, error: err });
        }

        // 2. Delete contract (parent table)
        const deleteContractSQL = "DELETE FROM contracts WHERE id = ?";

        db.query(deleteContractSQL, [id], (err2, result) => {
            if (err2) {
                console.log("SQL ERROR (delete contract):", err2);
                return res.status(500).json({ success: false, error: err2 });
            }

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: "Contract not found" });
            }

            res.json({ success: true, message: "Contract and related files deleted successfully" });
        });
    });
});



router.get("/files/:id", authenticateAndAuthorize(), async (req, res) => {
    const id = req.params.id;
    try {
        const [files] = await db.promise().query(
            "SELECT id, file_name, file_path FROM contract_files WHERE contract_id = ?",
            [id]
        );
        res.json({ success: true, files });
    } catch (err) {
        console.error("GET /files/:id error:", err);
        res.status(500).json({ success: false, message: "Failed to load files" });
    }
});

router.delete("/delete-file/:id", (req, res) => {
    const id = req.params.id;
    try {
        db.query("DELETE FROM contract_files WHERE id = ?", [id]);
        res.json({ success: true, message: "Deleted" });
    } catch (err) {
        res.status(500).json({ success: false, message: "Error deleting" });
    }
});


router.get("/get-column-scroll", async (req, res) => {
    try {
        const { direction, offset = 0, limit = 10 } = req.query;

        const columns = ["contract_name", "customer_name", "contract_type", "contract_value", "start_date", "end_date", "assignee"];

        const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM contracts");
        const total = countRows[0]?.total || 0;

        let newOffset = Number(offset);
        if (direction === "down") {
            newOffset = Math.min(newOffset + 1, Math.max(total - limit, 0));
        } else if (direction === "up") {
            newOffset = Math.max(newOffset - 1, 0);
        }

        const query = `SELECT id, ${columns.map(c => `\`${c}\``).join(", ")} FROM contracts ORDER BY id ASC LIMIT ? OFFSET ? `;

        const [rows] = await db.promise().query(query, [Number(limit), newOffset]);

        res.json({ success: true, data: rows, newOffset, total });
    } catch (err) {
        console.log("Something went wrong", err)
    }
});


module.exports = router;