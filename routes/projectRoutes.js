const express = require("express");
const router = express.Router();
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

// Get All Projects
router.get("/list", authenticateAndAuthorize(), async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limitQuery = req.query.limit;
    const search = req.query.search ? req.query.search.trim() : "";

    let whereConditions = [];
    let queryParams = [];

    if (search) {
      whereConditions.push("(p.company_name LIKE ? OR p.customer_name LIKE ? OR p.quotation_no LIKE ? OR p.reference LIKE ?)");
      const sTerm = `%${search}%`;
      queryParams.push(sTerm, sTerm, sTerm, sTerm);
    }

    const whereClause = whereConditions.length > 0 ? " WHERE " + whereConditions.join(" AND ") : "";

    const [countResult] = await db.promise().query(`SELECT COUNT(*) AS total FROM project p ${whereClause}`, queryParams);
    const totalRecords = countResult[0]?.total || 0;

    const limit = limitQuery === "all" ? null : (parseInt(limitQuery) || 25);
    const offset = (page - 1) * (limit || 25);

    let sql = `
        SELECT
          p.id,
          p.quotation_id,
          p.company_name,
          p.customer_name,
          p.reference,
          COALESCE(ls.name, p.source) AS source,
          p.quotation_no,
          p.quotation_date,
          p.grand_total,
          p.amount,
          p.architecture_net_amount,
          p.expense_net_amount,
          p.net_revenue_amount,
          p.created_at,
          p.updated_at
        FROM project p
        LEFT JOIN inquiry_lead_source ls ON ls.id = p.source
        ${whereClause}
        ORDER BY p.id DESC
      `;

    let finalParams = [...queryParams];
    if (limit !== null) {
      sql += ` LIMIT ? OFFSET ?`;
      finalParams.push(limit, offset);
    }

    const [rows] = await db.promise().query(sql, finalParams);

    res.status(200).json({
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
  } catch (error) {
    console.log(error);

    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// Get Project Analytics Dashboard Data
router.get("/analytics/dashboard", authenticateAndAuthorize(), async (req, res) => {
  try {
    // 1. Overall stats
    const [projectStats] = await db.promise().query(`
      SELECT 
        COUNT(id) as total_projects,
        COALESCE(SUM(amount), 0) as total_revenue,
        COALESCE(SUM(architecture_net_amount), 0) as total_architecture_net,
        COALESCE(SUM(expense_net_amount), 0) as total_expense_net,
        COALESCE(SUM(net_revenue_amount), 0) as total_net_revenue
      FROM project
    `);

    // 2. Quick Summary Data
    const [quickSummary] = await db.promise().query(`
      SELECT 
        MAX(amount) as highest_project_value,
        MAX(architecture_net_amount) as highest_architect_cost,
        COALESCE(SUM(expense_net_amount), 0) as total_operation_cost,
        AVG(amount) as average_project_value,
        COALESCE(SUM(net_revenue_amount), 0) as balance_amount
      FROM project
    `);

    // 3. Expenses by category
    const [expenseByCategory] = await db.promise().query(`
      SELECT 
        expense_category,
        COALESCE(SUM(expense_amount), 0) as total_amount
      FROM project_expense
      GROUP BY expense_category
      ORDER BY total_amount DESC
    `);

    // 4. Architecture by architect
    const [architectureByArchitect] = await db.promise().query(`
      SELECT 
        architecture_name,
        COALESCE(SUM(architecture_amount), 0) as total_amount
      FROM project_architecture
      GROUP BY architecture_name
      ORDER BY total_amount DESC
    `);

    // 5. Expenses over time (Weekly, Monthly, Yearly)
    const [weeklyExpenses] = await db.promise().query(`
      SELECT 
        YEARWEEK(created_at, 1) as week_key,
        DATE_FORMAT(MIN(created_at), '%Y-%m-%d') as week_start,
        COALESCE(SUM(expense_amount), 0) as amount
      FROM project_expense
      GROUP BY week_key
      ORDER BY week_key DESC
      LIMIT 12
    `);

    const [monthlyExpenses] = await db.promise().query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month_key,
        DATE_FORMAT(MIN(created_at), '%b %Y') as month_name,
        COALESCE(SUM(expense_amount), 0) as amount
      FROM project_expense
      GROUP BY month_key
      ORDER BY month_key DESC
      LIMIT 12
    `);

    const [yearlyExpenses] = await db.promise().query(`
      SELECT 
        YEAR(created_at) as year_key,
        COALESCE(SUM(expense_amount), 0) as amount
      FROM project_expense
      GROUP BY year_key
      ORDER BY year_key DESC
    `);

    // 6. Revenues/Net over time (Monthly, Quarterly, Yearly)
    const [monthlyFinancials] = await db.promise().query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as time_key,
        DATE_FORMAT(MIN(created_at), '%b %Y') as time_label,
        COALESCE(SUM(amount), 0) as revenue,
        COALESCE(SUM(architecture_net_amount), 0) as architecture,
        COALESCE(SUM(expense_net_amount), 0) as expenses,
        COALESCE(SUM(net_revenue_amount), 0) as net_revenue
      FROM project
      GROUP BY time_key
      ORDER BY time_key ASC
      LIMIT 12
    `);

    const [quarterlyFinancials] = await db.promise().query(`
      SELECT 
        CONCAT(YEAR(created_at), '-Q', QUARTER(created_at)) as time_key,
        CONCAT('Q', QUARTER(created_at), ' ', YEAR(created_at)) as time_label,
        COALESCE(SUM(amount), 0) as revenue,
        COALESCE(SUM(architecture_net_amount), 0) as architecture,
        COALESCE(SUM(expense_net_amount), 0) as expenses,
        COALESCE(SUM(net_revenue_amount), 0) as net_revenue
      FROM project
      GROUP BY time_key
      ORDER BY time_key ASC
      LIMIT 12
    `);

    const [yearlyFinancials] = await db.promise().query(`
      SELECT 
        YEAR(created_at) as time_key,
        CAST(YEAR(created_at) AS CHAR) as time_label,
        COALESCE(SUM(amount), 0) as revenue,
        COALESCE(SUM(architecture_net_amount), 0) as architecture,
        COALESCE(SUM(expense_net_amount), 0) as expenses,
        COALESCE(SUM(net_revenue_amount), 0) as net_revenue
      FROM project
      GROUP BY time_key
      ORDER BY time_key ASC
      LIMIT 5
    `);

    // 7. Top projects by net revenue (Balance Amount)
    const [topProjects] = await db.promise().query(`
      SELECT 
        id,
        company_name,
        customer_name,
        amount,
        grand_total,
        net_revenue_amount
      FROM project
      ORDER BY net_revenue_amount DESC
      LIMIT 5
    `);

    // 8. Recent projects
    const [recentProjects] = await db.promise().query(`
      SELECT 
        id,
        quotation_no,
        customer_name,
        amount
      FROM project
      ORDER BY id DESC
      LIMIT 5
    `);

    res.status(200).json({
      success: true,
      data: {
        stats: projectStats[0],
        quickSummary: quickSummary[0],
        expenseByCategory,
        architectureByArchitect,
        expensesOverTime: {
          weekly: weeklyExpenses.reverse(),
          monthly: monthlyExpenses.reverse(),
          yearly: yearlyExpenses.reverse()
        },
        financialsOverTime: {
          monthly: monthlyFinancials,
          quarterly: quarterlyFinancials,
          yearly: yearlyFinancials
        },
        topProjects,
        recentProjects
      }
    });
  } catch (error) {
    console.error("GET PROJECT ANALYTICS DASHBOARD ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

function getBaseQuotationNo(quotationNo) {
  if (!quotationNo) return "";
  return String(quotationNo).split("/")[0].trim();
}

// Get currently assigned architectures for a project
router.get("/:id/architectures", authenticateAndAuthorize(), async (req, res) => {
  const projectId = req.params.id;
  try {
    const [targetRows] = await db.promise().query(
      "SELECT quotation_no, amount FROM project WHERE id = ?",
      [projectId]
    );
    const quotationNo = targetRows.length > 0 ? targetRows[0].quotation_no : null;
    const baseQuotationNo = getBaseQuotationNo(quotationNo);

    let groupProjects = [];
    if (baseQuotationNo) {
      const [groupRows] = await db.promise().query(
        "SELECT id, amount FROM project WHERE TRIM(SUBSTRING_INDEX(quotation_no, '/', 1)) = ?",
        [baseQuotationNo]
      );
      groupProjects = groupRows;
    }
    if (groupProjects.length === 0 && targetRows.length > 0) {
      groupProjects = [{ id: projectId, amount: targetRows[0].amount }];
    }

    const totalGroupAmount = groupProjects.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const groupProjectIds = groupProjects.map((r) => r.id);

    if (groupProjectIds.length > 1) {
      const [rows] = await db.promise().query(
        `SELECT 
           architecture_name, 
           MAX(mobile_no) as mobile_no, 
           MAX(address) as address, 
           MAX(email) as email, 
           SUM(architecture_amount) as architecture_amount, 
           MAX(percentage) as percentage 
         FROM project_architecture 
         WHERE project_id IN (?)
         GROUP BY architecture_name`,
        [groupProjectIds]
      );
      res.status(200).json({
        success: true,
        totalGroupAmount,
        data: rows,
      });
    } else {
      const [rows] = await db.promise().query(
        `SELECT id, project_id, architecture_name, mobile_no, address, email, architecture_amount, percentage, created_at 
         FROM project_architecture 
         WHERE project_id = ?`,
        [projectId]
      );
      res.status(200).json({
        success: true,
        totalGroupAmount,
        data: rows,
      });
    }
  } catch (error) {
    console.error("GET PROJECT ARCHITECTURES ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add or update project architecture
router.post("/:id/architectures", authenticateAndAuthorize(), async (req, res) => {
  const projectId = req.params.id;
  const { architectures } = req.body; // Array of { name, mobile_no, address, email, percentage, architecture_amount }

  if (!Array.isArray(architectures)) {
    return res.status(400).json({ success: false, message: "Architectures must be an array" });
  }

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [targetRows] = await connection.query(
      "SELECT quotation_no FROM project WHERE id = ?",
      [projectId]
    );
    if (targetRows.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const baseQuotationNo = getBaseQuotationNo(targetRows[0].quotation_no);

    let groupProjects = [];
    if (baseQuotationNo) {
      const [gRows] = await connection.query(
        "SELECT id, amount, expense_net_amount FROM project WHERE TRIM(SUBSTRING_INDEX(quotation_no, '/', 1)) = ?",
        [baseQuotationNo]
      );
      groupProjects = gRows;
    }

    if (groupProjects.length === 0) {
      const [pRows] = await connection.query(
        "SELECT id, amount, expense_net_amount FROM project WHERE id = ?",
        [projectId]
      );
      groupProjects = pRows;
    }

    const totalGroupAmount = groupProjects.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const groupProjectIds = groupProjects.map((p) => p.id);

    // Delete existing architectures for all projects in group
    await connection.query(
      "DELETE FROM project_architecture WHERE project_id IN (?)",
      [groupProjectIds]
    );

    let targetProjectData = { architecture_net_amount: 0, expense_net_amount: 0, net_revenue_amount: 0 };

    for (let i = 0; i < groupProjects.length; i++) {
      const proj = groupProjects[i];
      const projAmount = Number(proj.amount) || 0;
      const ratio = totalGroupAmount > 0 ? projAmount / totalGroupAmount : 1 / groupProjects.length;

      let totalArchForProj = 0;

      for (const arch of architectures) {
        const fullArchAmount = Number(arch.architecture_amount) || 0;
        const percentage = Number(arch.percentage) || 0;

        let archAmountForP = Math.round(fullArchAmount * ratio * 100) / 100;
        totalArchForProj += archAmountForP;

        await connection.query(
          `INSERT INTO project_architecture 
           (project_id, architecture_name, mobile_no, address, email, architecture_amount, percentage)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            proj.id,
            arch.name || arch.architecture_name,
            arch.mobile_no || null,
            arch.address || null,
            arch.email || null,
            archAmountForP,
            percentage,
          ]
        );
      }

      const expNet = Number(proj.expense_net_amount) || 0;
      const netRev = projAmount - totalArchForProj - expNet;

      await connection.query(
        `UPDATE project 
         SET architecture_net_amount = ?,
             net_revenue_amount = ?
         WHERE id = ?`,
        [totalArchForProj, netRev, proj.id]
      );

      if (String(proj.id) === String(projectId)) {
        targetProjectData = {
          architecture_net_amount: totalArchForProj,
          expense_net_amount: expNet,
          net_revenue_amount: netRev,
        };
      }
    }

    await connection.commit();
    connection.release();

    res.status(200).json({
      success: true,
      message: "Project architectures updated successfully.",
      data: targetProjectData,
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error("POST PROJECT ARCHITECTURES ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get all expenses for a project
router.get("/:id/expenses", authenticateAndAuthorize(), async (req, res) => {
  const projectId = req.params.id;
  try {
    const [targetRows] = await db.promise().query(
      "SELECT quotation_no, amount FROM project WHERE id = ?",
      [projectId]
    );
    const quotationNo = targetRows.length > 0 ? targetRows[0].quotation_no : null;
    const baseQuotationNo = getBaseQuotationNo(quotationNo);

    let groupProjects = [];
    if (baseQuotationNo) {
      const [groupRows] = await db.promise().query(
        "SELECT id, amount FROM project WHERE TRIM(SUBSTRING_INDEX(quotation_no, '/', 1)) = ?",
        [baseQuotationNo]
      );
      groupProjects = groupRows;
    }
    if (groupProjects.length === 0 && targetRows.length > 0) {
      groupProjects = [{ id: projectId, amount: targetRows[0].amount }];
    }

    const totalGroupAmount = groupProjects.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const groupProjectIds = groupProjects.map((r) => r.id);

    if (groupProjectIds.length > 1) {
      const [rows] = await db.promise().query(
        `SELECT 
           expense_category, 
           description, 
           SUM(expense_amount) as expense_amount 
         FROM project_expense 
         WHERE project_id IN (?)
         GROUP BY expense_category, description
         ORDER BY MIN(id) ASC`,
        [groupProjectIds]
      );
      res.status(200).json({
        success: true,
        totalGroupAmount,
        data: rows,
      });
    } else {
      const [rows] = await db.promise().query(
        "SELECT id, project_id, expense_category, description, expense_amount, created_at, updated_at FROM project_expense WHERE project_id = ? ORDER BY id ASC",
        [projectId]
      );
      res.status(200).json({
        success: true,
        totalGroupAmount,
        data: rows,
      });
    }
  } catch (error) {
    console.error("GET PROJECT EXPENSES ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Add or update project expenses
router.post("/:id/expenses", authenticateAndAuthorize(), async (req, res) => {
  const projectId = req.params.id;
  const { expenses } = req.body; // Array of { expense_category, description, expense_amount }

  if (!Array.isArray(expenses)) {
    return res.status(400).json({ success: false, message: "Expenses must be an array" });
  }

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [targetRows] = await connection.query(
      "SELECT quotation_no FROM project WHERE id = ?",
      [projectId]
    );
    if (targetRows.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const baseQuotationNo = getBaseQuotationNo(targetRows[0].quotation_no);

    let groupProjects = [];
    if (baseQuotationNo) {
      const [gRows] = await connection.query(
        "SELECT id, amount, architecture_net_amount FROM project WHERE TRIM(SUBSTRING_INDEX(quotation_no, '/', 1)) = ?",
        [baseQuotationNo]
      );
      groupProjects = gRows;
    }

    if (groupProjects.length === 0) {
      const [pRows] = await connection.query(
        "SELECT id, amount, architecture_net_amount FROM project WHERE id = ?",
        [projectId]
      );
      groupProjects = pRows;
    }

    const totalGroupAmount = groupProjects.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
    const groupProjectIds = groupProjects.map((p) => p.id);

    // Delete existing expenses for all projects in group
    await connection.query(
      "DELETE FROM project_expense WHERE project_id IN (?)",
      [groupProjectIds]
    );

    let targetProjectData = { architecture_net_amount: 0, expense_net_amount: 0, net_revenue_amount: 0 };

    for (let i = 0; i < groupProjects.length; i++) {
      const proj = groupProjects[i];
      const projAmount = Number(proj.amount) || 0;
      const ratio = totalGroupAmount > 0 ? projAmount / totalGroupAmount : 1 / groupProjects.length;

      let totalExpForProj = 0;

      for (const exp of expenses) {
        const fullExpAmount = Number(exp.expense_amount) || 0;
        let expAmountForP = Math.round(fullExpAmount * ratio * 100) / 100;
        totalExpForProj += expAmountForP;

        await connection.query(
          `INSERT INTO project_expense 
           (project_id, expense_category, description, expense_amount)
           VALUES (?, ?, ?, ?)`,
          [
            proj.id,
            exp.expense_category,
            exp.description || null,
            expAmountForP,
          ]
        );
      }

      const archNet = Number(proj.architecture_net_amount) || 0;
      const netRev = projAmount - archNet - totalExpForProj;

      await connection.query(
        `UPDATE project 
         SET expense_net_amount = ?,
             net_revenue_amount = ?
         WHERE id = ?`,
        [totalExpForProj, netRev, proj.id]
      );

      if (String(proj.id) === String(projectId)) {
        targetProjectData = {
          architecture_net_amount: archNet,
          expense_net_amount: totalExpForProj,
          net_revenue_amount: netRev,
        };
      }
    }

    await connection.commit();
    connection.release();

    res.status(200).json({
      success: true,
      message: "Project expenses updated successfully.",
      data: targetProjectData,
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error("POST PROJECT EXPENSES ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Update project details
router.put("/update/:id", authenticateAndAuthorize(), async (req, res) => {
  const projectId = req.params.id;
  const { company_name, customer_name, reference, source, grand_total, amount } = req.body;

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [targetRows] = await connection.query(
      "SELECT quotation_no FROM project WHERE id = ?",
      [projectId]
    );
    if (targetRows.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const gTotal = Number(grand_total) || 0;
    const baseAmt = Number(amount) || 0;

    // Update target project amount & basic fields
    await connection.query(
      `UPDATE project 
       SET company_name = ?,
           customer_name = ?,
           reference = ?,
           source = ?,
           grand_total = ?,
           amount = ?
       WHERE id = ?`,
      [company_name, customer_name, reference, source, gTotal, baseAmt, projectId]
    );

    const baseQuotationNo = getBaseQuotationNo(targetRows[0].quotation_no);
    let groupProjects = [];
    if (baseQuotationNo) {
      const [gRows] = await connection.query(
        "SELECT id, amount, architecture_net_amount, expense_net_amount FROM project WHERE TRIM(SUBSTRING_INDEX(quotation_no, '/', 1)) = ?",
        [baseQuotationNo]
      );
      groupProjects = gRows;
    }
    if (groupProjects.length === 0) {
      const [pRows] = await connection.query(
        "SELECT id, amount, architecture_net_amount, expense_net_amount FROM project WHERE id = ?",
        [projectId]
      );
      groupProjects = pRows;
    }

    const totalGroupAmount = groupProjects.reduce(
      (sum, p) => sum + (Number(p.id === Number(projectId) ? baseAmt : p.amount) || 0),
      0
    );
    const groupProjectIds = groupProjects.map((p) => p.id);

    // Fetch existing architecture items for group
    const [allArchs] = await connection.query(
      `SELECT architecture_name, MAX(mobile_no) as mobile_no, MAX(address) as address, MAX(email) as email, SUM(architecture_amount) as architecture_amount, MAX(percentage) as percentage 
       FROM project_architecture WHERE project_id IN (?) GROUP BY architecture_name`,
      [groupProjectIds]
    );

    // Fetch existing expense items for group
    const [allExps] = await connection.query(
      `SELECT expense_category, description, SUM(expense_amount) as expense_amount 
       FROM project_expense WHERE project_id IN (?) GROUP BY expense_category, description`,
      [groupProjectIds]
    );

    if (allArchs.length > 0 || allExps.length > 0) {
      if (allArchs.length > 0) {
        await connection.query("DELETE FROM project_architecture WHERE project_id IN (?)", [
          groupProjectIds,
        ]);
        for (const proj of groupProjects) {
          const projAmt = Number(proj.id === Number(projectId) ? baseAmt : proj.amount) || 0;
          const ratio = totalGroupAmount > 0 ? projAmt / totalGroupAmount : 1 / groupProjects.length;
          let totalArchForP = 0;
          for (const arch of allArchs) {
            const fullAmt = Number(arch.architecture_amount) || 0;
            const pArchAmt = Math.round(fullAmt * ratio * 100) / 100;
            totalArchForP += pArchAmt;
            await connection.query(
              `INSERT INTO project_architecture (project_id, architecture_name, mobile_no, address, email, architecture_amount, percentage)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                proj.id,
                arch.architecture_name,
                arch.mobile_no,
                arch.address,
                arch.email,
                pArchAmt,
                arch.percentage,
              ]
            );
          }
          await connection.query("UPDATE project SET architecture_net_amount = ? WHERE id = ?", [
            totalArchForP,
            proj.id,
          ]);
        }
      }

      if (allExps.length > 0) {
        await connection.query("DELETE FROM project_expense WHERE project_id IN (?)", [
          groupProjectIds,
        ]);
        for (const proj of groupProjects) {
          const projAmt = Number(proj.id === Number(projectId) ? baseAmt : proj.amount) || 0;
          const ratio = totalGroupAmount > 0 ? projAmt / totalGroupAmount : 1 / groupProjects.length;
          let totalExpForP = 0;
          for (const exp of allExps) {
            const fullAmt = Number(exp.expense_amount) || 0;
            const pExpAmt = Math.round(fullAmt * ratio * 100) / 100;
            totalExpForP += pExpAmt;
            await connection.query(
              `INSERT INTO project_expense (project_id, expense_category, description, expense_amount)
               VALUES (?, ?, ?, ?)`,
              [proj.id, exp.expense_category, exp.description, pExpAmt]
            );
          }
          await connection.query("UPDATE project SET expense_net_amount = ? WHERE id = ?", [
            totalExpForP,
            proj.id,
          ]);
        }
      }
    }

    for (const proj of groupProjects) {
      const [updatedProjRows] = await connection.query(
        "SELECT amount, architecture_net_amount, expense_net_amount FROM project WHERE id = ?",
        [proj.id]
      );
      if (updatedProjRows.length > 0) {
        const pAmt = Number(updatedProjRows[0].amount) || 0;
        const aNet = Number(updatedProjRows[0].architecture_net_amount) || 0;
        const eNet = Number(updatedProjRows[0].expense_net_amount) || 0;
        const nRev = pAmt - aNet - eNet;
        await connection.query("UPDATE project SET net_revenue_amount = ? WHERE id = ?", [
          nRev,
          proj.id,
        ]);
      }
    }

    await connection.commit();
    connection.release();

    const [finalTarget] = await db
      .promise()
      .query("SELECT * FROM project WHERE id = ?", [projectId]);
    res.status(200).json({
      success: true,
      message: "Project details updated successfully.",
      data: finalTarget[0] || {},
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error("UPDATE PROJECT ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Delete project
router.delete("/delete/:id", authenticateAndAuthorize(), async (req, res) => {
  const projectId = req.params.id;
  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Delete project architecture references
    await connection.query("DELETE FROM project_architecture WHERE project_id = ?", [projectId]);

    // Delete project expense references
    await connection.query("DELETE FROM project_expense WHERE project_id = ?", [projectId]);

    // Delete project itself
    await connection.query("DELETE FROM project WHERE id = ?", [projectId]);

    await connection.commit();
    connection.release();

    res.status(200).json({
      success: true,
      message: "Project and associated data deleted successfully.",
    });
  } catch (error) {
    await connection.rollback();
    connection.release();
    console.error("DELETE PROJECT ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
