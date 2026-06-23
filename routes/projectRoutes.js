const express = require("express");
const router = express.Router();
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");

// Get All Projects
router.get("/list", authenticateAndAuthorize(), async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
        SELECT
          id,
          quotation_id,
          company_name,
          customer_name,
          reference,
          source,
          quotation_no,
          quotation_date,
          grand_total,
          architecture_net_amount,
          expense_net_amount,
          net_revenue_amount,
          created_at,
          updated_at
        FROM project
        ORDER BY id DESC
      `);

    res.status(200).json({
      success: true,
      totalRecords: rows.length,
      data: rows,
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
        COALESCE(SUM(grand_total), 0) as total_revenue,
        COALESCE(SUM(architecture_net_amount), 0) as total_architecture_net,
        COALESCE(SUM(expense_net_amount), 0) as total_expense_net,
        COALESCE(SUM(net_revenue_amount), 0) as total_net_revenue
      FROM project
    `);

    // 2. Expenses by category
    const [expenseByCategory] = await db.promise().query(`
      SELECT 
        expense_category,
        COALESCE(SUM(expense_amount), 0) as total_amount
      FROM project_expense
      GROUP BY expense_category
      ORDER BY total_amount DESC
    `);

    // 3. Architecture by architect
    const [architectureByArchitect] = await db.promise().query(`
      SELECT 
        architecture_name,
        COALESCE(SUM(architecture_amount), 0) as total_amount
      FROM project_architecture
      GROUP BY architecture_name
      ORDER BY total_amount DESC
    `);

    // 4. Expenses over time (Weekly, Monthly, Yearly)
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

    // 5. Revenues/Net over time (Monthly)
    const [monthlyFinancials] = await db.promise().query(`
      SELECT 
        DATE_FORMAT(created_at, '%Y-%m') as month_key,
        DATE_FORMAT(MIN(created_at), '%b %Y') as month_name,
        COALESCE(SUM(grand_total), 0) as revenue,
        COALESCE(SUM(architecture_net_amount), 0) as architecture,
        COALESCE(SUM(expense_net_amount), 0) as expenses,
        COALESCE(SUM(net_revenue_amount), 0) as net_revenue
      FROM project
      GROUP BY month_key
      ORDER BY month_key ASC
      LIMIT 12
    `);

    // 6. Top projects by net revenue
    const [topProjects] = await db.promise().query(`
      SELECT 
        id,
        company_name,
        customer_name,
        grand_total,
        net_revenue_amount
      FROM project
      ORDER BY net_revenue_amount DESC
      LIMIT 5
    `);

    res.status(200).json({
      success: true,
      data: {
        stats: projectStats[0],
        expenseByCategory,
        architectureByArchitect,
        expensesOverTime: {
          weekly: weeklyExpenses.reverse(),
          monthly: monthlyExpenses.reverse(),
          yearly: yearlyExpenses.reverse()
        },
        monthlyFinancials,
        topProjects
      }
    });
  } catch (error) {
    console.error("GET PROJECT ANALYTICS DASHBOARD ERROR:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// Get currently assigned architectures for a project
router.get("/:id/architectures", authenticateAndAuthorize(), async (req, res) => {
  const projectId = req.params.id;
  try {
    const [rows] = await db.promise().query(
      `SELECT id, project_id, architecture_name, mobile_no, address, email, architecture_amount, percentage, created_at 
       FROM project_architecture 
       WHERE project_id = ?`,
      [projectId]
    );

    res.status(200).json({
      success: true,
      data: rows,
    });
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

    // 1. Get project details to get grand_total and current expense_net_amount
    const [projectRows] = await connection.query(
      "SELECT grand_total, expense_net_amount FROM project WHERE id = ?",
      [projectId]
    );
    if (projectRows.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: "Project not found" });
    }
    const grandTotal = Number(projectRows[0].grand_total) || 0;
    const expenseNetAmount = Number(projectRows[0].expense_net_amount) || 0;

    // 2. Delete existing architecture assignments for this project
    await connection.query(
      "DELETE FROM project_architecture WHERE project_id = ?",
      [projectId]
    );

    let totalArchitectureAmount = 0;

    // 3. Insert new architectures
    for (const arch of architectures) {
      const percentage = Number(arch.percentage) || 0;
      const amount = Number(arch.architecture_amount) || 0;
      totalArchitectureAmount += amount;

      // Insert into project_architecture
      await connection.query(
        `INSERT INTO project_architecture 
         (project_id, architecture_name, mobile_no, address, email, architecture_amount, percentage)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          projectId,
          arch.name || arch.architecture_name,
          arch.mobile_no || null,
          arch.address || null,
          arch.email || null,
          amount,
          percentage
        ]
      );
    }

    // 4. Calculate net_revenue_amount = grand_total - totalArchitectureAmount - expenseNetAmount
    const netRevenue = grandTotal - totalArchitectureAmount - expenseNetAmount;

    // 5. Update project table (architecture_net_amount and net_revenue_amount)
    await connection.query(
      `UPDATE project 
       SET architecture_net_amount = ?,
           net_revenue_amount = ?
       WHERE id = ?`,
      [totalArchitectureAmount, netRevenue, projectId]
    );

    await connection.commit();
    connection.release();

    res.status(200).json({
      success: true,
      message: "Project architectures updated successfully.",
      data: {
        architecture_net_amount: totalArchitectureAmount,
        expense_net_amount: expenseNetAmount,
        net_revenue_amount: netRevenue
      }
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
    const [rows] = await db.promise().query(
      "SELECT id, project_id, expense_category, description, expense_amount, created_at, updated_at FROM project_expense WHERE project_id = ? ORDER BY id ASC",
      [projectId]
    );
    res.status(200).json({
      success: true,
      data: rows,
    });
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

    // 1. Get project details to get grand_total and architecture_net_amount
    const [projectRows] = await connection.query(
      "SELECT grand_total, architecture_net_amount FROM project WHERE id = ?",
      [projectId]
    );
    if (projectRows.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: "Project not found" });
    }
    const grandTotal = Number(projectRows[0].grand_total) || 0;
    const architectureNetAmount = Number(projectRows[0].architecture_net_amount) || 0;

    // 2. Delete existing expenses for this project
    await connection.query(
      "DELETE FROM project_expense WHERE project_id = ?",
      [projectId]
    );

    let totalExpenseAmount = 0;

    // 3. Insert new expenses
    for (const exp of expenses) {
      const amount = Number(exp.expense_amount) || 0;
      totalExpenseAmount += amount;

      await connection.query(
        `INSERT INTO project_expense 
         (project_id, expense_category, description, expense_amount)
         VALUES (?, ?, ?, ?)`,
        [
          projectId,
          exp.expense_category,
          exp.description || null,
          amount
        ]
      );
    }

    // 4. Calculate net_revenue_amount = grand_total - architectureNetAmount - totalExpenseAmount
    const netRevenue = grandTotal - architectureNetAmount - totalExpenseAmount;

    // 5. Update project table (expense_net_amount and net_revenue_amount)
    await connection.query(
      `UPDATE project 
       SET expense_net_amount = ?,
           net_revenue_amount = ?
       WHERE id = ?`,
      [totalExpenseAmount, netRevenue, projectId]
    );

    await connection.commit();
    connection.release();

    res.status(200).json({
      success: true,
      message: "Project expenses updated successfully.",
      data: {
        architecture_net_amount: architectureNetAmount,
        expense_net_amount: totalExpenseAmount,
        net_revenue_amount: netRevenue
      }
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
  const { company_name, customer_name, reference, source, grand_total } = req.body;

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Fetch existing project to get architecture_net_amount and expense_net_amount
    const [projectRows] = await connection.query(
      "SELECT architecture_net_amount, expense_net_amount FROM project WHERE id = ?",
      [projectId]
    );
    if (projectRows.length === 0) {
      connection.release();
      return res.status(404).json({ success: false, message: "Project not found" });
    }

    const archNet = Number(projectRows[0].architecture_net_amount) || 0;
    const expNet = Number(projectRows[0].expense_net_amount) || 0;
    const gTotal = Number(grand_total) || 0;

    const netRevenue = gTotal - archNet - expNet;

    await connection.query(
      `UPDATE project 
       SET company_name = ?,
           customer_name = ?,
           reference = ?,
           source = ?,
           grand_total = ?,
           net_revenue_amount = ?
       WHERE id = ?`,
      [company_name, customer_name, reference, source, gTotal, netRevenue, projectId]
    );

    await connection.commit();
    connection.release();

    res.status(200).json({
      success: true,
      message: "Project details updated successfully.",
      data: {
        id: projectId,
        company_name,
        customer_name,
        reference,
        source,
        grand_total: gTotal,
        net_revenue_amount: netRevenue
      }
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
