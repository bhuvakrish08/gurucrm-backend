const express = require("express");
const router = express.Router();
const db = require("../db");

/* ============================================================
   helper — ISO date formatter
============================================================ */
function iso(d) {
  return d.toISOString().slice(0, 10);
}

/* ============================================================
   1) LOG AN EXPENSE ENTRY
   POST /api/net-profit/expense
============================================================ */
router.post("/expense", (req, res) => {
  const { expense_master_id, amount, expense_date, notes } = req.body;

  if (!expense_master_id || !amount || !expense_date) {
    return res.status(400).json({
      success: false,
      message: "expense_master_id, amount, expense_date required che",
    });
  }

  const sql = `
    INSERT INTO general_expense_entry (expense_master_id, amount, expense_date, notes)
    VALUES (?, ?, ?, ?)
  `;
  const values = [expense_master_id, amount, expense_date, notes || null];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Insert Error:", err);
      return res.status(500).json({ success: false, message: "Insert failed", error: err.message });
    }
    res.status(201).json({ success: true, message: "Expense logged", id: result.insertId });
  });
});

/* ============================================================
   2) UPDATE AN EXPENSE ENTRY
   PUT /api/net-profit/expense/:id
============================================================ */
router.put("/expense/:id", (req, res) => {
  const { id } = req.params;
  const { expense_master_id, amount, expense_date, notes } = req.body;

  if (!expense_master_id || !amount || !expense_date) {
    return res.status(400).json({
      success: false,
      message: "expense_master_id, amount, expense_date required che",
    });
  }

  const sql = `
    UPDATE general_expense_entry
    SET expense_master_id = ?, amount = ?, expense_date = ?, notes = ?
    WHERE id = ?
  `;
  const values = [expense_master_id, amount, expense_date, notes || null, id];

  db.query(sql, values, (err, result) => {
    if (err) {
      console.error("Update Error:", err);
      return res.status(500).json({ success: false, message: "Update failed", error: err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Expense entry not found" });
    }
    res.json({ success: true, message: "Expense entry updated" });
  });
});

/* ============================================================
   3) DELETE AN EXPENSE ENTRY
   DELETE /api/net-profit/expense/:id
============================================================ */
router.delete("/expense/:id", (req, res) => {
  const { id } = req.params;

  db.query("DELETE FROM general_expense_entry WHERE id = ?", [id], (err, result) => {
    if (err) {
      console.error("Delete Error:", err);
      return res.status(500).json({ success: false, message: "Delete failed", error: err.message });
    }
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Expense entry not found" });
    }
    res.json({ success: true, message: "Expense entry deleted" });
  });
});

/* ============================================================
   4) NET PROFIT CALCULATION — the main page endpoint
   GET /api/net-profit?from=2026-06-01&to=2026-06-30
   GET /api/net-profit                 <-- no params = LIFETIME (all records)
============================================================ */
router.get("/", (req, res) => {
  const { from, to } = req.query;
  // TRUE only when the client explicitly sent both dates.
  // If either is missing, we treat this as "lifetime" and skip date filtering entirely.
  const hasRange = Boolean(from && to);

  const projectSql = hasRange
    ? `SELECT id, company_name, customer_name, quotation_no, quotation_date, net_revenue_amount
       FROM project
       WHERE quotation_date BETWEEN ? AND ?
       ORDER BY quotation_date DESC`
    : `SELECT id, company_name, customer_name, quotation_no, quotation_date, net_revenue_amount
       FROM project
       ORDER BY quotation_date DESC`;
  const projectParams = hasRange ? [from, to] : [];

  db.query(projectSql, projectParams, (err, projectRows) => {
    if (err) {
      console.error("Project Fetch Error:", err);
      return res.status(500).json({ success: false, message: "Project fetch failed", error: err.message });
    }

    const expenseSql = hasRange
      ? `SELECT e.id, e.amount, e.expense_date, e.notes, m.name AS expense_name
         FROM general_expense_entry e
         JOIN general_expense_master m ON m.id = e.expense_master_id
         WHERE e.expense_date BETWEEN ? AND ?
         ORDER BY e.expense_date DESC`
      : `SELECT e.id, e.amount, e.expense_date, e.notes, m.name AS expense_name
         FROM general_expense_entry e
         JOIN general_expense_master m ON m.id = e.expense_master_id
         ORDER BY e.expense_date DESC`;
    const expenseParams = hasRange ? [from, to] : [];

    db.query(expenseSql, expenseParams, (err2, expenseRows) => {
      if (err2) {
        console.error("Expense Fetch Error:", err2);
        return res.status(500).json({ success: false, message: "Expense fetch failed", error: err2.message });
      }

      const netRevenue = projectRows.reduce((sum, p) => sum + Number(p.net_revenue_amount || 0), 0);
      const totalExpense = expenseRows.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      const netProfit = netRevenue - totalExpense;

      res.json({
        success: true,
        lifetime: !hasRange,
        from: hasRange ? from : null,
        to: hasRange ? to : null,
        netRevenue,
        totalExpense,
        netProfit,
        projects: projectRows,
        expenses: expenseRows,
      });
    });
  });
});

/* ============================================================
   5) ANALYTICS — for the Analytics tab (with period support)
   GET /api/net-profit/analytics?from=2026-06-01&to=2026-06-30&period=monthly
   GET /api/net-profit/analytics?period=monthly   <-- no from/to = LIFETIME

   NOTE: the "monthly" (trend chart) array now carries FOUR values per
   bucket so the frontend can render Amount vs Architecture Net vs
   Expense Net vs General Expense, side by side, for weekly/monthly/yearly:
     - amount            -> SUM(project.amount)
     - architecture_net  -> SUM(project.architecture_net_amount)
     - expense_net       -> SUM(project.expense_net_amount)
     - expense           -> SUM(general_expense_entry.amount)   (General Expense)
============================================================ */
router.get("/analytics", (req, res) => {
  const { from, to } = req.query;
  let { period } = req.query;
  period = ["weekly", "monthly", "yearly"].includes(period) ? period : "monthly";

  const hasRange = Boolean(from && to);

  // Anchor date for the trend chart window (last 6 months / 8 weeks / 5 years).
  // Always uses "to" if given, otherwise today — this keeps the trend chart
  // showing a recent window even in lifetime mode (a chart with EVERY historical
  // point would be unreadable, so lifetime mode widens totals/breakdowns to
  // all-time but keeps the trend chart windowed to something visually useful).
  const chartAnchor = hasRange ? to : iso(new Date());

  // rangeDays / prev-period comparison only make sense when an explicit range
  // is given. In lifetime mode we skip the "vs previous period" comparison.
  let rangeDays = 0;
  let prevFrom = null;
  let prevTo = null;
  if (hasRange) {
    const fromDate = new Date(from);
    const toDate = new Date(to);
    rangeDays = Math.round((toDate - fromDate) / 86400000) + 1;
    const pTo = new Date(fromDate);
    pTo.setDate(pTo.getDate() - 1);
    const pFrom = new Date(pTo);
    pFrom.setDate(pFrom.getDate() - rangeDays + 1);
    prevTo = iso(pTo);
    prevFrom = iso(pFrom);
  }

  const revenueSql = hasRange
    ? `SELECT IFNULL(SUM(net_revenue_amount),0) AS total FROM project WHERE quotation_date BETWEEN ? AND ?`
    : `SELECT IFNULL(SUM(net_revenue_amount),0) AS total FROM project`;
  const revenueParams = hasRange ? [from, to] : [];

  const expenseByTypeSql = hasRange
    ? `SELECT m.id, m.name, m.budget_limit, IFNULL(SUM(e.amount),0) AS total
       FROM general_expense_master m
       LEFT JOIN general_expense_entry e
         ON e.expense_master_id = m.id AND e.expense_date BETWEEN ? AND ?
       WHERE m.status = '1'
       GROUP BY m.id, m.name, m.budget_limit
       ORDER BY total DESC`
    : `SELECT m.id, m.name, m.budget_limit, IFNULL(SUM(e.amount),0) AS total
       FROM general_expense_master m
       LEFT JOIN general_expense_entry e
         ON e.expense_master_id = m.id
       WHERE m.status = '1'
       GROUP BY m.id, m.name, m.budget_limit
       ORDER BY total DESC`;
  const expenseByTypeParams = hasRange ? [from, to] : [];

  const topProjectsSql = hasRange
    ? `SELECT company_name, quotation_no, net_revenue_amount
       FROM project WHERE quotation_date BETWEEN ? AND ?
       ORDER BY net_revenue_amount DESC LIMIT 5`
    : `SELECT company_name, quotation_no, net_revenue_amount
       FROM project
       ORDER BY net_revenue_amount DESC LIMIT 5`;
  const topProjectsParams = hasRange ? [from, to] : [];

  const prevRevenueSql = `SELECT IFNULL(SUM(net_revenue_amount),0) AS total
    FROM project WHERE quotation_date BETWEEN ? AND ?`;
  const prevExpenseSql = `SELECT IFNULL(SUM(amount),0) AS total
    FROM general_expense_entry WHERE expense_date BETWEEN ? AND ?`;

  // chartProjectSql -> per-bucket SUM(amount), SUM(architecture_net_amount), SUM(expense_net_amount) from `project`
  // chartExpSql     -> per-bucket SUM(amount) from `general_expense_entry` (General Expense)
  let chartProjectSql, chartExpSql, chartParams;

  if (period === "weekly") {
    chartProjectSql = `
      SELECT YEARWEEK(quotation_date, 1) AS bucket,
        IFNULL(SUM(amount),0) AS amount,
        IFNULL(SUM(architecture_net_amount),0) AS architecture_net,
        IFNULL(SUM(expense_net_amount),0) AS expense_net
      FROM project
      WHERE quotation_date >= DATE_SUB(?, INTERVAL 8 WEEK)
      GROUP BY bucket`;
    chartExpSql = `
      SELECT YEARWEEK(expense_date, 1) AS bucket, IFNULL(SUM(amount),0) AS expense
      FROM general_expense_entry
      WHERE expense_date >= DATE_SUB(?, INTERVAL 8 WEEK)
      GROUP BY bucket`;
    chartParams = [chartAnchor];
  } else if (period === "yearly") {
    chartProjectSql = `
      SELECT YEAR(quotation_date) AS bucket,
        IFNULL(SUM(amount),0) AS amount,
        IFNULL(SUM(architecture_net_amount),0) AS architecture_net,
        IFNULL(SUM(expense_net_amount),0) AS expense_net
      FROM project
      WHERE quotation_date >= DATE_SUB(?, INTERVAL 5 YEAR)
      GROUP BY bucket`;
    chartExpSql = `
      SELECT YEAR(expense_date) AS bucket, IFNULL(SUM(amount),0) AS expense
      FROM general_expense_entry
      WHERE expense_date >= DATE_SUB(?, INTERVAL 5 YEAR)
      GROUP BY bucket`;
    chartParams = [chartAnchor];
  } else {
    chartProjectSql = `
      SELECT DATE_FORMAT(quotation_date, '%Y-%m') AS bucket,
        IFNULL(SUM(amount),0) AS amount,
        IFNULL(SUM(architecture_net_amount),0) AS architecture_net,
        IFNULL(SUM(expense_net_amount),0) AS expense_net
      FROM project
      WHERE quotation_date >= DATE_SUB(LAST_DAY(?), INTERVAL 5 MONTH) + INTERVAL 1 DAY
      GROUP BY bucket`;
    chartExpSql = `
      SELECT DATE_FORMAT(expense_date, '%Y-%m') AS bucket, IFNULL(SUM(amount),0) AS expense
      FROM general_expense_entry
      WHERE expense_date >= DATE_SUB(LAST_DAY(?), INTERVAL 5 MONTH) + INTERVAL 1 DAY
      GROUP BY bucket`;
    chartParams = [chartAnchor];
  }

  db.query(revenueSql, revenueParams, (e1, revRows) => {
    if (e1) return res.status(500).json({ success: false, message: e1.message });

    db.query(expenseByTypeSql, expenseByTypeParams, (e2, expRows) => {
      if (e2) return res.status(500).json({ success: false, message: e2.message });

      db.query(topProjectsSql, topProjectsParams, (e3, projRows) => {
        if (e3) return res.status(500).json({ success: false, message: e3.message });

        const afterPrevPeriod = (prevRevRows, prevExpRows) => {
          db.query(chartProjectSql, chartParams, (e6, chartProjectRows) => {
            if (e6) return res.status(500).json({ success: false, message: e6.message });

            db.query(chartExpSql, chartParams, (e7, chartExpRows) => {
              if (e7) return res.status(500).json({ success: false, message: e7.message });

              const netRevenue = Number(revRows[0].total || 0);
              const totalExpense = expRows.reduce((s, r) => s + Number(r.total || 0), 0);
              const netProfit = netRevenue - totalExpense;
              const profitMargin = netRevenue > 0 ? Math.round((netProfit / netRevenue) * 100) : 0;

              const prevRevenue = Number(prevRevRows[0].total || 0);
              const prevExpense = Number(prevExpRows[0].total || 0);
              const revenueChangePct = prevRevenue > 0
                ? Math.round(((netRevenue - prevRevenue) / prevRevenue) * 100) : 0;
              const expenseChangePct = prevExpense > 0
                ? Math.round(((totalExpense - prevExpense) / prevExpense) * 100) : 0;

              const avgDailyExpense = rangeDays > 0 ? Math.round(totalExpense / rangeDays) : 0;

              let chartData = [];

              if (period === "weekly") {
                const base = new Date(chartAnchor);
                for (let i = 7; i >= 0; i--) {
                  const d = new Date(base);
                  d.setDate(d.getDate() - i * 7);
                  const tmp = new Date(d);
                  const dayNum = (tmp.getDay() + 6) % 7;
                  tmp.setDate(tmp.getDate() - dayNum + 3);
                  const firstThursday = new Date(tmp.getFullYear(), 0, 4);
                  const weekNo = 1 + Math.round(((tmp - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
                  const bucketKey = Number(`${tmp.getFullYear()}${String(weekNo).padStart(2, "0")}`);
                  const projRow = chartProjectRows.find((r) => Number(r.bucket) === bucketKey);
                  const expRow = chartExpRows.find((r) => Number(r.bucket) === bucketKey);
                  chartData.push({
                    month: `W${weekNo}`,
                    amount: Number(projRow ? projRow.amount : 0),
                    architecture_net: Number(projRow ? projRow.architecture_net : 0),
                    expense_net: Number(projRow ? projRow.expense_net : 0),
                    expense: Number(expRow ? expRow.expense : 0),
                  });
                }
              } else if (period === "yearly") {
                const base = new Date(chartAnchor);
                for (let i = 4; i >= 0; i--) {
                  const y = base.getFullYear() - i;
                  const projRow = chartProjectRows.find((r) => Number(r.bucket) === y);
                  const expRow = chartExpRows.find((r) => Number(r.bucket) === y);
                  chartData.push({
                    month: String(y),
                    amount: Number(projRow ? projRow.amount : 0),
                    architecture_net: Number(projRow ? projRow.architecture_net : 0),
                    expense_net: Number(projRow ? projRow.expense_net : 0),
                    expense: Number(expRow ? expRow.expense : 0),
                  });
                }
              } else {
                const base = new Date(chartAnchor);
                for (let i = 5; i >= 0; i--) {
                  const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
                  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                  const label = d.toLocaleString("en-US", { month: "short" });
                  const projRow = chartProjectRows.find((r) => r.bucket === ym);
                  const expRow = chartExpRows.find((r) => r.bucket === ym);
                  chartData.push({
                    month: label,
                    amount: Number(projRow ? projRow.amount : 0),
                    architecture_net: Number(projRow ? projRow.architecture_net : 0),
                    expense_net: Number(projRow ? projRow.expense_net : 0),
                    expense: Number(expRow ? expRow.expense : 0),
                  });
                }
              }

              res.json({
                success: true,
                lifetime: !hasRange,
                from: hasRange ? from : null,
                to: hasRange ? to : null,
                period,
                profitMargin,
                revenueChangePct,
                expenseChangePct,
                avgDailyExpense,
                monthly: chartData,
                expenseBreakdown: expRows
                  .filter((r) => Number(r.total) > 0)
                  .map((r) => ({ name: r.name, amount: Number(r.total) })),
                topExpenseCategories: expRows
                  .filter((r) => Number(r.total) > 0)
                  .sort((a, b) => b.total - a.total)
                  .slice(0, 5)
                  .map((r) => ({ name: r.name, amount: Number(r.total) })),
                topProjects: projRows.map((p) => ({
                  name: p.company_name,
                  quotation_no: p.quotation_no,
                  amount: Number(p.net_revenue_amount),
                })),
                budgetTracking: expRows.map((r) => ({
                  name: r.name,
                  spent: Number(r.total),
                  budget: r.budget_limit != null ? Number(r.budget_limit) : null,
                })),
              });
            });
          });
        };

        // Only run "previous period" comparison queries when an explicit range was given.
        if (hasRange) {
          db.query(prevRevenueSql, [prevFrom, prevTo], (e4, prevRevRows) => {
            if (e4) return res.status(500).json({ success: false, message: e4.message });

            db.query(prevExpenseSql, [prevFrom, prevTo], (e5, prevExpRows) => {
              if (e5) return res.status(500).json({ success: false, message: e5.message });
              afterPrevPeriod(prevRevRows, prevExpRows);
            });
          });
        } else {
          // lifetime mode: no meaningful "previous period" — pass zeroed rows
          afterPrevPeriod([{ total: 0 }], [{ total: 0 }]);
        }
      });
    });
  });
});

module.exports = router;