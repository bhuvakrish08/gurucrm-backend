/**
 * Centralized Strategy Calculation Service
 * 
 * Source of truth for all Indian Financial Year (April 1 to March 31) date helpers,
 * source mapping resolution, authoritative won date resolution, and the category-wise
 * sequential Net Rolling Balance calculation engine.
 */

const db = require("../db");

/* ==========================================================================
 * 1. DECIMAL AND ROUNDING HELPER FUNCTIONS
 * ========================================================================== */

/**
 * Safely converts any DB decimal string, float, or null to a standard JS number.
 */
function toMoneyNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Rounds a number to exactly 2 decimal places to prevent floating point accumulation errors.
 */
function roundMoney(value) {
  const num = toMoneyNumber(value);
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/* ==========================================================================
 * 2. FINANCIAL YEAR & QUARTER DATE HELPERS
 * ========================================================================== */

/**
 * Centralized Indian Financial Year (April 1 to March 31) date helper.
 * Returns exact Financial Year format used by the Phase 2 database: "YYYY-YYYY" (e.g. "2026-2027").
 */
function getFinancialYearFromDate(dateInput) {
  if (!dateInput) throw new Error("Date input is required for getFinancialYearFromDate");
  
  let dateObj;
  if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else if (typeof dateInput === "string") {
    // If YYYY-MM-DD string, parse safely without UTC shifting
    const parts = dateInput.split("-");
    if (parts.length === 3 && parts[0].length === 4) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      // April (4) to December (12) belongs to year-(year+1)
      if (month >= 4) {
        return `${year}-${year + 1}`;
      } else {
        return `${year - 1}-${year}`;
      }
    }
    dateObj = new Date(dateInput);
  } else {
    dateObj = new Date(dateInput);
  }

  if (isNaN(dateObj.getTime())) {
    throw new Error(`Invalid date provided to getFinancialYearFromDate: ${dateInput}`);
  }

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1; // 1-indexed (Jan=1, Apr=4)

  if (month >= 4) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

/**
 * Indian Financial Year Quarter Mapping helper.
 * Calendar Month Numbers:
 * 4 (Apr), 5 (May), 6 (Jun) -> Q1
 * 7 (Jul), 8 (Aug), 9 (Sep) -> Q2
 * 10 (Oct), 11 (Nov), 12 (Dec) -> Q3
 * 1 (Jan), 2 (Feb), 3 (Mar) -> Q4
 */
function getQuarterFromMonth(calendarMonthNumber) {
  const month = Number(calendarMonthNumber);
  if (isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid calendar month number: ${calendarMonthNumber}`);
  }

  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4; // 1, 2, 3
}

/**
 * Converts calendar month number (1-12) to Indian Financial Year month order (1-12).
 * Apr(4)=1, May(5)=2, Jun(6)=3, Jul(7)=4, Aug(8)=5, Sep(9)=6,
 * Oct(10)=7, Nov(11)=8, Dec(12)=9, Jan(1)=10, Feb(2)=11, Mar(3)=12.
 */
function getFinancialYearMonthOrder(calendarMonthNumber) {
  const month = Number(calendarMonthNumber);
  if (isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid calendar month number: ${calendarMonthNumber}`);
  }
  return month >= 4 ? month - 3 : month + 9;
}

/**
 * Converts Indian Financial Year order (1-12) back to calendar month number (1-12).
 */
function getCalendarMonthFromFinancialYearOrder(fyOrder) {
  const order = Number(fyOrder);
  if (isNaN(order) || order < 1 || order > 12) {
    throw new Error(`Invalid financial year order: ${fyOrder}`);
  }
  return order <= 9 ? order + 3 : order - 9;
}

/**
 * Centralized month metadata structure.
 */
const ALL_MONTHS_METADATA = [
  { monthNumber: 4, monthName: "April", shortName: "Apr", quarterNumber: 1, financialYearOrder: 1 },
  { monthNumber: 5, monthName: "May", shortName: "May", quarterNumber: 1, financialYearOrder: 2 },
  { monthNumber: 6, monthName: "June", shortName: "Jun", quarterNumber: 1, financialYearOrder: 3 },
  { monthNumber: 7, monthName: "July", shortName: "Jul", quarterNumber: 2, financialYearOrder: 4 },
  { monthNumber: 8, monthName: "August", shortName: "Aug", quarterNumber: 2, financialYearOrder: 5 },
  { monthNumber: 9, monthName: "September", shortName: "Sep", quarterNumber: 2, financialYearOrder: 6 },
  { monthNumber: 10, monthName: "October", shortName: "Oct", quarterNumber: 3, financialYearOrder: 7 },
  { monthNumber: 11, monthName: "November", shortName: "Nov", quarterNumber: 3, financialYearOrder: 8 },
  { monthNumber: 12, monthName: "December", shortName: "Dec", quarterNumber: 3, financialYearOrder: 9 },
  { monthNumber: 1, monthName: "January", shortName: "Jan", quarterNumber: 4, financialYearOrder: 10 },
  { monthNumber: 2, monthName: "February", shortName: "Feb", quarterNumber: 4, financialYearOrder: 11 },
  { monthNumber: 3, monthName: "March", shortName: "Mar", quarterNumber: 4, financialYearOrder: 12 }
];

function getMonthMetadata(calendarMonthNumber) {
  const meta = ALL_MONTHS_METADATA.find(m => m.monthNumber === Number(calendarMonthNumber));
  if (!meta) throw new Error(`Invalid calendar month number: ${calendarMonthNumber}`);
  return { ...meta };
}

function getAllMonthsMetadata() {
  return ALL_MONTHS_METADATA.map(m => ({ ...m }));
}

/* ==========================================================================
 * 3. AUTHORITATIVE WON DATE RESOLVER
 * ========================================================================== */

/**
 * Determines the authoritative Won Date for a quotation.
 * Priority:
 * 1. Existing persisted strategy_quotation_contributions.won_date (Stability Rule).
 * 2. Reliable explicit lead.won_at if quotation linked to lead.
 * 3. Exact project creation timestamp if quotation was converted to project.
 * 4. Quotation Date (q.quotation_date) or q.created_at as historical fallback.
 * Note: Never uses q.updated_at as normal fallback.
 */
async function getAuthoritativeWonDate(quotationId, databasePool = db, options = {}) {
  let promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  if (databasePool && !databasePool.promise && !databasePool.query) {
    options = databasePool;
    promiseDb = (options.connection || options.databasePool || db).promise ? (options.connection || options.databasePool || db).promise() : (options.connection || options.databasePool || db);
  }
  if (!quotationId) throw new Error("quotationId is required for getAuthoritativeWonDate");

  // Priority 1: Check existing contribution stability (unless forceDateReconciliation is requested)
  if (!options.forceDateReconciliation) {
    const [contribRows] = await promiseDb.query(
      `SELECT won_date FROM strategy_quotation_contributions WHERE quotation_id = ? AND is_active = 1`,
      [quotationId]
    );
    if (contribRows.length > 0 && contribRows[0].won_date) {
      const dStr = typeof contribRows[0].won_date === "string" 
        ? contribRows[0].won_date.split("T")[0] 
        : contribRows[0].won_date.toISOString().split("T")[0];
      return {
        wonDate: dStr,
        sourceType: "PERSISTED_CONTRIBUTION",
        priority: 1
      };
    }
  }

  // Fetch quotation and joined lead/project data
  const [qRows] = await promiseDb.query(
    `SELECT q.id, q.lead_id, q.quotation_date, q.created_at, l.won_at
     FROM quotation q
     LEFT JOIN lead l ON l.lead_id = q.lead_id
     WHERE q.id = ?`,
    [quotationId]
  );
  if (qRows.length === 0) {
    throw new Error(`Quotation not found with id: ${quotationId}`);
  }
  const quotation = qRows[0];

  // Priority 2: Explicit quotation.quotation_date (proposal/quotation date takes precedence for strategy period assignment)
  if (quotation.quotation_date && quotation.quotation_date !== "0000-00-00" && quotation.quotation_date !== "") {
    const dStr = typeof quotation.quotation_date === "string"
      ? quotation.quotation_date.split(" ")[0].split("T")[0]
      : quotation.quotation_date.toISOString().split("T")[0];
    return {
      wonDate: dStr,
      sourceType: "QUOTATION_DATE",
      priority: 2
    };
  }

  // Priority 3: Explicit lead.won_at
  if (quotation.won_at && quotation.won_at !== "0000-00-00 00:00:00") {
    const dStr = typeof quotation.won_at === "string"
      ? quotation.won_at.split(" ")[0].split("T")[0]
      : quotation.won_at.toISOString().split("T")[0];
    return {
      wonDate: dStr,
      sourceType: "LEAD_WON_AT",
      priority: 3
    };
  }

  // Priority 4: Project creation timestamp from 'project' table
  const [projRows] = await promiseDb.query(
    `SELECT created_at FROM project WHERE quotation_id = ? ORDER BY id ASC LIMIT 1`,
    [quotationId]
  );
  if (projRows.length > 0 && projRows[0].created_at && projRows[0].created_at !== "0000-00-00 00:00:00") {
    const dStr = typeof projRows[0].created_at === "string"
      ? projRows[0].created_at.split(" ")[0].split("T")[0]
      : projRows[0].created_at.toISOString().split("T")[0];
    return {
      wonDate: dStr,
      sourceType: "PROJECT_CREATED_AT",
      priority: 4
    };
  }

  // Priority 5: Historical Fallback using created_at
  let fallbackDate = quotation.created_at;
  if (!fallbackDate || fallbackDate === "0000-00-00 00:00:00") {
    fallbackDate = new Date().toISOString().split("T")[0];
  } else if (typeof fallbackDate !== "string") {
    fallbackDate = fallbackDate.toISOString().split("T")[0];
  } else {
    fallbackDate = fallbackDate.split(" ")[0].split("T")[0];
  }

  return {
    wonDate: fallbackDate,
    sourceType: "HISTORICAL_FALLBACK_CREATED_AT",
    priority: 5
  };
}

/* ==========================================================================
 * 4. SOURCE MAPPING RESOLVER
 * ========================================================================== */

/**
 * Resolves the Main Strategy Category for any given sub-source name or ID.
 */
async function getMappedCategoryBySource(sourceNameOrId, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  if (!sourceNameOrId || sourceNameOrId === "") {
    return {
      mapped: false,
      sourceId: null,
      sourceName: String(sourceNameOrId || ""),
      reason: "SOURCE_NOT_FOUND"
    };
  }

  let sourceRow = null;
  const asNumber = Number(sourceNameOrId);
  if (!isNaN(asNumber) && asNumber > 0) {
    const [rows] = await promiseDb.query(
      `SELECT id, name FROM inquiry_lead_source WHERE id = ? AND (status = 1 OR status = 'Active' OR status = 'active' OR status IS NULL)`,
      [asNumber]
    );
    if (rows.length > 0) sourceRow = rows[0];
  }

  if (!sourceRow) {
    const trimmedName = String(sourceNameOrId).trim();
    const [rows] = await promiseDb.query(
      `SELECT id, name FROM inquiry_lead_source WHERE name = ? AND (status = 1 OR status = 'Active' OR status = 'active' OR status IS NULL)`,
      [trimmedName]
    );
    if (rows.length > 0) sourceRow = rows[0];
  }

  if (!sourceRow) {
    return {
      mapped: false,
      sourceId: null,
      sourceName: String(sourceNameOrId),
      reason: "SOURCE_NOT_FOUND"
    };
  }

  const [mapRows] = await promiseDb.query(
    `SELECT m.strategy_category_id, c.code AS strategyCategoryCode, c.name AS strategyCategoryName
     FROM strategy_source_mappings m
     JOIN strategy_source_categories c ON c.id = m.strategy_category_id AND c.is_active = 1
     WHERE m.source_id = ? AND m.is_active = 1`,
    [sourceRow.id]
  );

  if (mapRows.length === 0) {
    return {
      mapped: false,
      sourceId: sourceRow.id,
      sourceName: sourceRow.name,
      reason: "SOURCE_NOT_MAPPED"
    };
  }

  return {
    mapped: true,
    sourceId: sourceRow.id,
    sourceName: sourceRow.name,
    strategyCategoryId: mapRows[0].strategy_category_id,
    strategyCategoryCode: mapRows[0].strategyCategoryCode,
    strategyCategoryName: mapRows[0].strategyCategoryName
  };
}

/* ==========================================================================
 * 5. ACHIEVEMENT CONTRIBUTION READ LOGIC
 * ========================================================================== */

/**
 * Reads total contribution achievement amount and count from strategy_quotation_contributions ledger.
 */
async function getCategoryAchievement(financialYear, monthNumber, strategyCategoryId, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const [rows] = await promiseDb.query(
    `SELECT COALESCE(SUM(c.contribution_amount), 0) AS achievement, COUNT(c.id) AS contributionCount
     FROM strategy_quotation_contributions c
     INNER JOIN quotation q ON q.id = c.quotation_id AND q.quotation_status IN ('Approved', 'Won')
     WHERE c.financial_year = ? AND c.month_number = ? AND c.strategy_category_id = ? AND c.is_active = 1`,
    [financialYear, Number(monthNumber), Number(strategyCategoryId)]
  );

  const achievement = roundMoney(rows[0]?.achievement || 0);
  const contributionCount = Number(rows[0]?.contributionCount || 0);

  return { achievement, contributionCount };
}

/* ==========================================================================
 * 6. QUARTER ADJUSTMENT READ LOGIC
 * ========================================================================== */

/**
 * Reads valid/applicable adjustments (QUARTER_SHORTFALL_ADDITION and QUARTER_EXCESS_REDUCTION)
 * for a specific financial year, month number, and strategy category.
 */
async function getCategoryQuarterAdjustments(financialYear, monthNumber, strategyCategoryId, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const [rows] = await promiseDb.query(
    `SELECT adjustment_type, COALESCE(SUM(amount), 0) AS total_amount
     FROM strategy_adjustments
     WHERE financial_year = ? AND destination_month = ? AND strategy_category_id = ? AND is_active = 1
     GROUP BY adjustment_type`,
    [financialYear, Number(monthNumber), Number(strategyCategoryId)]
  );

  let quarterShortfallAddition = 0;
  let quarterExcessReduction = 0;

  for (const r of rows) {
    if (r.adjustment_type === "QUARTER_SHORTFALL_ADDITION") {
      quarterShortfallAddition = roundMoney(r.total_amount);
    } else if (r.adjustment_type === "QUARTER_EXCESS_REDUCTION") {
      quarterExcessReduction = roundMoney(r.total_amount);
    }
  }

  return { quarterShortfallAddition, quarterExcessReduction };
}

/* ==========================================================================
 * 7. CRITICAL NET ROLLING BALANCE ENGINE
 * ========================================================================== */

/**
 * Calculates the sequential month-by-month Net Rolling Balance for all 3 months inside a specific quarter.
 * Enforces:
 * - Category-wise calculation.
 * - Quarter Boundary Rule (Q1 April, Q2 July, Q3 October, Q4 January start with 0 incoming shortfall/excess credit).
 * - Preservation of Unused Excess Credit when reduction credit exceeds available target.
 * - Idempotency and deterministic order (Month 1 -> Month 2 -> Month 3).
 */
async function calculateCategoryQuarterMonths(financialYear, quarterNumber, strategyCategoryId, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const qNum = Number(quarterNumber);
  const catId = Number(strategyCategoryId);

  // Determine the three calendar months for this quarter
  const quarterMonthsMeta = ALL_MONTHS_METADATA.filter(m => m.quarterNumber === qNum).sort((a, b) => a.financialYearOrder - b.financialYearOrder);

  // Preload category info
  const [catRows] = await promiseDb.query(
    `SELECT id, code, name, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description FROM strategy_source_categories WHERE id = ?`,
    [catId]
  );
  if (catRows.length === 0) {
    throw new Error(`Strategy Category not found with id: ${catId}`);
  }
  const categoryInfo = catRows[0];

  // Preload all monthly goals for this category in this quarter
  const [goalRows] = await promiseDb.query(
    `SELECT month_number, base_goal_amount FROM strategy_monthly_goals
     WHERE financial_year = ? AND quarter_number = ? AND strategy_category_id = ?`,
    [financialYear, qNum, catId]
  );
  const goalsMap = {};
  for (const g of goalRows) {
    goalsMap[Number(g.month_number)] = roundMoney(g.base_goal_amount);
  }

  // Preload all contributions for this category in this quarter
  const [contribRows] = await promiseDb.query(
    `SELECT c.month_number, COALESCE(SUM(c.contribution_amount), 0) AS achievement, COUNT(c.id) AS contributionCount
     FROM strategy_quotation_contributions c
     INNER JOIN quotation q ON q.id = c.quotation_id AND q.quotation_status IN ('Approved', 'Won')
     WHERE c.financial_year = ? AND c.quarter_number = ? AND c.strategy_category_id = ? AND c.is_active = 1
     GROUP BY c.month_number`,
    [financialYear, qNum, catId]
  );
  const contribMap = {};
  for (const c of contribRows) {
    contribMap[Number(c.month_number)] = {
      achievement: roundMoney(c.achievement),
      contributionCount: Number(c.contributionCount)
    };
  }

  // Preload all adjustments for this category in this quarter
  const [adjRows] = await promiseDb.query(
    `SELECT destination_month, adjustment_type, COALESCE(SUM(amount), 0) AS total_amount
     FROM strategy_adjustments
     WHERE financial_year = ? AND destination_quarter = ? AND strategy_category_id = ? AND is_active = 1
     GROUP BY destination_month, adjustment_type`,
    [financialYear, qNum, catId]
  );
  const adjMap = {};
  for (const a of adjRows) {
    const mNum = Number(a.destination_month);
    if (!adjMap[mNum]) adjMap[mNum] = { shortfallAdd: 0, excessRed: 0 };
    if (a.adjustment_type === "QUARTER_SHORTFALL_ADDITION") {
      adjMap[mNum].shortfallAdd = roundMoney(a.total_amount);
    } else if (a.adjustment_type === "QUARTER_EXCESS_REDUCTION") {
      adjMap[mNum].excessRed = roundMoney(a.total_amount);
    }
  }

  const results = [];
  let prevClosingShortfall = 0;
  let prevClosingExcess = 0;

  for (let i = 0; i < quarterMonthsMeta.length; i++) {
    const monthMeta = quarterMonthsMeta[i];
    const monthNumber = monthMeta.monthNumber;

    const baseGoal = roundMoney(goalsMap[monthNumber] || 0);
    const quarterShortfallAddition = roundMoney(adjMap[monthNumber]?.shortfallAdd || 0);
    const quarterExcessReduction = roundMoney(adjMap[monthNumber]?.excessRed || 0);

    // Quarter boundary rule: Month index 0 of quarter receives 0 incoming carry from previous quarter
    const incomingShortfall = i === 0 ? 0 : roundMoney(prevClosingShortfall);
    const incomingExcessCredit = i === 0 ? 0 : roundMoney(prevClosingExcess);

    const positiveTarget = roundMoney(baseGoal + quarterShortfallAddition + incomingShortfall);
    const reductionCredit = roundMoney(quarterExcessReduction + incomingExcessCredit);

    const effectiveGoal = roundMoney(Math.max(0, positiveTarget - reductionCredit));
    const unusedReductionCredit = roundMoney(Math.max(0, reductionCredit - positiveTarget));

    const achievementData = contribMap[monthNumber] || { achievement: 0, contributionCount: 0 };
    const achievement = roundMoney(achievementData.achievement);
    const contributionCount = achievementData.contributionCount;

    const currentNetPosition = roundMoney(achievement - effectiveGoal);

    let closingShortfall = 0;
    let closingExcess = 0;

    if (currentNetPosition < 0) {
      closingShortfall = roundMoney(Math.abs(currentNetPosition));
      closingExcess = roundMoney(unusedReductionCredit);
    } else {
      closingShortfall = 0;
      closingExcess = roundMoney(unusedReductionCredit + currentNetPosition);
    }

    // Calculate achievement percentage
    let achievementPercentage = 0;
    let hasZeroGoalAchievement = false;
    if (effectiveGoal > 0) {
      achievementPercentage = roundMoney((achievement / effectiveGoal) * 100);
    } else if (effectiveGoal === 0 && achievement > 0) {
      achievementPercentage = 100;
      hasZeroGoalAchievement = true;
    } else {
      achievementPercentage = 0;
    }

    const variance = roundMoney(achievement - effectiveGoal);

    const monthResult = {
      strategyCategoryId: categoryInfo.id,
      categoryCode: categoryInfo.code,
      categoryName: categoryInfo.name,
      icon_svg: categoryInfo.icon_svg,
      icon_background: categoryInfo.icon_background,
      icon_color: categoryInfo.icon_color,
      badge_background: categoryInfo.badge_background,
      badge_text_color: categoryInfo.badge_text_color,
      description: categoryInfo.description,
      financialYear,
      quarterNumber: qNum,
      monthNumber,
      monthName: monthMeta.monthName,
      monthShortName: monthMeta.shortName,
      financialYearMonthOrder: monthMeta.financialYearOrder,
      baseGoal,
      incomingShortfall,
      incomingExcessCredit,
      quarterShortfallAddition,
      quarterExcessReduction,
      effectiveGoal,
      achievement,
      contributionCount,
      variance,
      closingShortfall,
      closingExcess,
      achievementPercentage,
      hasZeroGoalAchievement
    };

    results.push(monthResult);
    prevClosingShortfall = closingShortfall;
    prevClosingExcess = closingExcess;
  }

  return results;
}

/* ==========================================================================
 * 8. GET MONTH STRATEGY
 * ========================================================================== */

/**
 * Returns complete Category-wise Month Strategy calculation along with summary totals.
 */
async function getMonthStrategy(financialYear, monthNumber, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const mNum = Number(monthNumber);
  const monthMeta = getMonthMetadata(mNum);
  const quarterNumber = monthMeta.quarterNumber;

  // Load exactly five active Strategy Categories in display order
  const [catRows] = await promiseDb.query(
    `SELECT id FROM strategy_source_categories WHERE is_active = 1 ORDER BY display_order ASC, id ASC`
  );

  const categoryResults = [];
  for (const cat of catRows) {
    const quarterSequence = await calculateCategoryQuarterMonths(financialYear, quarterNumber, cat.id, promiseDb);
    const monthCalc = quarterSequence.find(m => m.monthNumber === mNum);
    if (monthCalc) categoryResults.push(monthCalc);
  }

  // Calculate totals across categories for this month
  const totals = {
    totalBaseGoal: 0,
    totalIncomingShortfall: 0,
    totalIncomingExcessCredit: 0,
    totalQuarterShortfallAddition: 0,
    totalQuarterExcessReduction: 0,
    totalEffectiveGoal: 0,
    totalAchievement: 0,
    totalContributionCount: 0,
    totalClosingShortfall: 0,
    totalClosingExcess: 0
  };

  for (const item of categoryResults) {
    totals.totalBaseGoal = roundMoney(totals.totalBaseGoal + item.baseGoal);
    totals.totalIncomingShortfall = roundMoney(totals.totalIncomingShortfall + item.incomingShortfall);
    totals.totalIncomingExcessCredit = roundMoney(totals.totalIncomingExcessCredit + item.incomingExcessCredit);
    totals.totalQuarterShortfallAddition = roundMoney(totals.totalQuarterShortfallAddition + item.quarterShortfallAddition);
    totals.totalQuarterExcessReduction = roundMoney(totals.totalQuarterExcessReduction + item.quarterExcessReduction);
    totals.totalEffectiveGoal = roundMoney(totals.totalEffectiveGoal + item.effectiveGoal);
    totals.totalAchievement = roundMoney(totals.totalAchievement + item.achievement);
    totals.totalContributionCount += item.contributionCount;
    totals.totalClosingShortfall = roundMoney(totals.totalClosingShortfall + item.closingShortfall);
    totals.totalClosingExcess = roundMoney(totals.totalClosingExcess + item.closingExcess);
  }

  return {
    financialYear,
    monthNumber: mNum,
    monthName: monthMeta.monthName,
    monthShortName: monthMeta.shortName,
    quarterNumber,
    financialYearMonthOrder: monthMeta.financialYearOrder,
    categories: categoryResults,
    totals
  };
}

/* ==========================================================================
 * 9. GET QUARTER SUMMARY
 * ========================================================================== */

/**
 * Returns Quarter Strategy summary across the 3 months of the quarter.
 * Quarter Closing Balance comes ONLY from Month 3's final unresolved category-wise balance.
 */
async function getQuarterSummary(financialYear, quarterNumber, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const qNum = Number(quarterNumber);
  if (isNaN(qNum) || qNum < 1 || qNum > 4) {
    throw new Error(`Invalid quarter number: ${quarterNumber}`);
  }

  const quarterMonthsMeta = ALL_MONTHS_METADATA.filter(m => m.quarterNumber === qNum).sort((a, b) => a.financialYearOrder - b.financialYearOrder);
  const closingMonthMeta = quarterMonthsMeta[quarterMonthsMeta.length - 1]; // Month 3 of quarter

  const [catRows] = await promiseDb.query(
    `SELECT id, code, name, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description FROM strategy_source_categories WHERE is_active = 1 ORDER BY display_order ASC, id ASC`
  );

  const categoriesSummary = [];
  const totals = {
    totalBaseGoal: 0,
    totalEffectiveGoal: 0,
    totalAchievement: 0,
    totalFinalClosingShortfall: 0,
    totalFinalClosingExcess: 0
  };

  for (const cat of catRows) {
    const monthsSequence = await calculateCategoryQuarterMonths(financialYear, qNum, cat.id, promiseDb);
    let quarterBaseGoal = 0;
    let quarterAchievement = 0;
    let quarterShortfallAdditionTotal = 0;
    let quarterExcessReductionTotal = 0;

    for (const mCalc of monthsSequence) {
      quarterBaseGoal = roundMoney(quarterBaseGoal + mCalc.baseGoal);
      quarterAchievement = roundMoney(quarterAchievement + mCalc.achievement);
      quarterShortfallAdditionTotal = roundMoney(quarterShortfallAdditionTotal + (mCalc.quarterShortfallAddition || 0));
      quarterExcessReductionTotal = roundMoney(quarterExcessReductionTotal + (mCalc.quarterExcessReduction || 0));
    }

    const firstMonth = monthsSequence[0] || {};
    const incomingShortfall = roundMoney(firstMonth.incomingShortfall || 0);
    const incomingExcessCredit = roundMoney(firstMonth.incomingExcessCredit || 0);

    const positiveTarget = roundMoney(quarterBaseGoal + quarterShortfallAdditionTotal + incomingShortfall);
    const reductionCredit = roundMoney(quarterExcessReductionTotal + incomingExcessCredit);
    const quarterEffectiveGoal = roundMoney(Math.max(0, positiveTarget - reductionCredit));

    const finalMonth = monthsSequence[monthsSequence.length - 1];
    const finalClosingShortfall = finalMonth.closingShortfall;
    const finalClosingExcess = finalMonth.closingExcess;

    categoriesSummary.push({
      categoryId: cat.id,
      categoryCode: cat.code,
      categoryName: cat.name,
      icon_svg: cat.icon_svg,
      icon_background: cat.icon_background,
      icon_color: cat.icon_color,
      badge_background: cat.badge_background,
      badge_text_color: cat.badge_text_color,
      description: cat.description,
      quarterBaseGoal,
      quarterEffectiveGoal,
      quarterAchievement,
      finalClosingShortfall,
      finalClosingExcess,
      monthsSequence
    });

    totals.totalBaseGoal = roundMoney(totals.totalBaseGoal + quarterBaseGoal);
    totals.totalEffectiveGoal = roundMoney(totals.totalEffectiveGoal + quarterEffectiveGoal);
    totals.totalAchievement = roundMoney(totals.totalAchievement + quarterAchievement);
    totals.totalFinalClosingShortfall = roundMoney(totals.totalFinalClosingShortfall + finalClosingShortfall);
    totals.totalFinalClosingExcess = roundMoney(totals.totalFinalClosingExcess + finalClosingExcess);
  }

  return {
    financialYear,
    quarterNumber: qNum,
    closingMonthNumber: closingMonthMeta.monthNumber,
    closingMonthName: closingMonthMeta.monthName,
    categories: categoriesSummary,
    totals
  };
}

/* ==========================================================================
 * 10. GET QUARTER CLOSING BALANCE
 * ========================================================================== */

/**
 * Returns clean allocation-ready structure of final unresolved Quarter Closing Balance
 * from Month 3 for all five categories.
 */
async function getQuarterClosingBalance(financialYear, quarterNumber, databasePool = db) {
  const summary = await getQuarterSummary(financialYear, quarterNumber, databasePool);

  const categories = summary.categories.map(c => {
    let closingBalanceType = "BALANCED";
    let closingBalanceAmount = 0.00;
    if (c.finalClosingShortfall > 0) {
      closingBalanceType = "SHORTFALL";
      closingBalanceAmount = roundMoney(c.finalClosingShortfall);
    } else if (c.finalClosingExcess > 0) {
      closingBalanceType = "EXCESS";
      closingBalanceAmount = roundMoney(c.finalClosingExcess);
    }

    return {
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      categoryCode: c.categoryCode,
      icon_svg: c.icon_svg,
      icon_background: c.icon_background,
      icon_color: c.icon_color,
      badge_background: c.badge_background,
      badge_text_color: c.badge_text_color,
      description: c.description,
      shortfall: c.finalClosingShortfall,
      excess: c.finalClosingExcess,
      closingBalanceType,
      closingBalanceAmount
    };
  });

  return {
    financialYear,
    quarterNumber: summary.quarterNumber,
    closingMonth: summary.closingMonthName,
    closingMonthNumber: summary.closingMonthNumber,
    categories,
    totalShortfall: summary.totals.totalFinalClosingShortfall,
    totalExcess: summary.totals.totalFinalClosingExcess
  };
}

/* ==========================================================================
 * 11. CLOSED STRATEGY STATUS & PHASE 4 SYNC ENGINE
 * ========================================================================== */

/**
 * Returns true only for closed strategy statuses: 'Approved' and 'Won' (case-insensitive).
 */
function isStrategyClosedStatus(status) {
  if (!status) return false;
  const normalized = String(status).trim().toLowerCase();
  return normalized === "approved" || normalized === "won";
}

/**
 * Idempotently deactivates a quotation contribution when quotation is no longer Approved/Won.
 */
async function removeQuotationContribution(quotationId, options = {}) {
  const databasePool = options.connection || options.databasePool || db;
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;

  if (!quotationId) throw new Error("quotationId is required for removeQuotationContribution");
  const qId = Number(quotationId);

  const [existingRows] = await promiseDb.query(
    `SELECT id, is_active FROM strategy_quotation_contributions WHERE quotation_id = ?`,
    [qId]
  );

  if (existingRows.length === 0) {
    return { action: "UNCHANGED", reason: "NO_CONTRIBUTION", quotationId: qId };
  }

  if (existingRows[0].is_active === 0) {
    return { action: "UNCHANGED", reason: "ALREADY_DEACTIVATED", quotationId: qId };
  }

  await promiseDb.query(
    `UPDATE strategy_quotation_contributions SET is_active = 0 WHERE id = ?`,
    [existingRows[0].id]
  );

  return { action: "DEACTIVATED", quotationId: qId };
}

/**
 * Centralized, idempotent Strategy contribution synchronization method for Approved/Won quotations.
 */
async function syncWonQuotationContribution(quotationId, options = {}) {
  const databasePool = options.connection || options.databasePool || db;
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;

  if (!quotationId) throw new Error("quotationId is required for syncWonQuotationContribution");
  const qId = Number(quotationId);

  // Step 1: Load quotation with Net Revenue calculation and joined lead source info
  const [qRows] = await promiseDb.query(
    `SELECT q.id, q.lead_id, q.quotation_no, q.quotation_status, q.source, q.amount, q.quotation_date,
            COALESCE(qs.amount_9 + qs.amount_18, q.amount) AS net_revenue_amount,
            l.source AS lead_source
     FROM quotation q
     LEFT JOIN (
       SELECT quotation_id, SUM(amount_9) AS amount_9, SUM(amount_18) AS amount_18
       FROM quotation_splits
       GROUP BY quotation_id
     ) qs ON qs.quotation_id = q.id
     LEFT JOIN lead l ON l.lead_id = q.lead_id
     WHERE q.id = ?`,
    [qId]
  );

  if (qRows.length === 0) {
    return { action: "UNCHANGED", reason: "QUOTATION_NOT_FOUND", quotationId: qId };
  }
  const quotation = qRows[0];

  // Step 2: Check Strategy Closed Status
  if (!isStrategyClosedStatus(quotation.quotation_status)) {
    return await removeQuotationContribution(qId, options);
  }

  // Step 3: Calculate Net Revenue Before GST
  const netRevenue = roundMoney(quotation.net_revenue_amount);

  // Step 4: Resolve Source Mapping
  // Priority: 1. quotation.source (exact snapshot text or ID), 2. lead.source fallback
  const sourceInput = (quotation.source && String(quotation.source).trim() !== "")
    ? quotation.source
    : (quotation.lead_source || "");

  const mappingInfo = await getMappedCategoryBySource(sourceInput, databasePool);
  if (!mappingInfo.mapped) {
    // If an active contribution exists, deactivate it because source is unmapped / not found
    await removeQuotationContribution(qId, options);
    return {
      action: "EXCLUDED",
      reason: mappingInfo.reason,
      sourceId: mappingInfo.sourceId || null,
      sourceName: mappingInfo.sourceName || String(sourceInput),
      quotationId: qId,
      quotationNo: quotation.quotation_no
    };
  }

  // Step 5: Resolve Authoritative Won Date
  const wonDateInfo = await getAuthoritativeWonDate(qId, databasePool, options);
  const wonDate = wonDateInfo.wonDate;

  // Step 6: Determine Financial Year, Quarter Number, and Month Number
  const financialYear = getFinancialYearFromDate(wonDate);
  const dateParts = wonDate.split("-");
  const calendarMonth = parseInt(dateParts[1], 10);
  const quarterNumber = getQuarterFromMonth(calendarMonth);
  const monthNumber = calendarMonth;

  // Step 7: UPSERT / UPDATE existing contribution
  const [existingRows] = await promiseDb.query(
    `SELECT id, source_id, strategy_category_id, won_date, financial_year, quarter_number, month_number, contribution_amount, is_active
     FROM strategy_quotation_contributions
     WHERE quotation_id = ?`,
    [qId]
  );

  if (existingRows.length > 0) {
    const existing = existingRows[0];
    const existingDateStr = typeof existing.won_date === "string"
      ? existing.won_date.split("T")[0]
      : (existing.won_date ? existing.won_date.toISOString().split("T")[0] : "");

    const isIdentical = existing.is_active === 1 &&
      existing.source_id === mappingInfo.sourceId &&
      existing.strategy_category_id === mappingInfo.strategyCategoryId &&
      existingDateStr === wonDate &&
      existing.financial_year === financialYear &&
      existing.quarter_number === quarterNumber &&
      existing.month_number === monthNumber &&
      roundMoney(existing.contribution_amount) === netRevenue;

    if (isIdentical) {
      return {
        action: "UNCHANGED",
        quotationId: qId,
        quotationNo: quotation.quotation_no,
        sourceId: mappingInfo.sourceId,
        sourceName: mappingInfo.sourceName,
        strategyCategoryId: mappingInfo.strategyCategoryId,
        strategyCategoryName: mappingInfo.strategyCategoryName,
        wonDate,
        financialYear,
        quarterNumber,
        monthNumber,
        contributionAmount: netRevenue
      };
    }

    const action = existing.is_active === 0 ? "REACTIVATED" : "UPDATED";
    await promiseDb.query(
      `UPDATE strategy_quotation_contributions
       SET source_id = ?, source_name = ?, strategy_category_id = ?, won_date = ?,
           financial_year = ?, quarter_number = ?, month_number = ?, contribution_amount = ?, is_active = 1
       WHERE id = ?`,
      [
        mappingInfo.sourceId,
        mappingInfo.sourceName,
        mappingInfo.strategyCategoryId,
        wonDate,
        financialYear,
        quarterNumber,
        monthNumber,
        netRevenue,
        existing.id
      ]
    );

    return {
      action,
      quotationId: qId,
      quotationNo: quotation.quotation_no,
      sourceId: mappingInfo.sourceId,
      sourceName: mappingInfo.sourceName,
      strategyCategoryId: mappingInfo.strategyCategoryId,
      strategyCategoryName: mappingInfo.strategyCategoryName,
      wonDate,
      financialYear,
      quarterNumber,
      monthNumber,
      contributionAmount: netRevenue
    };
  } else {
    await promiseDb.query(
      `INSERT INTO strategy_quotation_contributions
       (quotation_id, source_id, source_name, strategy_category_id, won_date, financial_year, quarter_number, month_number, contribution_amount, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        qId,
        mappingInfo.sourceId,
        mappingInfo.sourceName,
        mappingInfo.strategyCategoryId,
        wonDate,
        financialYear,
        quarterNumber,
        monthNumber,
        netRevenue
      ]
    );

    return {
      action: "CREATED",
      quotationId: qId,
      quotationNo: quotation.quotation_no,
      sourceId: mappingInfo.sourceId,
      sourceName: mappingInfo.sourceName,
      strategyCategoryId: mappingInfo.strategyCategoryId,
      strategyCategoryName: mappingInfo.strategyCategoryName,
      wonDate,
      financialYear,
      quarterNumber,
      monthNumber,
      contributionAmount: netRevenue
    };
  }
}

/**
 * Scans historical Approved/Won quotations and synchronizes Strategy contributions for a specific Financial Year.
 */
async function rebuildHistoricalAchievements(financialYear, options = {}) {
  const databasePool = options.connection || options.databasePool || db;
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;

  if (!financialYear || typeof financialYear !== "string") {
    throw new Error("financialYear is required for rebuildHistoricalAchievements");
  }

  const [qRows] = await promiseDb.query(
    `SELECT id, quotation_status FROM quotation WHERE quotation_status IN ('Approved', 'Won')`
  );

  const summary = {
    totalClosedQuotationsScanned: qRows.length,
    eligibleForFinancialYear: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    reactivated: 0,
    deactivated: 0,
    excludedUnmappedSource: 0,
    excludedSourceNotFound: 0,
    failed: 0
  };
  const issues = [];

  for (const q of qRows) {
    try {
      const wonDateInfo = await getAuthoritativeWonDate(q.id, databasePool, options);
      const fy = getFinancialYearFromDate(wonDateInfo.wonDate);

      if (fy === financialYear) {
        summary.eligibleForFinancialYear++;
        const res = await syncWonQuotationContribution(q.id, options);

        if (res.action === "CREATED") summary.created++;
        else if (res.action === "UPDATED") summary.updated++;
        else if (res.action === "UNCHANGED") summary.unchanged++;
        else if (res.action === "REACTIVATED") summary.reactivated++;
        else if (res.action === "EXCLUDED") {
          if (res.reason === "SOURCE_NOT_MAPPED") {
            summary.excludedUnmappedSource++;
            issues.push({ quotationId: q.id, quotationNo: res.quotationNo || `QTN-${q.id}`, reason: res.reason, sourceName: res.sourceName });
          } else {
            summary.excludedSourceNotFound++;
            issues.push({ quotationId: q.id, quotationNo: res.quotationNo || `QTN-${q.id}`, reason: res.reason, sourceName: res.sourceName });
          }
        }
      }
    } catch (err) {
      summary.failed++;
      console.error(`Rebuild error for quotation #${q.id}:`, err.message);
    }
  }

  // Step 15: Stale contribution reconciliation for this financial year
  const [staleCandidateRows] = await promiseDb.query(
    `SELECT c.quotation_id, q.quotation_status, q.id AS q_exists
     FROM strategy_quotation_contributions c
     LEFT JOIN quotation q ON q.id = c.quotation_id
     WHERE c.financial_year = ? AND c.is_active = 1`,
    [financialYear]
  );

  for (const row of staleCandidateRows) {
    if (!row.q_exists || !isStrategyClosedStatus(row.quotation_status)) {
      try {
        const removeRes = await removeQuotationContribution(row.quotation_id, options);
        if (removeRes.action === "DEACTIVATED") {
          summary.deactivated++;
        }
      } catch (staleErr) {
        console.error(`Stale reconciliation error for quotation #${row.quotation_id}:`, staleErr.message);
      }
    }
  }

  return {
    financialYear,
    totalClosedQuotationsScanned: summary.totalClosedQuotationsScanned,
    eligibleForFinancialYear: summary.eligibleForFinancialYear,
    created: summary.created,
    updated: summary.updated,
    unchanged: summary.unchanged,
    reactivated: summary.reactivated,
    deactivated: summary.deactivated,
    excludedUnmappedSource: summary.excludedUnmappedSource,
    excludedSourceNotFound: summary.excludedSourceNotFound,
    failed: summary.failed,
    issues
  };
}

/* ==========================================================================
 * 8. PHASE 5: BASE GOAL MANAGEMENT HELPERS & ENGINE
 * ========================================================================== */

function validateFinancialYearFormat(fy) {
  if (!fy || typeof fy !== "string") return false;
  const parts = fy.trim().split("-");
  if (parts.length !== 2) return false;
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  if (isNaN(start) || isNaN(end) || start < 2000 || start > 2100) return false;
  return end === start + 1;
}

function constructMonthKey(financialYear, monthNumber) {
  const parts = financialYear.trim().split("-");
  const month = Number(monthNumber);
  const calendarYear = month >= 4 ? parts[0] : parts[1];
  return `${calendarYear}-${month < 10 ? "0" + month : month}`;
}

async function getFinancialYearGoalsMatrix(financialYear, options = {}) {
  if (!validateFinancialYearFormat(financialYear)) {
    throw new Error("Invalid financial year format. Must be YYYY-YYYY (e.g. 2026-2027)");
  }
  const dbConn = options.databasePool || db;
  const promiseDb = dbConn.promise ? dbConn.promise() : dbConn;

  const [catRows] = await promiseDb.query(
    `SELECT id, name, code, display_order, is_active, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description 
     FROM strategy_source_categories 
     WHERE is_active = 1
     ORDER BY display_order ASC, id ASC`
  );

  const [goalRows] = await promiseDb.query(
    `SELECT id, month_number, strategy_category_id, base_goal_amount 
     FROM strategy_monthly_goals 
     WHERE financial_year = ?`,
    [financialYear]
  );

  const goalMap = {};
  goalRows.forEach(row => {
    const key = `${row.strategy_category_id}_${row.month_number}`;
    goalMap[key] = {
      goalId: row.id,
      baseGoal: roundMoney(row.base_goal_amount)
    };
  });

  const months = getAllMonthsMetadata();
  const monthTotals = {};
  months.forEach(m => {
    monthTotals[String(m.monthNumber)] = 0.00;
  });
  let annualBaseGoalTotal = 0.00;

  const categories = catRows.map(cat => {
    let categoryAnnualTotal = 0.00;
    const goalsMap = {};
    const monthGoalsList = [];

    months.forEach(m => {
      const key = `${cat.id}_${m.monthNumber}`;
      const entry = goalMap[key] || { goalId: null, baseGoal: 0.00 };
      goalsMap[String(m.monthNumber)] = {
        goalId: entry.goalId,
        baseGoal: entry.baseGoal
      };
      monthGoalsList.push({
        monthNumber: m.monthNumber,
        monthName: m.monthName,
        shortName: m.shortName,
        quarterNumber: m.quarterNumber,
        goalId: entry.goalId,
        baseGoal: entry.baseGoal
      });
      categoryAnnualTotal = roundMoney(categoryAnnualTotal + entry.baseGoal);
      monthTotals[String(m.monthNumber)] = roundMoney(monthTotals[String(m.monthNumber)] + entry.baseGoal);
      annualBaseGoalTotal = roundMoney(annualBaseGoalTotal + entry.baseGoal);
    });

    return {
      categoryId: cat.id,
      categoryCode: cat.code,
      categoryName: cat.name,
      displayOrder: cat.display_order,
      icon_svg: cat.icon_svg,
      icon_background: cat.icon_background,
      icon_color: cat.icon_color,
      badge_background: cat.badge_background,
      badge_text_color: cat.badge_text_color,
      description: cat.description,
      goals: goalsMap,
      monthGoals: monthGoalsList,
      annualBaseGoal: categoryAnnualTotal
    };
  });

  return {
    financialYear,
    months,
    categories,
    monthTotals,
    annualBaseGoalTotal
  };
}

async function getMonthGoals(financialYear, calendarMonthNumber, options = {}) {
  if (!validateFinancialYearFormat(financialYear)) {
    throw new Error("Invalid financial year format. Must be YYYY-YYYY");
  }
  const monthNumber = Number(calendarMonthNumber);
  if (isNaN(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    throw new Error("Invalid calendar month number (must be 1 to 12)");
  }
  const meta = getMonthMetadata(monthNumber);
  const dbConn = options.databasePool || db;
  const promiseDb = dbConn.promise ? dbConn.promise() : dbConn;

  const [catRows] = await promiseDb.query(
    `SELECT id, name, code, display_order, icon_svg, icon_background, icon_color, badge_background, badge_text_color 
     FROM strategy_source_categories 
     WHERE is_active = 1
     ORDER BY display_order ASC, id ASC`
  );

  const [goalRows] = await promiseDb.query(
    `SELECT id, strategy_category_id, base_goal_amount 
     FROM strategy_monthly_goals 
     WHERE financial_year = ? AND month_number = ?`,
    [financialYear, monthNumber]
  );

  let monthBaseGoalTotal = 0.00;
  const categories = catRows.map(cat => {
    const goalRow = goalRows.find(g => Number(g.strategy_category_id) === Number(cat.id));
    const baseGoal = goalRow ? roundMoney(goalRow.base_goal_amount) : 0.00;
    monthBaseGoalTotal = roundMoney(monthBaseGoalTotal + baseGoal);
    return {
      goalId: goalRow ? goalRow.id : null,
      categoryId: cat.id,
      categoryCode: cat.code,
      categoryName: cat.name,
      baseGoal
    };
  });

  return {
    financialYear,
    monthNumber: meta.monthNumber,
    monthName: meta.monthName,
    shortName: meta.shortName,
    quarterNumber: meta.quarterNumber,
    financialYearOrder: meta.financialYearOrder,
    categories,
    monthBaseGoalTotal
  };
}

async function upsertBaseGoal({ financialYear, monthNumber, strategyCategoryId, baseGoalAmount, reason, performedBy }, options = {}) {
  if (!validateFinancialYearFormat(financialYear)) {
    throw new Error("Invalid financial year format. Must be YYYY-YYYY");
  }
  const month = Number(monthNumber);
  if (isNaN(month) || month < 1 || month > 12) {
    throw new Error("Invalid monthNumber (must be 1 to 12)");
  }
  if (baseGoalAmount === null || baseGoalAmount === undefined || baseGoalAmount === "") {
    throw new Error("baseGoalAmount is required");
  }
  const amount = Number(baseGoalAmount);
  if (isNaN(amount) || !isFinite(amount) || amount < 0) {
    throw new Error("baseGoalAmount must be a valid non-negative number");
  }
  const roundedAmount = roundMoney(amount);
  if (roundedAmount > 999999999999.99) {
    throw new Error("baseGoalAmount exceeds maximum allowed limit");
  }

  const dbConn = options.databasePool || db;
  const promiseDb = dbConn.promise ? dbConn.promise() : dbConn;

  const [catRows] = await promiseDb.query(
    "SELECT id, name, code, icon_svg, icon_background, icon_color, badge_background, badge_text_color FROM strategy_source_categories WHERE id = ? AND is_active = 1",
    [strategyCategoryId]
  );
  if (catRows.length === 0) {
    throw new Error("Invalid or inactive Main Strategy Category ID");
  }
  const categoryName = catRows[0].name;

  const qNum = getQuarterFromMonth(month);
  const [allocRows] = await promiseDb.query(
    "SELECT id FROM strategy_quarter_allocations WHERE source_financial_year = ? AND source_quarter = ? LIMIT 1",
    [financialYear, qNum]
  );
  const warning = allocRows.length > 0 ? {
    code: "QUARTER_ALLOCATION_RECALCULATION_REQUIRED",
    message: "This Base Goal change may affect an existing next-quarter allocation."
  } : null;

  const [existingRows] = await promiseDb.query(
    "SELECT id, base_goal_amount FROM strategy_monthly_goals WHERE financial_year = ? AND month_number = ? AND strategy_category_id = ?",
    [financialYear, month, strategyCategoryId]
  );

  if (existingRows.length > 0) {
    const oldRow = existingRows[0];
    const oldAmount = roundMoney(oldRow.base_goal_amount);
    if (oldAmount === roundedAmount) {
      return {
        action: "UNCHANGED",
        goalId: oldRow.id,
        financialYear,
        monthNumber: month,
        categoryId: Number(strategyCategoryId),
        categoryName,
        oldBaseGoal: oldAmount,
        newBaseGoal: roundedAmount,
        warning
      };
    }

    const conn = typeof promiseDb.getConnection === "function" ? await promiseDb.getConnection() : promiseDb;
    try {
      if (typeof conn.beginTransaction === "function") await conn.beginTransaction();
      const monthKey = constructMonthKey(financialYear, month);
      await conn.query(
        "UPDATE strategy_monthly_goals SET base_goal_amount = ?, month_key = ?, updated_by = ? WHERE id = ?",
        [roundedAmount, monthKey, performedBy || "System", oldRow.id]
      );
      await conn.query(
        `INSERT INTO strategy_goal_audit_logs (entity_type, entity_id, financial_year, quarter_number, month_number, strategy_category_id, action_type, old_value, new_value, metadata_json, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "BASE_GOAL",
          oldRow.id,
          financialYear,
          qNum,
          month,
          strategyCategoryId,
          "BASE_GOAL_UPDATED",
          String(oldAmount),
          String(roundedAmount),
          JSON.stringify({ categoryName, reason: reason || "" }),
          reason || "Updated Base Goal amount",
          performedBy || "System"
        ]
      );
      if (typeof conn.commit === "function") await conn.commit();
      return {
        action: "UPDATED",
        goalId: oldRow.id,
        financialYear,
        monthNumber: month,
        categoryId: Number(strategyCategoryId),
        categoryName,
        oldBaseGoal: oldAmount,
        newBaseGoal: roundedAmount,
        warning
      };
    } catch (txErr) {
      if (typeof conn.rollback === "function") await conn.rollback();
      throw txErr;
    } finally {
      if (typeof conn.release === "function") conn.release();
    }
  } else {
    const conn = typeof promiseDb.getConnection === "function" ? await promiseDb.getConnection() : promiseDb;
    try {
      if (typeof conn.beginTransaction === "function") await conn.beginTransaction();
      const monthKey = constructMonthKey(financialYear, month);
      const [insRes] = await conn.query(
        `INSERT INTO strategy_monthly_goals (financial_year, quarter_number, month_number, month_key, strategy_category_id, base_goal_amount, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [financialYear, qNum, month, monthKey, strategyCategoryId, roundedAmount, performedBy || "System", performedBy || "System"]
      );
      const newId = insRes.insertId;
      await conn.query(
        `INSERT INTO strategy_goal_audit_logs (entity_type, entity_id, financial_year, quarter_number, month_number, strategy_category_id, action_type, old_value, new_value, metadata_json, reason, performed_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "BASE_GOAL",
          newId,
          financialYear,
          qNum,
          month,
          strategyCategoryId,
          "BASE_GOAL_CREATED",
          "0.00",
          String(roundedAmount),
          JSON.stringify({ categoryName, reason: reason || "" }),
          reason || "Initial Base Goal target",
          performedBy || "System"
        ]
      );
      if (typeof conn.commit === "function") await conn.commit();
      return {
        action: "CREATED",
        goalId: newId,
        financialYear,
        monthNumber: month,
        categoryId: Number(strategyCategoryId),
        categoryName,
        oldBaseGoal: 0.00,
        newBaseGoal: roundedAmount,
        warning
      };
    } catch (txErr) {
      if (typeof conn.rollback === "function") await conn.rollback();
      throw txErr;
    } finally {
      if (typeof conn.release === "function") conn.release();
    }
  }
}

async function updateBaseGoalById(id, { baseGoalAmount, reason, performedBy }, options = {}) {
  const dbConn = options.databasePool || db;
  const promiseDb = dbConn.promise ? dbConn.promise() : dbConn;

  const [rows] = await promiseDb.query("SELECT * FROM strategy_monthly_goals WHERE id = ?", [id]);
  if (rows.length === 0) {
    return { found: false };
  }
  const goal = rows[0];

  if (baseGoalAmount === null || baseGoalAmount === undefined || baseGoalAmount === "") {
    throw new Error("baseGoalAmount is required");
  }
  const amount = Number(baseGoalAmount);
  if (isNaN(amount) || !isFinite(amount) || amount < 0) {
    throw new Error("baseGoalAmount must be a valid non-negative number");
  }
  const roundedAmount = roundMoney(amount);
  if (roundedAmount > 999999999999.99) {
    throw new Error("baseGoalAmount exceeds maximum allowed limit");
  }

  const oldAmount = roundMoney(goal.base_goal_amount);

  const [allocRows] = await promiseDb.query(
    "SELECT id FROM strategy_quarter_allocations WHERE source_financial_year = ? AND source_quarter = ? LIMIT 1",
    [goal.financial_year, goal.quarter_number]
  );
  const warning = allocRows.length > 0 ? {
    code: "QUARTER_ALLOCATION_RECALCULATION_REQUIRED",
    message: "This Base Goal change may affect an existing next-quarter allocation."
  } : null;

  if (oldAmount === roundedAmount) {
    return {
      found: true,
      action: "UNCHANGED",
      goalId: Number(id),
      financialYear: goal.financial_year,
      monthNumber: goal.month_number,
      categoryId: goal.strategy_category_id,
      oldBaseGoal: oldAmount,
      newBaseGoal: roundedAmount,
      warning
    };
  }

  const [catRows] = await promiseDb.query("SELECT name FROM strategy_source_categories WHERE id = ?", [goal.strategy_category_id]);
  const categoryName = catRows.length > 0 ? catRows[0].name : "Unknown";

  const conn = typeof promiseDb.getConnection === "function" ? await promiseDb.getConnection() : promiseDb;
  try {
    if (typeof conn.beginTransaction === "function") await conn.beginTransaction();
    await conn.query(
      "UPDATE strategy_monthly_goals SET base_goal_amount = ?, updated_by = ? WHERE id = ?",
      [roundedAmount, performedBy || "System", id]
    );
    await conn.query(
      `INSERT INTO strategy_goal_audit_logs (entity_type, entity_id, financial_year, quarter_number, month_number, strategy_category_id, action_type, old_value, new_value, metadata_json, reason, performed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "BASE_GOAL",
        id,
        goal.financial_year,
        goal.quarter_number,
        goal.month_number,
        goal.strategy_category_id,
        "BASE_GOAL_UPDATED",
        String(oldAmount),
        String(roundedAmount),
        JSON.stringify({ categoryName, reason: reason || "" }),
        reason || "Updated Base Goal amount by ID",
        performedBy || "System"
      ]
    );
    if (typeof conn.commit === "function") await conn.commit();
    return {
      found: true,
      action: "UPDATED",
      goalId: Number(id),
      financialYear: goal.financial_year,
      monthNumber: goal.month_number,
      categoryId: goal.strategy_category_id,
      categoryName,
      oldBaseGoal: oldAmount,
      newBaseGoal: roundedAmount,
      warning
    };
  } catch (txErr) {
    if (typeof conn.rollback === "function") await conn.rollback();
    throw txErr;
  } finally {
    if (typeof conn.release === "function") conn.release();
  }
}

async function bulkUpsertBaseGoals({ financialYear, reason, performedBy, goals }, options = {}) {
  if (!validateFinancialYearFormat(financialYear)) {
    throw new Error("Invalid financial year format. Must be YYYY-YYYY");
  }
  if (!Array.isArray(goals) || goals.length === 0) {
    throw new Error("goals array is required and cannot be empty");
  }

  const seen = new Set();
  for (const item of goals) {
    const month = Number(item.monthNumber);
    if (isNaN(month) || month < 1 || month > 12) {
      throw new Error(`Invalid monthNumber ${item.monthNumber} in bulk save`);
    }
    if (item.baseGoalAmount === null || item.baseGoalAmount === undefined || item.baseGoalAmount === "") {
      throw new Error(`baseGoalAmount is required for month ${month}`);
    }
    const amt = Number(item.baseGoalAmount);
    if (isNaN(amt) || !isFinite(amt) || amt < 0) {
      throw new Error(`Invalid or negative baseGoalAmount (${item.baseGoalAmount}) for month ${month}`);
    }
    if (amt > 999999999999.99) {
      throw new Error(`baseGoalAmount exceeds maximum allowed limit for month ${month}`);
    }
    const catId = Number(item.strategyCategoryId);
    if (isNaN(catId) || catId <= 0) {
      throw new Error(`Invalid strategyCategoryId in bulk save`);
    }
    const key = `${month}_${catId}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate month and strategy category combination inside bulk payload: Month ${month}, Category ID ${catId}`);
    }
    seen.add(key);
  }

  const dbConn = options.databasePool || db;
  const promiseDb = dbConn.promise ? dbConn.promise() : dbConn;

  const [catRows] = await promiseDb.query("SELECT id, name FROM strategy_source_categories WHERE is_active = 1");
  const catMap = {};
  catRows.forEach(c => { catMap[c.id] = c.name; });

  for (const item of goals) {
    if (!catMap[Number(item.strategyCategoryId)]) {
      throw new Error(`Main Strategy Category ID ${item.strategyCategoryId} does not exist or is not active`);
    }
  }

  const [allocRows] = await promiseDb.query(
    "SELECT DISTINCT source_quarter FROM strategy_quarter_allocations WHERE source_financial_year = ?",
    [financialYear]
  );
  const allocatedQuarters = new Set(allocRows.map(r => Number(r.source_quarter)));
  let warning = null;
  for (const item of goals) {
    if (allocatedQuarters.has(getQuarterFromMonth(item.monthNumber))) {
      warning = {
        code: "QUARTER_ALLOCATION_RECALCULATION_REQUIRED",
        message: "One or more Base Goal changes may affect an existing next-quarter allocation."
      };
      break;
    }
  }

  const conn = typeof promiseDb.getConnection === "function" ? await promiseDb.getConnection() : promiseDb;
  let created = 0, updated = 0, unchanged = 0;
  try {
    if (typeof conn.beginTransaction === "function") await conn.beginTransaction();
    for (const item of goals) {
      const month = Number(item.monthNumber);
      const catId = Number(item.strategyCategoryId);
      const roundedAmount = roundMoney(item.baseGoalAmount);
      const qNum = getQuarterFromMonth(month);
      const monthKey = constructMonthKey(financialYear, month);
      const catName = catMap[catId] || "Unknown";

      const [existing] = await conn.query(
        "SELECT id, base_goal_amount FROM strategy_monthly_goals WHERE financial_year = ? AND month_number = ? AND strategy_category_id = ?",
        [financialYear, month, catId]
      );
      if (existing.length > 0) {
        const oldId = existing[0].id;
        const oldAmt = roundMoney(existing[0].base_goal_amount);
        if (oldAmt === roundedAmount) {
          unchanged++;
        } else {
          await conn.query(
            "UPDATE strategy_monthly_goals SET base_goal_amount = ?, month_key = ?, updated_by = ? WHERE id = ?",
            [roundedAmount, monthKey, performedBy || "System", oldId]
          );
          await conn.query(
            `INSERT INTO strategy_goal_audit_logs (entity_type, entity_id, financial_year, quarter_number, month_number, strategy_category_id, action_type, old_value, new_value, metadata_json, reason, performed_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              "BASE_GOAL",
              oldId,
              financialYear,
              qNum,
              month,
              catId,
              "BASE_GOAL_UPDATED",
              String(oldAmt),
              String(roundedAmount),
              JSON.stringify({ categoryName: catName, reason: reason || "Bulk update" }),
              reason || "Bulk update Base Goal",
              performedBy || "System"
            ]
          );
          updated++;
        }
      } else {
        const [insRes] = await conn.query(
          `INSERT INTO strategy_monthly_goals (financial_year, quarter_number, month_number, month_key, strategy_category_id, base_goal_amount, created_by, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [financialYear, qNum, month, monthKey, catId, roundedAmount, performedBy || "System", performedBy || "System"]
        );
        const newId = insRes.insertId;
        await conn.query(
          `INSERT INTO strategy_goal_audit_logs (entity_type, entity_id, financial_year, quarter_number, month_number, strategy_category_id, action_type, old_value, new_value, metadata_json, reason, performed_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            "BASE_GOAL",
            newId,
            financialYear,
            qNum,
            month,
            catId,
            "BASE_GOAL_CREATED",
            "0.00",
            String(roundedAmount),
            JSON.stringify({ categoryName: catName, reason: reason || "Bulk create" }),
            reason || "Bulk create Base Goal",
            performedBy || "System"
          ]
        );
        created++;
      }
    }
    if (typeof conn.commit === "function") await conn.commit();
    return {
      created,
      updated,
      unchanged,
      totalProcessed: goals.length,
      warning
    };
  } catch (txErr) {
    if (typeof conn.rollback === "function") await conn.rollback();
    throw txErr;
  } finally {
    if (typeof conn.release === "function") conn.release();
  }
}

/* ==========================================================================
 * 14. PHASE 6 & 7: QUARTER TRANSITION, ALLOCATION & REALLOCATION ENGINE
 * ========================================================================== */

/**
 * Returns the exact target Financial Year, Quarter Number, and Month Metadata for allocating a source quarter's closing balance.
 * Enforces Q1->Q2, Q2->Q3, Q3->Q4, and Q4->Next FY Q1.
 */
function getNextQuarterContext(financialYear, quarterNumber) {
  validateFinancialYearFormat(financialYear);
  const qNum = Number(quarterNumber);
  if (qNum < 1 || qNum > 4 || isNaN(qNum)) {
    throw new Error("quarterNumber must be between 1 and 4");
  }

  let targetFinancialYear = financialYear;
  let targetQuarterNumber = qNum + 1;

  if (qNum === 4) {
    const parts = financialYear.split("-").map(Number);
    targetFinancialYear = `${parts[0] + 1}-${parts[1] + 1}`;
    targetQuarterNumber = 1;
  }

  const targetMonthsMeta = ALL_MONTHS_METADATA.filter(m => m.quarterNumber === targetQuarterNumber).sort((a, b) => a.financialYearOrder - b.financialYearOrder);
  const targetMonths = targetMonthsMeta.map(m => ({
    monthNumber: m.monthNumber,
    monthName: m.monthName,
    shortName: m.shortName
  }));

  return {
    sourceFinancialYear: financialYear,
    sourceQuarterNumber: qNum,
    targetFinancialYear,
    targetQuarterNumber,
    targetMonths
  };
}

/**
 * Returns complete quarter allocation context, source closing balances, current confirmed allocations, and stale state detection.
 */
async function getQuarterAllocationData(financialYear, quarterNumber, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const qNum = Number(quarterNumber);

  // 1. Get Source Quarter Closing Balance
  const closingBalanceData = await getQuarterClosingBalance(financialYear, qNum, promiseDb);

  // 2. Get Next Quarter Context
  const nextQuarterContext = getNextQuarterContext(financialYear, qNum);

  // 3. For each of the 5 categories, fetch current CONFIRMED allocation (if any) and check stale state
  const targetMonthNumbers = nextQuarterContext.targetMonths.map(m => m.monthNumber);

  const [allocRows] = await promiseDb.query(
    `SELECT id, destination_month, strategy_category_id, allocation_type, amount, status, source_closing_amount
     FROM strategy_quarter_allocations
     WHERE source_financial_year = ? AND source_quarter = ? AND status = 'CONFIRMED'`,
    [financialYear, qNum]
  );

  const allocMap = {};
  for (const r of allocRows) {
    const catId = Number(r.strategy_category_id);
    if (!allocMap[catId]) {
      allocMap[catId] = {
        months: {},
        allocatedTotal: 0,
        sourceClosingSnapshot: roundMoney(r.source_closing_amount)
      };
    }
    const mNum = Number(r.destination_month);
    const amt = roundMoney(r.amount);
    allocMap[catId].months[mNum] = amt;
    allocMap[catId].allocatedTotal = roundMoney(allocMap[catId].allocatedTotal + amt);
  }

  const categories = [];
  let anyStale = false;

  for (const cat of closingBalanceData.categories) {
    const catId = cat.categoryId;
    const currentAlloc = allocMap[catId] || { months: {}, allocatedTotal: 0, sourceClosingSnapshot: null };

    const currentAllocationMap = {};
    for (const mNum of targetMonthNumbers) {
      currentAllocationMap[mNum] = roundMoney(currentAlloc.months[mNum] || 0);
    }

    let allocationStatus = "NOT ALLOCATED";
    if (cat.closingBalanceType === "BALANCED") {
      allocationStatus = "NOT REQUIRED";
    } else if (currentAlloc.sourceClosingSnapshot !== null) {
      allocationStatus = "CONFIRMED";
    }

    let isStale = false;
    if (allocationStatus === "CONFIRMED" && currentAlloc.sourceClosingSnapshot !== null) {
      if (Math.abs(cat.closingBalanceAmount - currentAlloc.sourceClosingSnapshot) > 0.009) {
        isStale = true;
        allocationStatus = "STALE";
        anyStale = true;
      }
    }

    const remainingAmount = roundMoney(cat.closingBalanceAmount - currentAlloc.allocatedTotal);

    categories.push({
      categoryId: cat.categoryId,
      categoryCode: cat.categoryCode,
      categoryName: cat.categoryName,
      icon_svg: cat.icon_svg,
      icon_background: cat.icon_background,
      icon_color: cat.icon_color,
      badge_background: cat.badge_background,
      badge_text_color: cat.badge_text_color,
      closingBalanceType: cat.closingBalanceType,
      closingBalanceAmount: cat.closingBalanceAmount,
      currentAllocation: currentAllocationMap,
      allocatedTotal: currentAlloc.allocatedTotal,
      remainingAmount,
      allocationStatus,
      isStale,
      previousClosingSnapshot: currentAlloc.sourceClosingSnapshot !== null ? currentAlloc.sourceClosingSnapshot : cat.closingBalanceAmount
    });
  }

  return {
    sourceFinancialYear: financialYear,
    sourceQuarterNumber: qNum,
    sourceQuarterLabel: `Q${qNum}`,
    closingMonthNumber: closingBalanceData.closingMonthNumber,
    closingMonthName: closingBalanceData.closingMonth,
    targetFinancialYear: nextQuarterContext.targetFinancialYear,
    targetQuarterNumber: nextQuarterContext.targetQuarterNumber,
    targetMonths: nextQuarterContext.targetMonths,
    categories,
    isStale: anyStale
  };
}

/**
 * Transactionally confirms or replaces a Quarter Allocation plan across target months,
 * synchronizing strategy_adjustments and generating full audit history.
 */
async function allocateQuarterBalance({ sourceFinancialYear, sourceQuarterNumber, reason, performedBy, allocations }, options = {}) {
  const databasePool = options.connection || options.databasePool || db;
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;

  validateFinancialYearFormat(sourceFinancialYear);
  const qNum = Number(sourceQuarterNumber);
  if (qNum < 1 || qNum > 4 || isNaN(qNum)) {
    throw new Error("sourceQuarterNumber must be between 1 and 4");
  }

  if (!Array.isArray(allocations) || allocations.length === 0) {
    throw new Error("allocations must be a non-empty array");
  }

  const nextContext = getNextQuarterContext(sourceFinancialYear, qNum);
  const targetFinancialYear = nextContext.targetFinancialYear;
  const targetQuarterNumber = nextContext.targetQuarterNumber;
  const validTargetMonths = nextContext.targetMonths.map(m => m.monthNumber);

  const seenCatIds = new Set();
  for (const alloc of allocations) {
    const catId = Number(alloc.strategyCategoryId);
    if (!catId || isNaN(catId)) {
      throw new Error("Each allocation item must have a valid numeric strategyCategoryId");
    }
    if (seenCatIds.has(catId)) {
      throw new Error(`Duplicate strategyCategoryId in allocation request: ${catId}`);
    }
    seenCatIds.add(catId);
  }

  const [catRows] = await promiseDb.query(
    `SELECT id, code, name FROM strategy_source_categories
     WHERE is_active = 1`
  );
  const validCatIds = new Set(catRows.map(c => Number(c.id)));
  const catMap = {};
  for (const c of catRows) catMap[Number(c.id)] = c;

  for (const catId of seenCatIds) {
    if (!validCatIds.has(catId)) {
      throw new Error(`Invalid or inactive Strategy Category ID: ${catId}.`);
    }
  }

  const conn = await promiseDb.getConnection();
  let createdCount = 0;
  let replacedCount = 0;
  let unchangedCount = 0;

  try {
    if (typeof conn.beginTransaction === "function") await conn.beginTransaction();

    const closingBalanceData = await getQuarterClosingBalance(sourceFinancialYear, qNum, conn);
    const closingCatMap = {};
    for (const c of closingBalanceData.categories) {
      closingCatMap[c.categoryId] = c;
    }

    for (const alloc of allocations) {
      const catId = Number(alloc.strategyCategoryId);
      const catClosing = closingCatMap[catId];
      if (!catClosing) {
        throw new Error(`Closing balance not found for Category ID ${catId}`);
      }

      const monthsPayload = alloc.months || {};
      let totalAllocated = 0;
      const monthAllocations = {};

      for (const targetMonthNum of validTargetMonths) {
        let amtVal = 0;
        if (monthsPayload[targetMonthNum] !== undefined) {
          amtVal = Number(monthsPayload[targetMonthNum]);
          if (isNaN(amtVal) || !isFinite(amtVal) || amtVal < 0) {
            throw new Error(`Allocation amount for Month ${targetMonthNum} of Category '${catMap[catId].name}' must be a non-negative finite number.`);
          }
        }
        amtVal = roundMoney(amtVal);
        monthAllocations[targetMonthNum] = amtVal;
        totalAllocated = roundMoney(totalAllocated + amtVal);
      }

      for (const k of Object.keys(monthsPayload)) {
        if (!validTargetMonths.includes(Number(k))) {
          throw new Error(`Invalid month ${k} specified for allocation. Target quarter Q${targetQuarterNumber} (${targetFinancialYear}) only allows months: ${validTargetMonths.join(", ")}`);
        }
      }

      if (catClosing.closingBalanceType === "BALANCED") {
        if (totalAllocated > 0) {
          throw new Error(`Category '${catMap[catId].name}' is BALANCED (₹0.00 closing balance). Cannot allocate ₹${totalAllocated}. Allocation must be 0.`);
        }
      } else {
        if (Math.abs(totalAllocated - catClosing.closingBalanceAmount) > 0.009) {
          throw new Error(`Allocation mismatch for Category '${catMap[catId].name}': Total allocated (₹${totalAllocated}) must exactly equal the closing ${catClosing.closingBalanceType.toLowerCase()} balance (₹${catClosing.closingBalanceAmount}).`);
        }
      }

      const allocationType = catClosing.closingBalanceType;
      let adjustmentType = null;
      if (allocationType === "SHORTFALL") {
        adjustmentType = "QUARTER_SHORTFALL_ADDITION";
      } else if (allocationType === "EXCESS") {
        adjustmentType = "QUARTER_EXCESS_REDUCTION";
      }

      const [existingAlloc] = await conn.query(
        `SELECT id, destination_month, amount, source_closing_amount
         FROM strategy_quarter_allocations
         WHERE source_financial_year = ? AND source_quarter = ? AND strategy_category_id = ? AND status = 'CONFIRMED'
         FOR UPDATE`,
        [sourceFinancialYear, qNum, catId]
      );

      let isIdentical = false;
      let existingIds = [];
      let oldAllocSummary = {};
      let oldSnapshot = null;

      if (existingAlloc.length > 0) {
        existingIds = existingAlloc.map(r => r.id);
        oldSnapshot = existingAlloc[0].source_closing_amount;
        let identicalCount = 0;
        for (const r of existingAlloc) {
          const mNum = Number(r.destination_month);
          const amt = roundMoney(r.amount);
          oldAllocSummary[mNum] = amt;
          if (monthAllocations[mNum] === amt) {
            identicalCount++;
          }
        }
        if (existingAlloc.length === validTargetMonths.length && identicalCount === validTargetMonths.length && Math.abs((oldSnapshot || 0) - catClosing.closingBalanceAmount) <= 0.009) {
          isIdentical = true;
        }
      }

      if (isIdentical) {
        unchangedCount++;
        continue;
      }

      if (existingIds.length > 0) {
        await conn.query(
          `UPDATE strategy_quarter_allocations SET status = 'SUPERSEDED'
           WHERE id IN (${existingIds.map(() => "?").join(",")})`,
          existingIds
        );

        await conn.query(
          `UPDATE strategy_adjustments SET is_active = 0
           WHERE reference_type = 'QUARTER_ALLOCATION' AND reference_id IN (${existingIds.map(() => "?").join(",")})`,
          existingIds
        );
        replacedCount++;
      } else if (totalAllocated > 0 || allocationType !== "BALANCED") {
        createdCount++;
      }

      for (const targetMonthNum of validTargetMonths) {
        const allocAmt = monthAllocations[targetMonthNum];
        
        const [insRes] = await conn.query(
          `INSERT INTO strategy_quarter_allocations (
            source_financial_year, source_quarter, destination_financial_year, destination_quarter,
            destination_month, strategy_category_id, allocation_type, amount, reason, created_by, status, source_closing_amount
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)`,
          [
            sourceFinancialYear, qNum, targetFinancialYear, targetQuarterNumber,
            targetMonthNum, catId, allocationType, allocAmt, reason || "Quarter Closing Allocation", performedBy || "System", catClosing.closingBalanceAmount
          ]
        );
        const newAllocId = insRes.insertId;

        if (allocAmt > 0 && adjustmentType) {
          await conn.query(
            `INSERT INTO strategy_adjustments (
              financial_year, source_financial_year, destination_financial_year,
              source_quarter, destination_quarter, source_month, destination_month,
              strategy_category_id, adjustment_scope, adjustment_type, amount, reason,
              reference_type, reference_id, created_by, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUARTER_ALLOCATION', ?, ?, 1)`,
            [
              targetFinancialYear, sourceFinancialYear, targetFinancialYear,
              qNum, targetQuarterNumber, closingBalanceData.closingMonthNumber, targetMonthNum,
              catId, "QUARTER_REALLOCATION", adjustmentType, allocAmt, reason || "Quarter Closing Allocation",
              newAllocId, performedBy || "System"
            ]
          );
        }
      }

      const actionType = existingIds.length > 0 ? "QUARTER_ALLOCATION_REPLACED" : "QUARTER_ALLOCATION_CREATED";
      await conn.query(
        `INSERT INTO strategy_goal_audit_logs (
          entity_type, entity_id, financial_year, quarter_number, strategy_category_id,
          action_type, old_value, new_value, metadata_json, reason, performed_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "QUARTER_ALLOCATION",
          catId,
          sourceFinancialYear,
          qNum,
          catId,
          actionType,
          existingIds.length > 0 ? JSON.stringify(oldAllocSummary) : "{}",
          JSON.stringify(monthAllocations),
          JSON.stringify({
            categoryName: catMap[catId].name,
            allocationType,
            sourceClosingAmount: catClosing.closingBalanceAmount,
            targetFinancialYear,
            targetQuarterNumber,
            reason: reason || "Quarter Closing Allocation"
          }),
          reason || "Quarter Closing Allocation",
          performedBy || "System"
        ]
      );
    }

    if (typeof conn.commit === "function") await conn.commit();

    let action = "CREATED";
    if (replacedCount > 0 && createdCount === 0 && unchangedCount === 0) action = "REPLACED";
    if (unchangedCount === allocations.length) action = "UNCHANGED";
    else if (replacedCount > 0 || createdCount > 0) action = replacedCount > 0 ? "REPLACED" : "CREATED";

    return {
      success: true,
      action,
      created: createdCount,
      replaced: replacedCount,
      unchanged: unchangedCount,
      sourceFinancialYear,
      sourceQuarterNumber: qNum,
      targetFinancialYear,
      targetQuarterNumber
    };
  } catch (txErr) {
    if (typeof conn.rollback === "function") await conn.rollback();
    throw txErr;
  } finally {
    if (typeof conn.release === "function") conn.release();
  }
}

/* ==========================================================================
 * PHASE 8: CENTRALIZED STRATEGY OVERVIEW SERVICE
 * ========================================================================== */

async function getStrategyOverview(financialYear, options = {}, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const mode = (options.mode || "MONTH").toUpperCase();
  let periodNumber = options.period !== undefined ? Number(options.period) : null;

  if (!validateFinancialYearFormat(financialYear)) {
    throw new Error("Invalid Financial Year format. Expected 'YYYY-YYYY'.");
  }

  const currentDate = new Date();
  const currentCalendarMonth = currentDate.getMonth() + 1;
  const currentFY = getFinancialYearFromDate(currentDate.toISOString().split("T")[0]);
  const isCurrentFY = financialYear === currentFY;

  if (mode === "MONTH") {
    if (periodNumber === null || isNaN(periodNumber) || periodNumber < 1 || periodNumber > 12) {
      periodNumber = isCurrentFY ? currentCalendarMonth : 4;
    }
  } else if (mode === "QUARTER") {
    if (periodNumber === null || isNaN(periodNumber) || periodNumber < 1 || periodNumber > 4) {
      periodNumber = isCurrentFY ? getQuarterFromMonth(currentCalendarMonth) : 1;
    }
  }

  // Check unmapped quotations summary
  const [unmappedDirect] = await promiseDb.query(`
    SELECT 
      COUNT(q.id) AS count,
      COALESCE(SUM(COALESCE(qs.amount_9 + qs.amount_18, q.amount)), 0) AS rev
    FROM quotation q
    LEFT JOIN strategy_quotation_contributions sqc ON sqc.quotation_id = q.id AND sqc.is_active = 1
    LEFT JOIN (
      SELECT quotation_id, SUM(amount_9) AS amount_9, SUM(amount_18) AS amount_18
      FROM quotation_splits
      GROUP BY quotation_id
    ) qs ON qs.quotation_id = q.id
    WHERE q.quotation_status IN ('Approved', 'Won') AND sqc.id IS NULL
  `);
  const totalUnmappedClosedCount = Number(unmappedDirect[0]?.count || 0);
  const totalUnmappedClosedRevenue = roundMoney(unmappedDirect[0]?.rev || 0);

  const categories = [];

  if (mode === "MONTH") {
    const monthStrategy = await getMonthStrategy(financialYear, periodNumber, promiseDb);
    const qNum = monthStrategy.quarterNumber;
    const allocData = await getQuarterAllocationData(financialYear, qNum, promiseDb);

    for (const c of monthStrategy.categories) {
      const qAlloc = allocData?.categories?.find(x => x.categoryId === c.strategyCategoryId);
      const closingShortfall = c.closingShortfall;
      const closingExcess = c.closingExcess;
      const closingBalanceAmount = closingShortfall > 0 ? closingShortfall : closingExcess;
      const closingBalanceType = closingShortfall > 0 ? "SHORTFALL" : (closingExcess > 0 ? "EXCESS" : "BALANCED");

      let performanceStatus = "ON_TRACK";
      if (c.effectiveGoal > 0) {
        if (c.achievement > c.effectiveGoal) performanceStatus = "AHEAD";
        else if (c.achievement < c.effectiveGoal) performanceStatus = "BEHIND";
      } else if (c.effectiveGoal === 0 && c.achievement === 0) {
        performanceStatus = "BALANCED";
      } else if (c.effectiveGoal === 0 && c.achievement > 0) {
        performanceStatus = "AHEAD";
      }

      categories.push({
        categoryId: c.strategyCategoryId,
        categoryCode: c.categoryCode,
        categoryName: c.categoryName,
        icon_svg: c.icon_svg,
        icon_background: c.icon_background,
        icon_color: c.icon_color,
        badge_background: c.badge_background,
        badge_text_color: c.badge_text_color,
        baseGoal: c.baseGoal,
        incomingShortfall: c.incomingShortfall,
        incomingExcessCredit: c.incomingExcessCredit,
        quarterShortfallAddition: c.quarterShortfallAddition,
        quarterExcessReduction: c.quarterExcessReduction,
        effectiveGoal: c.effectiveGoal,
        achievement: c.achievement,
        variance: c.variance,
        achievementPercentage: c.achievementPercentage,
        closingShortfall,
        closingExcess,
        closingBalanceType,
        closingBalanceAmount,
        contributionCount: c.contributionCount,
        allocationStatus: qAlloc?.allocationStatus || "NOT_REQUIRED",
        isAllocationStale: Boolean(qAlloc?.isStale),
        performanceStatus,
        monthsSequence: [c]
      });
    }
  } else if (mode === "QUARTER") {
    const quarterSummary = await getQuarterSummary(financialYear, periodNumber, promiseDb);
    const allocData = await getQuarterAllocationData(financialYear, periodNumber, promiseDb);

    for (const c of quarterSummary.categories) {
      const qAlloc = allocData?.categories?.find(x => x.categoryId === c.categoryId);
      const closingShortfall = c.finalClosingShortfall;
      const closingExcess = c.finalClosingExcess;
      const closingBalanceAmount = closingShortfall > 0 ? closingShortfall : closingExcess;
      const closingBalanceType = closingShortfall > 0 ? "SHORTFALL" : (closingExcess > 0 ? "EXCESS" : "BALANCED");

      const firstMonth = c.monthsSequence[0] || {};
      const incomingShortfall = firstMonth.incomingShortfall || 0;
      const incomingExcessCredit = firstMonth.incomingExcessCredit || 0;
      const quarterShortfallAddition = roundMoney(c.monthsSequence.reduce((s, m) => s + (m.quarterShortfallAddition || 0), 0));
      const quarterExcessReduction = roundMoney(c.monthsSequence.reduce((s, m) => s + (m.quarterExcessReduction || 0), 0));
      const contributionCount = c.monthsSequence.reduce((s, m) => s + (m.contributionCount || 0), 0);

      const variance = roundMoney(c.quarterAchievement - c.quarterEffectiveGoal);
      let achievementPercentage = 0;
      if (c.quarterEffectiveGoal > 0) {
        achievementPercentage = roundMoney((c.quarterAchievement / c.quarterEffectiveGoal) * 100);
      } else if (c.quarterEffectiveGoal === 0 && c.quarterAchievement > 0) {
        achievementPercentage = 100;
      }

      let performanceStatus = "ON_TRACK";
      if (c.quarterEffectiveGoal > 0) {
        if (c.quarterAchievement > c.quarterEffectiveGoal) performanceStatus = "AHEAD";
        else if (c.quarterAchievement < c.quarterEffectiveGoal) performanceStatus = "BEHIND";
      } else if (c.quarterEffectiveGoal === 0 && c.quarterAchievement === 0) {
        performanceStatus = "BALANCED";
      } else if (c.quarterEffectiveGoal === 0 && c.quarterAchievement > 0) {
        performanceStatus = "AHEAD";
      }

      categories.push({
        categoryId: c.categoryId,
        categoryCode: c.categoryCode,
        categoryName: c.categoryName,
        icon_svg: c.icon_svg,
        icon_background: c.icon_background,
        icon_color: c.icon_color,
        badge_background: c.badge_background,
        badge_text_color: c.badge_text_color,
        baseGoal: c.quarterBaseGoal,
        incomingShortfall,
        incomingExcessCredit,
        quarterShortfallAddition,
        quarterExcessReduction,
        effectiveGoal: c.quarterEffectiveGoal,
        achievement: c.quarterAchievement,
        variance,
        achievementPercentage,
        closingShortfall,
        closingExcess,
        closingBalanceType,
        closingBalanceAmount,
        contributionCount,
        allocationStatus: qAlloc?.allocationStatus || "NOT_REQUIRED",
        isAllocationStale: Boolean(qAlloc?.isStale),
        performanceStatus,
        monthsSequence: c.monthsSequence
      });
    }
  } else if (mode === "YEAR") {
    const q1 = await getQuarterSummary(financialYear, 1, promiseDb);
    const q2 = await getQuarterSummary(financialYear, 2, promiseDb);
    const q3 = await getQuarterSummary(financialYear, 3, promiseDb);
    const q4 = await getQuarterSummary(financialYear, 4, promiseDb);

    const alloc1 = await getQuarterAllocationData(financialYear, 1, promiseDb);
    const alloc2 = await getQuarterAllocationData(financialYear, 2, promiseDb);
    const alloc3 = await getQuarterAllocationData(financialYear, 3, promiseDb);
    const alloc4 = await getQuarterAllocationData(financialYear, 4, promiseDb);

    for (let i = 0; i < q1.categories.length; i++) {
      const c1 = q1.categories[i];
      const c2 = q2.categories[i];
      const c3 = q3.categories[i];
      const c4 = q4.categories[i];

      const monthsSequence = [...c1.monthsSequence, ...c2.monthsSequence, ...c3.monthsSequence, ...c4.monthsSequence];
      const baseGoal = roundMoney(c1.quarterBaseGoal + c2.quarterBaseGoal + c3.quarterBaseGoal + c4.quarterBaseGoal);
      const achievement = roundMoney(c1.quarterAchievement + c2.quarterAchievement + c3.quarterAchievement + c4.quarterAchievement);

      const incomingShortfall = roundMoney(c1.monthsSequence[0]?.incomingShortfall || 0);
      const incomingExcessCredit = roundMoney(c1.monthsSequence[0]?.incomingExcessCredit || 0);

      const [extAdjRows] = await promiseDb.query(
        `SELECT adjustment_type, COALESCE(SUM(amount), 0) AS total_amount
         FROM strategy_adjustments
         WHERE financial_year = ? AND strategy_category_id = ? AND is_active = 1
           AND (source_financial_year IS NULL OR source_financial_year != ?)
         GROUP BY adjustment_type`,
        [financialYear, c1.categoryId, financialYear]
      );
      let extShortfallAdd = 0;
      let extExcessRed = 0;
      for (const a of extAdjRows) {
        if (a.adjustment_type === "QUARTER_SHORTFALL_ADDITION") extShortfallAdd = roundMoney(a.total_amount);
        else if (a.adjustment_type === "QUARTER_EXCESS_REDUCTION") extExcessRed = roundMoney(a.total_amount);
      }

      const positiveTargetYear = roundMoney(baseGoal + incomingShortfall + extShortfallAdd);
      const reductionCreditYear = roundMoney(incomingExcessCredit + extExcessRed);
      const effectiveGoal = roundMoney(Math.max(0, positiveTargetYear - reductionCreditYear));
      const variance = roundMoney(achievement - effectiveGoal);

      let achievementPercentage = 0;
      if (effectiveGoal > 0) {
        achievementPercentage = roundMoney((achievement / effectiveGoal) * 100);
      } else if (effectiveGoal === 0 && achievement > 0) {
        achievementPercentage = 100;
      }

      // Year mode closing balance strictly from Month 3 of Q4 (March final unresolved position)
      const closingShortfall = c4.finalClosingShortfall;
      const closingExcess = c4.finalClosingExcess;
      const closingBalanceAmount = closingShortfall > 0 ? closingShortfall : closingExcess;
      const closingBalanceType = closingShortfall > 0 ? "SHORTFALL" : (closingExcess > 0 ? "EXCESS" : "BALANCED");

      const quarterShortfallAddition = roundMoney(monthsSequence.reduce((s, m) => s + (m.quarterShortfallAddition || 0), 0));
      const quarterExcessReduction = roundMoney(monthsSequence.reduce((s, m) => s + (m.quarterExcessReduction || 0), 0));
      const contributionCount = monthsSequence.reduce((s, m) => s + (m.contributionCount || 0), 0);

      let performanceStatus = "ON_TRACK";
      if (effectiveGoal > 0) {
        if (achievement > effectiveGoal) performanceStatus = "AHEAD";
        else if (achievement < effectiveGoal) performanceStatus = "BEHIND";
      } else if (effectiveGoal === 0 && achievement === 0) {
        performanceStatus = "BALANCED";
      } else if (effectiveGoal === 0 && achievement > 0) {
        performanceStatus = "AHEAD";
      }

      const isAllocationStale = [alloc1, alloc2, alloc3, alloc4].some(ad => ad?.categories?.find(x => x.categoryId === c1.categoryId)?.isStale);
      const anyPending = [alloc1, alloc2, alloc3, alloc4].some(ad => ad?.categories?.find(x => x.categoryId === c1.categoryId)?.allocationStatus === "PENDING");
      const allocationStatus = isAllocationStale ? "STALE" : (anyPending ? "PENDING" : "CONFIRMED");

      categories.push({
        categoryId: c1.categoryId,
        categoryCode: c1.categoryCode,
        categoryName: c1.categoryName,
        baseGoal,
        incomingShortfall,
        incomingExcessCredit,
        quarterShortfallAddition,
        quarterExcessReduction,
        effectiveGoal,
        achievement,
        variance,
        achievementPercentage,
        closingShortfall,
        closingExcess,
        closingBalanceType,
        closingBalanceAmount,
        contributionCount,
        allocationStatus,
        isAllocationStale,
        performanceStatus,
        monthsSequence
      });
    }
  }

  const kpis = {
    baseGoal: roundMoney(categories.reduce((s, c) => s + c.baseGoal, 0)),
    effectiveGoal: roundMoney(categories.reduce((s, c) => s + c.effectiveGoal, 0)),
    achievement: roundMoney(categories.reduce((s, c) => s + c.achievement, 0)),
    variance: roundMoney(categories.reduce((s, c) => s + c.variance, 0)),
    achievementPercentage: 0
  };
  if (kpis.effectiveGoal > 0) {
    kpis.achievementPercentage = roundMoney((kpis.achievement / kpis.effectiveGoal) * 100);
  } else if (kpis.effectiveGoal === 0 && kpis.achievement > 0) {
    kpis.achievementPercentage = 100;
  }

  const statusSummary = {
    closingShortfallTotal: roundMoney(categories.reduce((s, c) => s + c.closingShortfall, 0)),
    closingExcessTotal: roundMoney(categories.reduce((s, c) => s + c.closingExcess, 0)),
    categoriesOnTrack: categories.filter(c => c.performanceStatus === "ON_TRACK").length,
    categoriesBehind: categories.filter(c => c.performanceStatus === "BEHIND").length,
    categoriesAhead: categories.filter(c => c.performanceStatus === "AHEAD").length,
    categoriesBalanced: categories.filter(c => c.performanceStatus === "BALANCED").length,
    unmappedClosedQuotationCount: totalUnmappedClosedCount,
    staleAllocationCount: categories.filter(c => c.isAllocationStale).length,
    allocationRequiredCount: categories.filter(c => c.allocationStatus === "PENDING" && c.closingBalanceAmount > 0).length
  };

  const alerts = [];
  if (totalUnmappedClosedCount > 0) {
    alerts.push({
      type: "UNMAPPED_CLOSED_QUOTATIONS",
      severity: "WARNING",
      title: `${totalUnmappedClosedCount} closed quotation${totalUnmappedClosedCount > 1 ? 's are' : ' is'} excluded`,
      message: `Map their sources to include ₹${totalUnmappedClosedRevenue.toLocaleString('en-IN')} in Strategy Achievement.`,
      count: totalUnmappedClosedCount,
      amount: totalUnmappedClosedRevenue,
      action: {
        label: "Review Source Mapping",
        href: "/sales/strategy/source-mapping"
      }
    });
  }

  const staleCats = categories.filter(c => c.isAllocationStale);
  if (staleCats.length > 0) {
    alerts.push({
      type: "STALE_QUARTER_ALLOCATION",
      severity: "WARNING",
      title: `${staleCats.length} Stale Quarter Allocation${staleCats.length > 1 ? 's' : ''}`,
      message: `${staleCats.map(c => `${c.categoryName} allocation is stale (source closing changed)`).join(". ")}. Reallocation required.`,
      count: staleCats.length,
      action: {
        label: "Review Quarter Strategy",
        href: "/sales/strategy/quarter-strategy"
      }
    });
  }

  const isHistoricalFY = !isCurrentFY;
  let isQuarterCompleted = isHistoricalFY;
  if (!isHistoricalFY && mode === "QUARTER" && periodNumber) {
    if (periodNumber === 1 && currentCalendarMonth >= 7) isQuarterCompleted = true;
    else if (periodNumber === 2 && currentCalendarMonth >= 10) isQuarterCompleted = true;
    else if (periodNumber === 3 && (currentCalendarMonth === 1 || currentCalendarMonth === 2 || currentCalendarMonth === 3)) isQuarterCompleted = true;
  } else if (!isHistoricalFY && mode === "MONTH" && periodNumber) {
    const qOfM = getQuarterFromMonth(periodNumber);
    if (qOfM === 1 && currentCalendarMonth >= 7) isQuarterCompleted = true;
    else if (qOfM === 2 && currentCalendarMonth >= 10) isQuarterCompleted = true;
    else if (qOfM === 3 && (currentCalendarMonth === 1 || currentCalendarMonth === 2 || currentCalendarMonth === 3)) isQuarterCompleted = true;
  }

  const pendingCats = categories.filter(c => c.allocationStatus === "PENDING" && c.closingBalanceAmount > 0);
  if (pendingCats.length > 0 && isQuarterCompleted) {
    alerts.push({
      type: "QUARTER_ALLOCATION_REQUIRED",
      severity: "WARNING",
      title: `${pendingCats.length} Quarter Allocation${pendingCats.length > 1 ? 's' : ''} Required`,
      message: `${pendingCats.map(c => `Q${mode === "QUARTER" ? periodNumber : getQuarterFromMonth(periodNumber || 4)} closed with ${c.categoryName} ${c.closingBalanceType.toLowerCase()} ₹${c.closingBalanceAmount.toLocaleString('en-IN')} awaiting allocation`).join(". ")}.`,
      count: pendingCats.length,
      action: {
        label: "Review Quarter Strategy",
        href: "/sales/strategy/quarter-strategy"
      }
    });
  }

  const behindCats = categories.filter(c => c.performanceStatus === "BEHIND");
  if (behindCats.length > 0) {
    const combinedShortfall = roundMoney(behindCats.reduce((s, c) => s + Math.max(0, c.effectiveGoal - c.achievement), 0));
    alerts.push({
      type: "CATEGORY_BEHIND_TARGET",
      severity: "INFO",
      title: `${behindCats.length} Categor${behindCats.length > 1 ? 'ies' : 'y'} Behind Target`,
      message: `Combined target shortfall across ${behindCats.map(c => c.categoryName).join(", ")} is ₹${combinedShortfall.toLocaleString('en-IN')}.`,
      count: behindCats.length,
      amount: combinedShortfall
    });
  }

  return {
    financialYear,
    mode,
    period: {
      monthNumber: mode === "MONTH" ? periodNumber : null,
      monthName: mode === "MONTH" ? getMonthMetadata(periodNumber).monthName : null,
      quarterNumber: mode === "QUARTER" ? periodNumber : (mode === "MONTH" ? getMonthMetadata(periodNumber).quarterNumber : null)
    },
    kpis,
    statusSummary,
    alerts,
    categories
  };
}

async function getCategoryContributions(categoryId, options = {}, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const catId = Number(categoryId);
  if (isNaN(catId)) throw new Error("Invalid categoryId");

  const mode = (options.mode || "MONTH").toUpperCase();
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 20));
  const offset = (page - 1) * limit;

  let whereClause = "WHERE sqc.strategy_category_id = ? AND sqc.is_active = 1 AND EXISTS (SELECT 1 FROM quotation q WHERE q.id = sqc.quotation_id AND q.quotation_status IN ('Approved', 'Won'))";
  const params = [catId];

  if (options.financialYear) {
    whereClause += " AND sqc.financial_year = ?";
    params.push(options.financialYear);
  }

  if (mode === "MONTH" && options.month) {
    whereClause += " AND sqc.month_number = ?";
    params.push(Number(options.month));
  } else if (mode === "QUARTER" && options.quarter) {
    whereClause += " AND sqc.quarter_number = ?";
    params.push(Number(options.quarter));
  }

  const [countRows] = await promiseDb.query(
    `SELECT COUNT(*) AS total, COALESCE(SUM(sqc.contribution_amount), 0) AS achievementTotal
     FROM strategy_quotation_contributions sqc ${whereClause}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);
  const achievementTotal = roundMoney(countRows[0]?.achievementTotal || 0);
  const totalPages = Math.ceil(total / limit) || 1;

  const [sourceRows] = await promiseDb.query(
    `SELECT sqc.source_id, COALESCE(sqc.source_name, 'Unknown') AS sourceName, COALESCE(SUM(sqc.contribution_amount), 0) AS amount, COUNT(*) AS count
     FROM strategy_quotation_contributions sqc ${whereClause}
     GROUP BY sqc.source_id, sqc.source_name
     ORDER BY amount DESC, count DESC`,
    params
  );
  const sourceBreakdown = sourceRows.map(r => ({
    sourceId: r.source_id,
    sourceName: r.sourceName,
    amount: roundMoney(r.amount),
    count: Number(r.count)
  }));

  const [itemRows] = await promiseDb.query(
    `SELECT 
       sqc.id AS contributionId,
       sqc.quotation_id AS quotationId,
       COALESCE(q.quotation_no, CAST(sqc.quotation_id AS CHAR)) AS quotationNo,
       COALESCE(q.customer_name, '') AS customerName,
       COALESCE(q.company_name, '') AS companyName,
       sqc.source_id AS sourceId,
       COALESCE(sqc.source_name, q.source, 'Unknown') AS sourceName,
       sqc.won_date AS wonDate,
       COALESCE(q.quotation_status, 'Won') AS quotationStatus,
       sqc.contribution_amount AS contributionAmount,
       sqc.financial_year AS financialYear,
       sqc.quarter_number AS quarterNumber,
       sqc.month_number AS monthNumber
     FROM strategy_quotation_contributions sqc
     LEFT JOIN quotation q ON q.id = sqc.quotation_id
     ${whereClause}
     ORDER BY sqc.won_date DESC, sqc.quotation_id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const items = itemRows.map(r => ({
    contributionId: r.contributionId,
    quotationId: r.quotationId,
    quotationNo: r.quotationNo,
    customerName: r.customerName,
    companyName: r.companyName,
    sourceId: r.sourceId,
    sourceName: r.sourceName,
    wonDate: typeof r.wonDate === "string" ? r.wonDate.split("T")[0] : (r.wonDate ? r.wonDate.toISOString().split("T")[0] : ""),
    quotationStatus: r.quotationStatus,
    contributionAmount: roundMoney(r.contributionAmount),
    financialYear: r.financialYear,
    quarterNumber: r.quarterNumber,
    monthNumber: r.monthNumber
  }));

  return {
    success: true,
    categoryId: catId,
    achievementTotal,
    contributionCount: total,
    sourceBreakdown,
    pagination: {
      page,
      limit,
      total,
      totalPages
    },
    items
  };
}

async function getStrategyHistory(options = {}, databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;
  const page = Math.max(1, Number(options.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(options.limit) || 25));
  const offset = (page - 1) * limit;

  let whereClause = "WHERE 1=1";
  const params = [];

  if (options.financialYear) {
    whereClause += " AND (a.financial_year = ? OR a.metadata_json LIKE ?)";
    params.push(options.financialYear, `%${options.financialYear}%`);
  }
  if (options.actionType) {
    whereClause += " AND a.action_type = ?";
    params.push(options.actionType);
  }
  if (options.categoryId) {
    whereClause += " AND a.strategy_category_id = ?";
    params.push(Number(options.categoryId));
  }
  if (options.quarter) {
    const q = Number(options.quarter);
    whereClause += " AND (a.quarter_number = ? OR a.metadata_json LIKE ? OR a.metadata_json LIKE ?)";
    params.push(q, `%"targetQuarterNumber":${q}%`, `%"targetQuarterNumber":"${q}"%`);
  }
  if (options.month) {
    whereClause += " AND a.month_number = ?";
    params.push(Number(options.month));
  }
  if (options.performedBy) {
    whereClause += " AND a.performed_by LIKE ?";
    params.push(`%${options.performedBy}%`);
  }
  if (options.dateFrom) {
    whereClause += " AND DATE(a.created_at) >= ?";
    params.push(options.dateFrom);
  }
  if (options.dateTo) {
    whereClause += " AND DATE(a.created_at) <= ?";
    params.push(options.dateTo);
  }

  const [summaryRows] = await promiseDb.query(`
    SELECT 
      COUNT(*) AS totalChanges,
      COALESCE(SUM(CASE WHEN a.action_type LIKE '%BASE_GOAL%' THEN 1 ELSE 0 END), 0) AS baseGoalChanges,
      COALESCE(SUM(CASE WHEN a.action_type = 'QUARTER_ALLOCATION_CREATED' THEN 1 ELSE 0 END), 0) AS quarterAllocations,
      COALESCE(SUM(CASE WHEN a.action_type = 'QUARTER_ALLOCATION_REPLACED' THEN 1 ELSE 0 END), 0) AS reallocations
    FROM strategy_goal_audit_logs a
    ${whereClause}
  `, params);

  const total = Number(summaryRows[0]?.totalChanges || 0);
  const totalPages = Math.ceil(total / limit) || 1;

  const [rows] = await promiseDb.query(`
    SELECT 
      a.id, a.entity_type, a.entity_id, a.financial_year, a.quarter_number, a.month_number,
      a.strategy_category_id, c.name AS category_name, c.code AS category_code, c.icon_svg, c.icon_background, c.icon_color, c.badge_background, c.badge_text_color, a.action_type,
      a.old_value, a.new_value, a.metadata_json, a.reason, a.performed_by, a.created_at
    FROM strategy_goal_audit_logs a
    LEFT JOIN strategy_source_categories c ON c.id = a.strategy_category_id
    ${whereClause}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  let userRows = [];
  try {
    const [uRows] = await promiseDb.query(`SELECT id, name, username, email FROM users`);
    userRows = uRows;
  } catch(e) {}

  const userById = {};
  const userByEmailOrName = {};
  for (const u of userRows) {
    userById[u.id] = u.name || u.username || `User #${u.id}`;
    if (u.email) userByEmailOrName[u.email.toLowerCase()] = u.name || u.username;
    if (u.username) userByEmailOrName[u.username.toLowerCase()] = u.name || u.username;
    if (u.name) userByEmailOrName[u.name.toLowerCase()] = u.name || u.username;
  }

  const items = rows.map(r => {
    let metadata = {};
    if (r.metadata_json) {
      try { metadata = typeof r.metadata_json === "string" ? JSON.parse(r.metadata_json) : r.metadata_json; }
      catch(e) {}
    }
    let oldValue = r.old_value;
    let newValue = r.new_value;
    if (r.entity_type === "QUARTER_ALLOCATION") {
      try { oldValue = typeof r.old_value === "string" ? JSON.parse(r.old_value) : r.old_value; } catch(e) {}
      try { newValue = typeof r.new_value === "string" ? JSON.parse(r.new_value) : r.new_value; } catch(e) {}
    }

    let actionLabel = r.action_type;
    if (r.action_type === "BASE_GOAL_CREATED") actionLabel = "Base Goal Created";
    else if (r.action_type === "BASE_GOAL_UPDATED") actionLabel = "Base Goal Updated";
    else if (r.action_type === "QUARTER_ALLOCATION_CREATED") actionLabel = "Quarter Allocation Created";
    else if (r.action_type === "QUARTER_ALLOCATION_REPLACED") actionLabel = "Quarter Allocation Replaced";
    else if (r.action_type === "MAP_SUB_SOURCE") actionLabel = "Source Mapped";
    else if (r.action_type === "UNMAP_SUB_SOURCE") actionLabel = "Source Unmapped";

    let performedByStr = String(r.performed_by || "System");
    let userId = null;
    let displayName = performedByStr;
    if (performedByStr.startsWith("User ")) {
      const uid = Number(performedByStr.replace("User ", ""));
      if (!isNaN(uid)) {
        userId = uid;
        displayName = userById[uid] || performedByStr;
      }
    } else if (/^\d+$/.test(performedByStr)) {
      const uid = Number(performedByStr);
      userId = uid;
      displayName = userById[uid] || `User #${uid}`;
    } else if (userByEmailOrName[performedByStr.toLowerCase()]) {
      displayName = userByEmailOrName[performedByStr.toLowerCase()];
      const foundU = userRows.find(u => (u.email && u.email.toLowerCase() === performedByStr.toLowerCase()) || (u.username && u.username.toLowerCase() === performedByStr.toLowerCase()));
      if (foundU) userId = foundU.id;
    }

    const mNum = r.month_number ? Number(r.month_number) : null;
    const monthMeta = mNum ? getMonthMetadata(mNum) : null;

    return {
      auditId: r.id,
      actionType: r.action_type,
      actionLabel,
      entityType: r.entity_type,
      entityId: r.entity_id,
      financialYear: r.financial_year || metadata.sourceFinancialYear || options.financialYear || null,
      quarterNumber: r.quarter_number || metadata.sourceQuarter || null,
      monthNumber: mNum,
      monthName: monthMeta ? monthMeta.monthName : null,
      categoryId: r.strategy_category_id,
      categoryName: r.category_name || metadata.categoryName || "Unknown Category",
      categoryCode: r.category_code,
      icon_svg: r.icon_svg,
      icon_background: r.icon_background,
      icon_color: r.icon_color,
      badge_background: r.badge_background,
      badge_text_color: r.badge_text_color,
      oldValue,
      newValue,
      reason: r.reason || metadata.reason || "No reason provided",
      performedBy: {
        userId,
        displayName
      },
      createdAt: typeof r.created_at === "string" ? r.created_at : (r.created_at ? r.created_at.toISOString().replace("T", " ").substring(0, 19) : ""),
      metadata
    };
  });

  return {
    success: true,
    filters: options,
    summaryCounts: {
      totalChanges: Number(summaryRows[0]?.totalChanges || 0),
      baseGoalChanges: Number(summaryRows[0]?.baseGoalChanges || 0),
      quarterAllocations: Number(summaryRows[0]?.quarterAllocations || 0),
      reallocations: Number(summaryRows[0]?.reallocations || 0)
    },
    pagination: {
      page,
      limit,
      total,
      totalPages
    },
    items
  };
}

module.exports = {
  toMoneyNumber,
  roundMoney,
  getFinancialYearFromDate,
  getQuarterFromMonth,
  getFinancialYearMonthOrder,
  getCalendarMonthFromFinancialYearOrder,
  getMonthMetadata,
  getAllMonthsMetadata,
  getAuthoritativeWonDate,
  getMappedCategoryBySource,
  getCategoryAchievement,
  getCategoryQuarterAdjustments,
  calculateCategoryQuarterMonths,
  getMonthStrategy,
  getQuarterSummary,
  getQuarterClosingBalance,
  getNextQuarterContext,
  getQuarterAllocationData,
  allocateQuarterBalance,
  isStrategyClosedStatus,
  removeQuotationContribution,
  syncWonQuotationContribution,
  rebuildHistoricalAchievements,
  validateFinancialYearFormat,
  constructMonthKey,
  getFinancialYearGoalsMatrix,
  getMonthGoals,
  upsertBaseGoal,
  updateBaseGoalById,
  bulkUpsertBaseGoals,
  getStrategyOverview,
  getCategoryContributions,
  getStrategyHistory
};
