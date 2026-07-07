const express = require("express");
const router = express.Router();
const db = require("../db");

function iso(d) {
  return d.toISOString().slice(0, 10);
}

/* ============================================================
   1) LOG AN EXPENSE ENTRY
============================================================ */
router.post("/expense", async (req, res) => {
  const { expense_master_id, amount, expense_date, notes } = req.body;
  if (!expense_master_id || !amount || !expense_date) {
    return res.status(400).json({
      success: false,
      message: "expense_master_id, amount, expense_date required che",
    });
  }
  try {
    const [result] = await db
      .promise()
      .query(
        `INSERT INTO general_expense_entry (expense_master_id, amount, expense_date, notes) VALUES (?, ?, ?, ?)`,
        [expense_master_id, amount, expense_date, notes || null]
      );
    res.status(201).json({
      success: true,
      message: "Expense logged",
      id: result.insertId,
      data: { id: result.insertId },
    });
  } catch (err) {
    console.error("Insert Error:", err);
    res.status(500).json({ success: false, message: "Insert failed", error: err.message });
  }
});

/* ============================================================
   2) UPDATE AN EXPENSE ENTRY
============================================================ */
router.put("/expense/:id", async (req, res) => {
  const { id } = req.params;
  const { expense_master_id, amount, expense_date, notes } = req.body;
  if (!expense_master_id || !amount || !expense_date) {
    return res.status(400).json({
      success: false,
      message: "expense_master_id, amount, expense_date required che",
    });
  }
  try {
    const [result] = await db
      .promise()
      .query(
        `UPDATE general_expense_entry SET expense_master_id = ?, amount = ?, expense_date = ?, notes = ? WHERE id = ?`,
        [expense_master_id, amount, expense_date, notes || null, id]
      );
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Expense entry not found" });
    }
    res.json({ success: true, message: "Expense entry updated" });
  } catch (err) {
    console.error("Update Error:", err);
    res.status(500).json({ success: false, message: "Update failed", error: err.message });
  }
});

/* ============================================================
   3) DELETE AN EXPENSE ENTRY
============================================================ */
router.delete("/expense/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await db
      .promise()
      .query(`DELETE FROM general_expense_entry WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Expense entry not found" });
    }
    res.json({ success: true, message: "Expense entry deleted" });
  } catch (err) {
    console.error("Delete Error:", err);
    res.status(500).json({ success: false, message: "Delete failed", error: err.message });
  }
});

/* ============================================================
   4) NET PROFIT — main Entry tab data
   GET /api/net-profit?from=...&to=...   (no params = lifetime)
============================================================ */
router.get("/", async (req, res) => {
  const { from, to } = req.query;
  const hasRange = Boolean(from && to);
  const rangeParams = hasRange ? [from, to] : [];

  try {
    const [projectRows] = await db.promise().query(
      hasRange
        ? `SELECT id, company_name, customer_name, quotation_no, quotation_date, net_revenue_amount, expense_net_amount
           FROM project WHERE quotation_date BETWEEN ? AND ? ORDER BY quotation_date DESC`
        : `SELECT id, company_name, customer_name, quotation_no, quotation_date, net_revenue_amount, expense_net_amount
           FROM project ORDER BY quotation_date DESC`,
      rangeParams
    );

    const [expenseRows] = await db.promise().query(
      hasRange
        ? `SELECT e.id, e.amount, e.expense_date, e.notes, m.name AS expense_name, m.id AS expense_master_id
           FROM general_expense_entry e JOIN general_expense_master m ON m.id = e.expense_master_id
           WHERE e.expense_date BETWEEN ? AND ? ORDER BY e.expense_date DESC`
        : `SELECT e.id, e.amount, e.expense_date, e.notes, m.name AS expense_name, m.id AS expense_master_id
           FROM general_expense_entry e JOIN general_expense_master m ON m.id = e.expense_master_id
           ORDER BY e.expense_date DESC`,
      rangeParams
    );

    const netRevenue = projectRows.reduce((s, p) => s + Number(p.net_revenue_amount || 0), 0);
    const totalExpense = expenseRows.reduce((s, e) => s + Number(e.amount || 0), 0);
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
  } catch (err) {
    console.error("Net Profit Fetch Error:", err);
    res.status(500).json({ success: false, message: "Fetch failed", error: err.message });
  }
});

/* ============================================================
   5) ANALYTICS — for the Analytics tab
   GET /api/net-profit/analytics?from=...&to=...&period=weekly|monthly|quarterly|yearly

   FIX (2026-07-06):
   ------------------------------------------------------------
   Budget Tracking pehla page na date-range filter (from/to) thi
   bound hatu — matlab "This month" select karo to budget sirf e
   mahina ni expenses count karto, "Lifetime" select karo to
   badhu (duration bahar nu pan) count thay jatu. AA KHOTU HATU.

   Budget check FAKT expense type na potana start_date/end_date
   range mujab j thavu joiye (jem general-expense-master.js ma
   mool design hatu), page ni date-range filter thi independent.

   Etle "budgetTracking" mate ALAG query banavi, je:
   - is_recurring = 1 hoy to CURRENT MONTH (auto-renew) mujab spent ganse
   - is_recurring = 0 ane start_date/end_date set hoy to e j range mujab ganse
   - start_date/end_date NULL hoy to lifetime spent ganse

   NOTE: expByTypeRows (page filter mujab expense breakdown/top
   categories mate) EM J RAKHYU CHE — e sahi che kem ke user "aa
   selected period ma kai expense sauthi vadhare thayu" e jovaa
   mange che. Fakt budgetTracking alag kadhi.
============================================================ */
router.get("/analytics", async (req, res) => {
  const { from, to } = req.query;
  let { period } = req.query;
  period = ["weekly", "monthly", "quarterly", "yearly"].includes(period) ? period : "monthly";

  const hasRange = Boolean(from && to);
  const rangeParams = hasRange ? [from, to] : [];
  const chartAnchor = hasRange ? to : iso(new Date());

  let rangeDays = 0,
    prevFrom = null,
    prevTo = null;
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

  try {
    const [revRows] = await db.promise().query(
      hasRange
        ? `SELECT IFNULL(SUM(net_revenue_amount),0) AS total FROM project WHERE quotation_date BETWEEN ? AND ?`
        : `SELECT IFNULL(SUM(net_revenue_amount),0) AS total FROM project`,
      rangeParams
    );

    // ---- expense breakdown / top categories: STILL bound to page's date filter (unchanged) ----
    const [expByTypeRows] = await db.promise().query(
      hasRange
        ? `SELECT m.id, m.name, m.budget_limit, IFNULL(SUM(e.amount),0) AS total
           FROM general_expense_master m
           LEFT JOIN general_expense_entry e ON e.expense_master_id = m.id AND e.expense_date BETWEEN ? AND ?
           WHERE m.status = '1' GROUP BY m.id, m.name, m.budget_limit ORDER BY total DESC`
        : `SELECT m.id, m.name, m.budget_limit, IFNULL(SUM(e.amount),0) AS total
           FROM general_expense_master m
           LEFT JOIN general_expense_entry e ON e.expense_master_id = m.id
           WHERE m.status = '1' GROUP BY m.id, m.name, m.budget_limit ORDER BY total DESC`,
      rangeParams
    );

    // ---- NEW: budget tracking, independent of page's date filter ----
    // Recurring types = current month window. Non-recurring with duration = that duration.
    // No duration set = lifetime spent.
    const [budgetRows] = await db.promise().query(
      `SELECT
          m.id, m.name, m.budget_limit, m.start_date, m.end_date, m.is_recurring,
          IFNULL(SUM(
            CASE
              WHEN m.is_recurring = 1 THEN
                CASE
                  WHEN e.expense_date BETWEEN DATE_FORMAT(CURDATE(), '%Y-%m-01') AND LAST_DAY(CURDATE())
                  THEN e.amount ELSE 0
                END
              WHEN m.start_date IS NULL OR m.end_date IS NULL THEN e.amount
              WHEN e.expense_date BETWEEN m.start_date AND m.end_date THEN e.amount
              ELSE 0
            END
          ), 0) AS spent
       FROM general_expense_master m
       LEFT JOIN general_expense_entry e ON e.expense_master_id = m.id
       WHERE m.status = '1'
       GROUP BY m.id, m.name, m.budget_limit, m.start_date, m.end_date, m.is_recurring
       ORDER BY m.name ASC`
    );

    const [projRows] = await db.promise().query(
      hasRange
        ? `SELECT company_name, quotation_no, net_revenue_amount, expense_net_amount
           FROM project WHERE quotation_date BETWEEN ? AND ? ORDER BY net_revenue_amount DESC LIMIT 5`
        : `SELECT company_name, quotation_no, net_revenue_amount, expense_net_amount
           FROM project ORDER BY net_revenue_amount DESC LIMIT 5`,
      rangeParams
    );

    let prevRevenue = 0,
      prevExpense = 0;
    if (hasRange) {
      const [prevRevRows] = await db
        .promise()
        .query(
          `SELECT IFNULL(SUM(net_revenue_amount),0) AS total FROM project WHERE quotation_date BETWEEN ? AND ?`,
          [prevFrom, prevTo]
        );
      const [prevExpRows] = await db
        .promise()
        .query(
          `SELECT IFNULL(SUM(amount),0) AS total FROM general_expense_entry WHERE expense_date BETWEEN ? AND ?`,
          [prevFrom, prevTo]
        );
      prevRevenue = Number(prevRevRows[0].total || 0);
      prevExpense = Number(prevExpRows[0].total || 0);
    }

    // ---------- trend chart bucket queries ----------
    let chartProjectSql, chartExpSql;
    const chartParams = [chartAnchor];

    if (period === "weekly") {
      chartProjectSql = `SELECT YEARWEEK(quotation_date,1) AS bucket, IFNULL(SUM(amount),0) AS amount,
        IFNULL(SUM(architecture_net_amount),0) AS architecture_net, IFNULL(SUM(expense_net_amount),0) AS expense_net
        FROM project WHERE quotation_date >= DATE_SUB(?, INTERVAL 8 WEEK) GROUP BY bucket`;
      chartExpSql = `SELECT YEARWEEK(expense_date,1) AS bucket, IFNULL(SUM(amount),0) AS expense
        FROM general_expense_entry WHERE expense_date >= DATE_SUB(?, INTERVAL 8 WEEK) GROUP BY bucket`;
    } else if (period === "quarterly") {
      chartProjectSql = `SELECT CONCAT(YEAR(quotation_date),'-Q',QUARTER(quotation_date)) AS bucket,
        IFNULL(SUM(amount),0) AS amount, IFNULL(SUM(architecture_net_amount),0) AS architecture_net,
        IFNULL(SUM(expense_net_amount),0) AS expense_net
        FROM project WHERE quotation_date >= DATE_SUB(?, INTERVAL 18 MONTH) GROUP BY bucket`;
      chartExpSql = `SELECT CONCAT(YEAR(expense_date),'-Q',QUARTER(expense_date)) AS bucket, IFNULL(SUM(amount),0) AS expense
        FROM general_expense_entry WHERE expense_date >= DATE_SUB(?, INTERVAL 18 MONTH) GROUP BY bucket`;
    } else if (period === "yearly") {
      chartProjectSql = `SELECT YEAR(quotation_date) AS bucket, IFNULL(SUM(amount),0) AS amount,
        IFNULL(SUM(architecture_net_amount),0) AS architecture_net, IFNULL(SUM(expense_net_amount),0) AS expense_net
        FROM project WHERE quotation_date >= DATE_SUB(?, INTERVAL 5 YEAR) GROUP BY bucket`;
      chartExpSql = `SELECT YEAR(expense_date) AS bucket, IFNULL(SUM(amount),0) AS expense
        FROM general_expense_entry WHERE expense_date >= DATE_SUB(?, INTERVAL 5 YEAR) GROUP BY bucket`;
    } else {
      chartProjectSql = `SELECT DATE_FORMAT(quotation_date,'%Y-%m') AS bucket, IFNULL(SUM(amount),0) AS amount,
        IFNULL(SUM(architecture_net_amount),0) AS architecture_net, IFNULL(SUM(expense_net_amount),0) AS expense_net
        FROM project WHERE quotation_date >= DATE_SUB(LAST_DAY(?), INTERVAL 5 MONTH) + INTERVAL 1 DAY GROUP BY bucket`;
      chartExpSql = `SELECT DATE_FORMAT(expense_date,'%Y-%m') AS bucket, IFNULL(SUM(amount),0) AS expense
        FROM general_expense_entry WHERE expense_date >= DATE_SUB(LAST_DAY(?), INTERVAL 5 MONTH) + INTERVAL 1 DAY GROUP BY bucket`;
    }

    const [chartProjectRows] = await db.promise().query(chartProjectSql, chartParams);
    const [chartExpRows] = await db.promise().query(chartExpSql, chartParams);

    let chartData = [];
    const base = new Date(chartAnchor);

    if (period === "weekly") {
      for (let i = 7; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(d.getDate() - i * 7);
        const tmp = new Date(d);
        const dayNum = (tmp.getDay() + 6) % 7;
        tmp.setDate(tmp.getDate() - dayNum + 3);
        const firstThursday = new Date(tmp.getFullYear(), 0, 4);
        const weekNo =
          1 +
          Math.round(
            ((tmp - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7
          );
        const bucketKey = Number(`${tmp.getFullYear()}${String(weekNo).padStart(2, "0")}`);
        const projRow = chartProjectRows.find((r) => Number(r.bucket) === bucketKey);
        const expRow = chartExpRows.find((r) => Number(r.bucket) === bucketKey);
        chartData.push({
          month: `W${weekNo}`,
          amount: Number(projRow?.amount || 0),
          architecture_net: Number(projRow?.architecture_net || 0),
          expense_net: Number(projRow?.expense_net || 0),
          expense: Number(expRow?.expense || 0),
        });
      }
    } else if (period === "quarterly") {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(base.getFullYear(), base.getMonth() - i * 3, 1);
        const q = Math.floor(d.getMonth() / 3) + 1;
        const bucketKey = `${d.getFullYear()}-Q${q}`;
        const projRow = chartProjectRows.find((r) => r.bucket === bucketKey);
        const expRow = chartExpRows.find((r) => r.bucket === bucketKey);
        chartData.push({
          month: `Q${q} '${String(d.getFullYear()).slice(2)}`,
          amount: Number(projRow?.amount || 0),
          architecture_net: Number(projRow?.architecture_net || 0),
          expense_net: Number(projRow?.expense_net || 0),
          expense: Number(expRow?.expense || 0),
        });
      }
    } else if (period === "yearly") {
      for (let i = 4; i >= 0; i--) {
        const y = base.getFullYear() - i;
        const projRow = chartProjectRows.find((r) => Number(r.bucket) === y);
        const expRow = chartExpRows.find((r) => Number(r.bucket) === y);
        chartData.push({
          month: String(y),
          amount: Number(projRow?.amount || 0),
          architecture_net: Number(projRow?.architecture_net || 0),
          expense_net: Number(projRow?.expense_net || 0),
          expense: Number(expRow?.expense || 0),
        });
      }
    } else {
      for (let i = 5; i >= 0; i--) {
        const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const label = d.toLocaleString("en-US", { month: "short" });
        const projRow = chartProjectRows.find((r) => r.bucket === ym);
        const expRow = chartExpRows.find((r) => r.bucket === ym);
        chartData.push({
          month: label,
          amount: Number(projRow?.amount || 0),
          architecture_net: Number(projRow?.architecture_net || 0),
          expense_net: Number(projRow?.expense_net || 0),
          expense: Number(expRow?.expense || 0),
        });
      }
    }

    // ---------- daily expense trend ----------
    const trendFrom = hasRange
      ? from
      : iso(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
    const trendTo = hasRange ? to : iso(new Date());
    const [dailyRows] = await db.promise().query(
      `SELECT expense_date, IFNULL(SUM(amount),0) AS total FROM general_expense_entry
       WHERE expense_date BETWEEN ? AND ? GROUP BY expense_date ORDER BY expense_date ASC`,
      [trendFrom, trendTo]
    );
    const dailyTrend = dailyRows.map((r) => ({
      date: r.expense_date,
      amount: Number(r.total || 0),
    }));

    // ---------- important KPIs ----------
    const [highestExpenseDayRows] = await db.promise().query(
      hasRange
        ? `SELECT expense_date, SUM(amount) AS total FROM general_expense_entry WHERE expense_date BETWEEN ? AND ? GROUP BY expense_date ORDER BY total DESC LIMIT 1`
        : `SELECT expense_date, SUM(amount) AS total FROM general_expense_entry GROUP BY expense_date ORDER BY total DESC LIMIT 1`,
      rangeParams
    );
    const [highestRevenueDayRows] = await db.promise().query(
      hasRange
        ? `SELECT quotation_date, SUM(net_revenue_amount) AS total FROM project WHERE quotation_date BETWEEN ? AND ? GROUP BY quotation_date ORDER BY total DESC LIMIT 1`
        : `SELECT quotation_date, SUM(net_revenue_amount) AS total FROM project GROUP BY quotation_date ORDER BY total DESC LIMIT 1`,
      rangeParams
    );
    const [largestExpenseRows] = await db.promise().query(
      hasRange
        ? `SELECT e.amount, m.name FROM general_expense_entry e JOIN general_expense_master m ON m.id = e.expense_master_id
           WHERE e.expense_date BETWEEN ? AND ? ORDER BY e.amount DESC LIMIT 1`
        : `SELECT e.amount, m.name FROM general_expense_entry e JOIN general_expense_master m ON m.id = e.expense_master_id
           ORDER BY e.amount DESC LIMIT 1`,
      rangeParams
    );

    // ---------- derived numbers ----------
    const netRevenue = Number(revRows[0].total || 0);
    const totalExpense = expByTypeRows.reduce((s, r) => s + Number(r.total || 0), 0);
    const netProfit = netRevenue - totalExpense;
    const profitMargin = netRevenue > 0 ? Math.round((netProfit / netRevenue) * 100) : 0;
    const revenueChangePct =
      prevRevenue > 0 ? Math.round(((netRevenue - prevRevenue) / prevRevenue) * 100) : 0;
    const expenseChangePct =
      prevExpense > 0 ? Math.round(((totalExpense - prevExpense) / prevExpense) * 100) : 0;
    const avgDailyExpense =
      rangeDays > 0
        ? Math.round(totalExpense / rangeDays)
        : dailyTrend.length
        ? Math.round(totalExpense / dailyTrend.length)
        : 0;

    const expenseBreakdown = expByTypeRows
      .filter((r) => Number(r.total) > 0)
      .map((r) => ({ name: r.name, amount: Number(r.total) }));

    const topExpenseCategories = [...expenseBreakdown]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((c) => ({
        ...c,
        pct: totalExpense > 0 ? Math.round((c.amount / totalExpense) * 100) : 0,
      }));

    const projectProfitability = projRows.map((p) => {
      const revenue = Number(p.net_revenue_amount || 0);
      const expense = Number(p.expense_net_amount || 0);
      const profit = revenue - expense;
      return {
        name: p.company_name,
        quotation_no: p.quotation_no,
        revenue,
        expense,
        profit,
        margin: revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0,
      };
    });

    // ---------- budget tracking (from the NEW independent query) ----------
    const budgetTracking = budgetRows.map((r) => {
      const spent = Number(r.spent);
      const budget = r.budget_limit != null ? Number(r.budget_limit) : null;
      const remaining = budget != null ? budget - spent : null;
      const status = budget == null ? null : spent > budget ? "Over Budget" : "On Track";
      return {
        name: r.name,
        spent,
        budget,
        remaining,
        status,
        is_recurring: Boolean(r.is_recurring),
        start_date: r.start_date,
        end_date: r.end_date,
      };
    });

    // ---------- quick insights (rule based) ----------
    const quickInsights = [];
    if (netRevenue > 0) {
      const expPctOfRevenue = Math.round((totalExpense / netRevenue) * 100);
      quickInsights.push(`Expenses are ${expPctOfRevenue}% of revenue.`);
    }
    if (topExpenseCategories.length) {
      quickInsights.push(
        `${topExpenseCategories[0].name} contributes ${topExpenseCategories[0].pct}% of all expenses.`
      );
    }
    if (highestExpenseDayRows.length) {
      const d = new Date(highestExpenseDayRows[0].expense_date);
      quickInsights.push(
        `${d.toLocaleString("en-US", { month: "long" })} ${d.getDate()} had the highest expense.`
      );
    }
    quickInsights.push(
      revenueChangePct >= 0
        ? `Revenue grew ${revenueChangePct}% compared to last period.`
        : `Revenue dropped by ${Math.abs(revenueChangePct)}% compared to last period.`
    );
    if (netProfit < 0) {
      quickInsights.push(
        `You need ₹${Math.abs(netProfit).toLocaleString("en-IN")} more revenue to break even.`
      );
    }

    // ---------- AI-style recommendations (rule based) ----------
    const aiRecommendations = [];
    if (topExpenseCategories.length && topExpenseCategories[0].pct >= 50) {
      aiRecommendations.push(
        `${topExpenseCategories[0].name} expenses are very high. Consider reducing by 15%.`
      );
    }
    if (netProfit < 0) {
      aiRecommendations.push(
        `Increase revenue by ₹${Math.abs(netProfit).toLocaleString("en-IN")} to reach break-even.`
      );
    }
    const onTrackNames = budgetTracking.filter((b) => b.status === "On Track").map((b) => b.name);
    if (onTrackNames.length) {
      aiRecommendations.push(`${onTrackNames.join(" and ")} are within budget.`);
    }
    const overBudgetItems = budgetTracking.filter((b) => b.status === "Over Budget");
    if (overBudgetItems.length) {
      aiRecommendations.push(
        `${overBudgetItems.map((b) => b.name).join(", ")} ${
          overBudgetItems.length > 1 ? "have" : "has"
        } exceeded budget.`
      );
    }
    if (expenseChangePct > 0) {
      aiRecommendations.push(
        `General expenses increased by ${expenseChangePct}% compared to last period.`
      );
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
      expenseBreakdown,
      topExpenseCategories,
      topProjects: projRows.map((p) => ({
        name: p.company_name,
        quotation_no: p.quotation_no,
        amount: Number(p.net_revenue_amount),
      })),
      projectProfitability,
      budgetTracking,
      dailyTrend,
      importantKPIs: {
        highestExpenseDay: highestExpenseDayRows[0]
          ? { date: highestExpenseDayRows[0].expense_date, amount: Number(highestExpenseDayRows[0].total) }
          : null,
        highestRevenueDay: highestRevenueDayRows[0]
          ? { date: highestRevenueDayRows[0].quotation_date, amount: Number(highestRevenueDayRows[0].total) }
          : null,
        largestExpense: largestExpenseRows[0]
          ? { name: largestExpenseRows[0].name, amount: Number(largestExpenseRows[0].amount) }
          : null,
        largestProject: projectProfitability[0]
          ? { name: projectProfitability[0].name, amount: projectProfitability[0].revenue }
          : null,
      },
      quickInsights,
      aiRecommendations,
    });
  } catch (err) {
    console.error("Analytics Error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;