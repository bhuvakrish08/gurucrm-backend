const express = require("express");
const db = require("../db");
const authenticateToken = require("../middlewares/authMiddleware");

const router = express.Router();

router.post("/add", authenticateToken(), (req, res) => {

  const user_id = req.user.id;
  const data = req.body;

  // get connection from pool
  db.getConnection((err, connection) => {

    if (err) {

      console.error("Connection error:", err);

      return res.status(500).json({
        success:false,
        message:"DB connection failed"
      });

    }


    connection.beginTransaction((err) => {

      if (err) {

        connection.release();

        return res.status(500).json({
          success:false,
          message:"Transaction error"
        });

      }


      // 1. insert customer
      const customerSql = `

        INSERT INTO customer_data

        (
          user_id,
          company_name,
          customer_type,
          customer_name,
          email,
          mobile,
          industry,
          website,
          remarks
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)

      `;


      connection.query(

        customerSql,

        [

          user_id,
          data.company_name,
          data.customer_type,
          data.customer_name,
          data.email,
          data.mobile,
          data.industry,
          data.website,
          data.remarks

        ],

        (err, result) => {

          if (err) {

            return connection.rollback(() => {

              connection.release();

              res.status(500).json({
                error: err.message
              });

            });

          }


          const customer_id =
            result.insertId;


          // 2. insert address

          const addressSql = `

            INSERT INTO customer_address

            (customer_id, address_type, address)

            VALUES (?, ?, ?)

          `;


          connection.query(

            addressSql,

            [

              customer_id,
              data.address_type,
              data.address

            ],

            (err) => {

              if (err) {

                return connection.rollback(() => {

                  connection.release();

                  res.status(500).json({
                    error: err.message
                  });

                });

              }


              // 3. insert GST

              const gstSql = `

                INSERT INTO customer_gst

                (customer_id, gst_type, gst_number, state)

                VALUES (?, ?, ?, ?)

              `;


              connection.query(

                gstSql,

                [

                  customer_id,
                  data.gst_type,
                  data.gst_number,
                  data.gst_state

                ],

                (err) => {

                  if (err) {

                    return connection.rollback(() => {

                      connection.release();

                      res.status(500).json({
                        error: err.message
                      });

                    });

                  }


                  // commit transaction

                  connection.commit((err) => {

                    if (err) {

                      return connection.rollback(() => {

                        connection.release();

                        res.status(500).json({
                          error: err.message
                        });

                      });

                    }


                    connection.release();

                    // LOG ACTIVITY
                    const userName = req.user?.username || "Someone";
                    const activityMsg = `${userName} added a new customer: ${data.customer_name} (${data.company_name})`;
                    db.query("INSERT INTO activities (message, user_name) VALUES (?, ?)", [activityMsg, userName]);

                    res.json({

                      success:true,
                      message:"Customer added successfully",
                      customer_id

                    });

                  });

                }

              );

            }

          );

        }

      );

    });

  });

});




// Get customer list with search, filters & sorting
router.get("/get-customers", (req, res) => {

  const {
    search = "",
    customer_name = "",
    company_name = "",
    mobile = "",
    email = "",
    industry = "",
    sortBy = "id",
    order = "ASC",
  } = req.query;

  const allowedSort = {
    id: "c.id",
    company_name: "c.company_name",
    customer_name: "c.customer_name",
    email: "c.email",
    mobile: "c.mobile",
    industry: "industry_name"
  };

  const sortColumn =
    allowedSort[sortBy] || "c.id";

  const sortOrder =
    order.toUpperCase() === "DESC"
      ? "DESC"
      : "ASC";

  let sql = `
    SELECT 
      c.id,
      c.company_name,
      c.customer_name,
      c.email,
      c.mobile,
      c.customer_type,
      c.website,
      c.industry,
      (
        SELECT name
        FROM industries
        WHERE id = c.industry
      ) AS industry_name
    FROM customer_data c
    WHERE 1=1
  `;

  const values = [];

  // GLOBAL SEARCH
  if (search.trim()) {
    sql += `
      AND (
        c.company_name LIKE ?
        OR c.customer_name LIKE ?
        OR c.email LIKE ?
        OR c.mobile LIKE ?
        OR c.customer_type LIKE ?
        OR c.website LIKE ?
        OR (
          SELECT name
          FROM industries
          WHERE id = c.industry
        ) LIKE ?
      )
    `;

    values.push(
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`,
      `%${search}%`
    );
  }

  // FILTERS
  if (company_name.trim()) {
    sql += " AND c.company_name LIKE ?";
    values.push(`%${company_name}%`);
  }

  if (customer_name.trim()) {
    sql += " AND c.customer_name LIKE ?";
    values.push(`%${customer_name}%`);
  }

  if (mobile.trim()) {
    sql += " AND c.mobile LIKE ?";
    values.push(`%${mobile}%`);
  }

  if (email.trim()) {
    sql += " AND c.email LIKE ?";
    values.push(`%${email}%`);
  }

  if (industry.trim()) {
    sql += " AND c.industry = ?";
    values.push(industry);
  }

  sql += ` ORDER BY ${sortColumn} ${sortOrder}`;

  db.query(sql, values, (err, rows) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({
        success:false,
        message:"Database error"
      });
    }

    res.json({
      success:true,
      totalRecords: rows.length,
      data: rows
    });
  });
});



// Get scrollable data for specific column with single-row scroll
router.get("/get-column-scroll", async (req, res) => {
  const { column, direction, offset = 0, limit = 10 } = req.query;

  try {
    const allowedColumns = [
      "company_name",
      "customer_name",
      "email",
      "website",
      "industry"
    ];

    if (!allowedColumns.includes(column)) {
      return res.status(400).json({ success: false, message: "Invalid column" });
    }

    // total row count
    const [countRows] = await db.promise().query("SELECT COUNT(*) AS total FROM customer_data");
    const total = countRows[0].total;

    if (total === 0) {
      return res.json({ success: false, message: "No data found" });
    }

    // single row scroll
    let newOffset = Number(offset);
    if (direction === "down") {
      newOffset = Math.min(newOffset + 1, total - limit);
    } else if (direction === "up") {
      newOffset = Math.max(newOffset - 1, 0);
    }


    let selectColumn;

    if (column === "company_name") {
      selectColumn = "o.organization_name";
    } else {
      selectColumn = `c.${column}`;
    }

    const [rows] = await db.promise().query(
      `
        SELECT ${selectColumn} AS ${column}
        FROM customer_data c
        LEFT JOIN organizations o ON o.id = c.company_name
        ORDER BY c.id ASC
        LIMIT ? OFFSET ?
      `,
      [Number(limit), newOffset]
    );



    res.json({ success: true, data: rows, newOffset, total });
  } catch (error) {
    console.error("Error fetching column scroll:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

//  Simple API: Fetch all company names
// Get UNIQUE company names (string)
router.get("/company-names", (req, res) => {

  const sql = `
    SELECT DISTINCT company_name
    FROM customer_data
    WHERE company_name IS NOT NULL
      AND company_name != ''
    ORDER BY company_name ASC
  `;

  db.query(sql, (err, rows) => {

    if (err) {

      console.error(err);

      return res.status(500).json({
        success: false,
        message: "Database error"
      });

    }

    res.json({
      success: true,
      data: rows
    });

  });

});


//  Simple API: Fetch all customer names
router.get("/customer-names", (req, res) => {
  const sql = "SELECT id, customer_name FROM customer_data ORDER BY customer_name ASC";

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Error fetching customer names:", err);
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


router.get("/customer-name", (req, res) => {
   const { company_name } = req.query;

  let sql = `
    SELECT id, customer_name
    FROM customer_data
    WHERE 1=1
  `;

  const values = [];

  if (company_name) {

    sql += " AND company_name = ?";

    values.push(company_name);

  }

  sql += " ORDER BY customer_name ASC";

  db.query(sql, values, (err, rows) => {

    if (err) {

      console.error(err);

      return res.status(500).json({
        success:false,
        message:"Database error"
      });

    }

    res.json({
      success:true,
      data:rows
    });

  });

});


// Edit Page Routes

// update Data on customer_data Table
router.put("/customer-data/:id", authenticateToken(), (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  const {
    company_name,
    customer_type,
    customer_name,
    email,
    mobile,
    industry,
    website,
    remarks
  } = req.body;

  const sql = `
    UPDATE customer_data SET user_id = ?, company_name = ?, customer_type = ?, customer_name = ?, email = ?, mobile = ?,
     industry = ?, website = ?, remarks = ? WHERE id = ?  `;

  const values = [
    user_id,
    company_name,
    customer_type,
    customer_name,
    email,
    mobile,
    industry,
    website,
    remarks,
    id
  ];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: "DB error" });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Customer not found or unauthorized"
      });
    }

    res.json({
      success: true,
      message: "Customer updated successfully"
    });
  });
});


// Read Data on customer_data & customer_gst Table
router.get("/customer/:id", authenticateToken(), (req, res) => {
  const { id } = req.params;
  const user_id = req.user.id;

  // customer_data query
  const customerQuery = `
  SELECT 
  c.id,
  c.customer_type,
  c.company_name AS company_id,
  o.organization_name,
  c.customer_name,
  c.email,
  c.mobile,
  c.industry,
  c.website,
  c.remarks
FROM customer_data c
LEFT JOIN organizations o ON o.id = c.company_name
WHERE c.id = ? AND c.user_id = ?
`;


  // customer_gst query
  const gstQuery = `
    SELECT id, gst_type, gst_number, state
    FROM customer_gst
    WHERE customer_id = ?
  `;

  db.query(customerQuery, [id, user_id], (err, customerResult) => {
    if (err) {
      return res.status(500).json({ message: "Customer query failed", error: err });
    }

    if (customerResult.length === 0) {
      return res.status(404).json({ message: "Customer not found" });
    }

    db.query(gstQuery, [id], (err, gstResult) => {
      if (err) {
        return res.status(500).json({ message: "GST query failed", error: err });
      }

      return res.status(200).json({
        customer: customerResult[0],
        gst_details: gstResult
      });
    });
  });
});


// If Exist so update Data on customer_gst Table Otherwise add new Data

router.put("/customer-gst/:customerId", authenticateToken(), (req, res) => {
  const { customerId } = req.params;
  const gstDetails = req.body.gst_details;

  if (!Array.isArray(gstDetails)) {
    return res.status(400).json({ message: "Invalid GST data" });
  }

  let updateCount = 0;
  let insertCount = 0;

  gstDetails.forEach(gst => {
    // UPDATE GST
    if (gst.id) {
      const updateSql = `
        UPDATE customer_gst
        SET gst_type = ?, gst_number = ?, state = ?
        WHERE id = ? AND customer_id = ?
      `;

      db.query(
        updateSql,
        [gst.gst_type, gst.gst_number, gst.gst_state, gst.id, customerId]
      );

      updateCount++;
    }

    // INSERT GST
    else {
      const insertSql = `
        INSERT INTO customer_gst (customer_id, gst_type, gst_number, state)
        VALUES (?, ?, ?, ?)
      `;

      db.query(
        insertSql,
        [customerId, gst.gst_type, gst.gst_number, gst.gst_state]
      );

      insertCount++;
    }
  });

  res.json({
    success: true,
    message: "GST saved",
    updated: updateCount,
    inserted: insertCount
  });
});


// Delete gst details on customer_gst Table
router.delete("/delete-gst/:id", authenticateToken(), (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM customer_gst WHERE id = ?`;

  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "gst cannot delete", error: err });
    }
    return res.status(200).json({ message: "Deleted Successfully" });
  })
})



// Insert, Read, Update, Delete Routes for customer_address



// Insert address details according customer specific

router.post("/customer-address", authenticateToken(), (req, res) => {
  const { customer_id, address_type, address } = req.body;

  const sql = ` INSERT INTO customer_address(customer_id, address_type, address) VALUES (?, ?, ?)`;

  db.query(sql, [customer_id, address_type, address], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Insert failed", error: err });
    }
    res.status(201).json({ message: "Address added successfully" });
  }
  );
});


// Read address details according customer specific
router.get("/customer-address/:customer_id", authenticateToken(), (req, res) => {
  const { customer_id } = req.params;

  const sql = `SELECT * FROM customer_address WHERE customer_id = ?`;

  db.query(sql, [customer_id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Fetch failed", error: err });
    }
    res.status(200).json(result);
  });
});


// Update address details according customer specific

router.put("/customer-address/:id", authenticateToken(), (req, res) => {
  const { id } = req.params;
  const { address_type, address } = req.body;

  const sql = `
    UPDATE customer_address SET address_type = ?, address = ?
    WHERE id = ? `;

  db.query(sql, [address_type, address, id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Update failed", error: err });
    }
    res.status(200).json({ message: "Address updated successfully" });
  }
  );
});


// Delete address details according customer specific

router.delete("/customer-address/:id", authenticateToken(), (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM customer_address WHERE id = ?`;

  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Delete failed", error: err });
    }
    res.status(200).json({ message: "Address deleted successfully" });
  });
});



// Insert, Read, Update, Delete Routes for contacts


// Insert contacts details according customer specific

router.post("/customer-contacts", authenticateToken(), (req, res) => {
  const { customer_id, company_name, customer_name, contact_person, contact_number, email, contact_designation } = req.body;

  const sql = ` INSERT INTO contacts(customer_id, company_name, customer_name, contact_person, contact_number, email, contact_designation ) VALUES (?, ?, ?, ?, ?, ?, ?)`;

  db.query(sql, [customer_id, company_name, customer_name, contact_person, contact_number, email, contact_designation], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Insert failed", error: err });
    }
    res.status(201).json({ message: "Address added successfully" });
  }
  );
});


// Read contacts details according customer specific
router.get("/customer-contacts/:customer_id", authenticateToken(), (req, res) => {

  const { customer_id } = req.params;

  const sql = `

    SELECT 
      ct.id,
      c.customer_name,      
      c.company_name,
      ct.contact_person,
      ct.contact_number,
      ct.email,
      ct.contact_designation,   
      d.name AS designation_name   
    FROM contacts ct

    JOIN customer_data c 
      ON c.id = ct.customer_id

    LEFT JOIN contact_designation d
      ON d.id = ct.contact_designation

    WHERE ct.customer_id = ?
      AND c.user_id = ?

  `;

  db.query(sql, [customer_id, req.user.id], (err, rows) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database error"
      });
    }
    res.json({ success: true, data: rows });

  });

});


// Update contacts details according customer specific

router.put("/customer-contacts/:id", authenticateToken(), (req, res) => {
  const { id } = req.params;
  const { company_name, customer_name, contact_person, contact_number, email, contact_designation } = req.body;

  const sql = `
    UPDATE contacts SET company_name = ?, customer_name = ?, contact_person = ?, contact_number = ?, email = ?, contact_designation = ? 
    WHERE id = ? `;

  db.query(sql, [company_name, customer_name, contact_person, contact_number, email, contact_designation, id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Update failed", error: err });
    }
    res.status(200).json({ message: "contacts updated successfully" });
  }
  );
});



// Delete address details according customer specific

router.delete("/customer-contacts/:id", authenticateToken(), (req, res) => {
  const { id } = req.params;

  const sql = `DELETE FROM contacts WHERE id = ?`;

  db.query(sql, [id], (err, result) => {
    if (err) {
      return res.status(500).json({ message: "Delete failed", error: err });
    }
    res.status(200).json({ message: "Contacts deleted successfully" });
  });
});


// DELETE CUSTOMER (MAIN API)
router.delete("/:id", authenticateToken(), (req, res) => {
  console.log("DELETE API HIT:", req.params.id);

  const { id } = req.params;

  db.getConnection((err, connection) => {
    if (err) {
      return res
        .status(500)
        .json({ success: false, message: "DB connection error" });
    }

    connection.beginTransaction((err) => {
      if (err) {
        connection.release();
        return res
          .status(500)
          .json({ success: false, message: "Transaction error" });
      }

      connection.query(
        "DELETE FROM contacts WHERE customer_id = ?",
        [id],
        (err) => {
          if (err) return rollback(err);

          connection.query(
            "DELETE FROM customer_address WHERE customer_id = ?",
            [id],
            (err) => {
              if (err) return rollback(err);

              connection.query(
                "DELETE FROM customer_gst WHERE customer_id = ?",
                [id],
                (err) => {
                  if (err) return rollback(err);

                  connection.query(
                    "DELETE FROM customer_data WHERE id = ?",
                    [id],
                    (err) => {
                      if (err) return rollback(err);

                      connection.commit((err) => {
                        if (err) return rollback(err);

                        connection.release();
                        res.json({
                          success: true,
                          message: "Customer deleted successfully",
                        });
                      });
                    },
                  );
                },
              );
            },
          );
        },
      );

      function rollback(error) {
        connection.rollback(() => {
          connection.release();
          res.status(500).json({ success: false, message: error.message });
        });
      }
    });
  });
});


module.exports = router;