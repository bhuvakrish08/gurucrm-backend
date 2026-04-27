const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

const router = express.Router();

router.get("/read", (req, res) => {

  const sql = `

    SELECT 
      l.lead_id,

      l.company_name,

      l.customer_name,

      l.lead_title,

      pc.name AS product_category,

      ls.name AS source,

      l.assignee,

      l.status,

      l.created_at,

      (
        SELECT f.follow_up_date
        FROM lead_follow_up f
        WHERE f.lead_id = l.lead_id
        ORDER BY f.follow_up_date DESC
        LIMIT 1
      ) AS next_follow_up_date

    FROM lead l

    LEFT JOIN product_category pc
      ON pc.id = l.product_category

    LEFT JOIN inquiry_lead_source ls
      ON ls.id = l.source

    ORDER BY l.lead_id DESC

  `;

  db.query(sql, (err, result) => {

    if (err) {

      console.log(err);

      return res.status(500).json({

        success: false,
        error: err

      });

    }

    res.json({

      success: true,
      result

    });

  });

});


/* =====================================
   GET ALL LEADS
===================================== */

router.get("/sales/leads", authenticateAndAuthorize(), (req, res) => {

  const sql = `

  SELECT
    l.lead_id,
    l.company_name,
    l.customer_name,
    l.lead_title,
    pc.name AS product_category,
    p.product_name,
    ls.name AS source,
    l.priority,
    l.assignee,
    l.status,
    lc.name AS category,
    l.description,
    l.created_at
  FROM lead l


  LEFT JOIN product_category pc
    ON pc.id = l.product_category

  LEFT JOIN product_master p
    ON p.product_name = l.product_name

  LEFT JOIN inquiry_lead_source ls
    ON ls.id = l.source

  LEFT JOIN inquiry_lead_category lc
    ON lc.id = l.category

  ORDER BY l.lead_id DESC
  `;

  db.query(sql, (err, result) => {

    if (err) {

      return res.status(500).json({

        success: false,
        error: err

      });

    }

    res.json({

      success: true,
      count: result.length,
      data: result

    });

  });

});



router.get("/sales/leads/view-details/:id", authenticateAndAuthorize(), (req, res) => {
  const id = req.params.id;

  const sql = `
    SELECT
      l.lead_id,
      l.company_name,
      l.customer_name,
      l.lead_title,

      pc.name AS product_category,
      p.product_name,
      ls.name AS source,
      l.priority,
      l.assignee,
      lc.name AS category,
      l.description,
      l.status,
      l.created_at

    FROM lead l

    LEFT JOIN product_category pc
      ON pc.id = l.product_category

    LEFT JOIN product_master p
      ON p.id = l.product_name

    LEFT JOIN inquiry_lead_source ls
      ON ls.id = l.source

    LEFT JOIN inquiry_lead_category lc
      ON lc.id = l.category

    WHERE l.lead_id = ?
  `;

  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({
        success: false,
        error: err,
      });
    }

    res.json({
      success: true,
      lead: result[0],
    });
  });
});

/* =====================================
   VIEW SINGLE LEAD
===================================== */

router.get("/sales/leads/view-leads/:id", authenticateAndAuthorize(), (req, res) => {

  const id = req.params.id;

  const sql = `

    SELECT

      l.lead_id,

      l.company_name,       
      l.customer_name,
      l.lead_title,

      l.product_category,   
      l.product_name,

      l.source,             
      l.priority,
      l.assignee,

      l.category,           
      l.description,

      l.status,
      l.created_at

    FROM lead l

    WHERE l.lead_id = ?

  `;

  db.query(sql, [id], (err, result) => {

    if (err) {

      return res.status(500).json({

        success: false,
        error: err

      });

    }

    res.json({

      success: true,
      lead: result[0]

    });

  });

});


//EDIT API
router.put('/update/:id', (req, res) => {
  const leadId = req.params.id;

  const {
    company_name,
    customer_name,
    lead_title,
    source,
    status,
    product_category,
    product_name,
    priority,
    assignee,
    category,
    description
  } = req.body;

  const sql = `
        UPDATE \`lead\`
        SET 
            company_name = ?,
            customer_name = ?,
            lead_title = ?,
            source = ?,
            status = ?,
            product_category = ?,
            product_name = ?,
            priority = ?,
            assignee = ?,
            category = ?,
            description = ?
        WHERE lead_id = ?
    `;

  db.query(sql, [
    company_name,
    customer_name,
    lead_title,
    source,
    status,
    product_category,
    product_name,
    priority,
    assignee,
    category,
    description,
    leadId
  ], (err, result) => {

    if (err) {
      console.error(err);
      return res.status(500).json({
        success: false,
        message: "Error updating lead",
        error: err
      });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Lead not found"
      });
    }

    res.json({
      success: true,
      message: "Lead updated successfully"
    });
  });
});




// Add lead
router.post("/insert", (req, res) => {
  console.log("Incoming lead data:", req.body);

  const {
    company_name,
    customer_name,
    lead_title,
    source,
    status,
    product_category,
    product_name,
    priority,
    assignee,
    category,
    description,
  } = req.body;

  const sql = `
        INSERT INTO \`lead\`
       (
          company_name,
          customer_name,
          lead_title,
          source,
          status,
          product_category,
          product_name,
          priority,
          assignee,
          category,
          description
)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

  const values = [
    company_name,
    customer_name,
    lead_title,
    source,
    status,
    product_category,
    product_name,
    priority,
    assignee,
    category,
    description
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("MYSQL ERROR:", err);
      return res.status(500).json({
        success: false,
        message: "Database insert failed",
        error: err.message,
      });
    }

    res.json({
      success: true,
      message: "Lead saved successfully",
      lead_id: result.insertId,
    });
  });
});

// Update Status
router.put("/update-status/:id", (req, res) => {

  const id = req.params.id;
  const { status } = req.body;

  const sql = `
        UPDATE \`lead\`
        SET status = ?
        WHERE lead_id = ?
    `;

  db.query(sql, [status, id], (err, result) => {

    if (err) {
      console.log(err);
      return res.status(500).json({
        success: false,
        message: "Database error",
        error: err
      });
    }

    res.json({
      success: true,
      message: "Status updated successfully"
    });

  });

});



// ================= DELETE =================
// In your lead router - this is already correct, no changes needed:
router.delete("/:id", async (req, res) => {
  const leadId = req.params.id;
  try {
    await db.promise().query("START TRANSACTION");

    const [lead] = await db.promise().query(
      "SELECT lead_id FROM lead WHERE lead_id = ?", [leadId]
    );
    if (lead.length === 0) {
      await db.promise().query("ROLLBACK");
      return res.status(404).json({ message: "Not found" });
    }

    const [followUps] = await db.promise().query(
      "SELECT follow_up_id FROM lead_follow_up WHERE lead_id = ?", [leadId]
    );
    const ids = followUps.map(f => f.follow_up_id);

    if (ids.length > 0) {
      await db.promise().query(
        "DELETE FROM lead_follow_up_files WHERE follow_up_id IN (?)", [ids]
      );
    }

    await db.promise().query("DELETE FROM lead_follow_up WHERE lead_id = ?", [leadId]);
    await db.promise().query("DELETE FROM lead WHERE lead_id = ?", [leadId]);
    await db.promise().query("COMMIT");

    res.json({ success: true });
  } catch (err) {
    await db.promise().query("ROLLBACK");
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});


/* =====================================
   FILTER LEADS
===================================== */

router.get("/sales/leads/filter", authenticateAndAuthorize(), (req, res) => {

  const {
    company_name,
    customer_name,
    lead_title,
    product_category,
    source,
    assignee,
    status,
    from_created,
    to_created,
    from_followup,
    to_followup
  } = req.query;

  let sql = `

    SELECT 
      l.lead_id,
      l.company_name,
      l.customer_name,
      l.lead_title,

      pc.name AS product_category,

      ls.name AS source,

      l.assignee,
      l.status,
      l.created_at,

      (
        SELECT f.follow_up_date
        FROM lead_follow_up f
        WHERE f.lead_id = l.lead_id
        ORDER BY f.follow_up_date DESC
        LIMIT 1
      ) AS next_follow_up_date

    FROM lead l

    LEFT JOIN product_category pc
    ON pc.id = l.product_category

    LEFT JOIN inquiry_lead_source ls
    ON ls.id = l.source

    WHERE 1=1
    `;

  let values = [];

  if (company_name) {
    sql += " AND l.company_name = ?";
    values.push(company_name);
  }

  if (customer_name) {
    sql += " AND l.customer_name LIKE ?";
    values.push(`%${customer_name}%`);
  }

  if (lead_title) {
    sql += " AND l.lead_title LIKE ?";
    values.push(`%${lead_title}%`);
  }

  if (product_category) {
    sql += " AND l.product_category = ?";
    values.push(product_category);
  }

  if (source) {
    sql += " AND l.source = ?";
    values.push(source);
  }

  if (assignee) {
    sql += " AND FIND_IN_SET(?, l.assignee)";
    values.push(assignee);
  }

  if (status) {
    sql += " AND l.status = ?";
    values.push(status);
  }

  if (from_created && to_created) {

    sql += " AND DATE(l.created_at) BETWEEN ? AND ?";
    values.push(from_created, to_created);

  }

  if (from_followup && to_followup) {

    sql += `
      AND (
        SELECT f.follow_up_date
        FROM lead_follow_up f
        WHERE f.lead_id = l.lead_id
        ORDER BY f.follow_up_date DESC
        LIMIT 1
      ) BETWEEN ? AND ?
    `;

    values.push(from_followup, to_followup);

  }

  sql += " ORDER BY l.lead_id DESC";

  db.query(sql, values, (err, result) => {

    if (err) {

      console.log(err);

      return res.status(500).json({

        success: false,
        error: err

      });

    }

    res.json({

      success: true,
      data: result

    });

  });

});


/* =====================================
   GET CUSTOMER LIST FOR FILTER
===================================== */

router.get("/sales/leads/customers", authenticateAndAuthorize(), (req, res) => {

  const sql = `

    SELECT DISTINCT
      customer_name

    FROM lead

    WHERE customer_name IS NOT NULL
    AND customer_name != ''

    ORDER BY customer_name ASC

  `;

  db.query(sql, (err, result) => {

    if (err) {

      console.log(err);

      return res.status(500).json({

        success: false,
        error: err

      });

    }

    res.json({

      success: true,
      data: result

    });

  });

});


module.exports = router;