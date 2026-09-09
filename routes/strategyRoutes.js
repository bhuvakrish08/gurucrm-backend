const express = require("express");
const db = require("../db");
const authenticateAndAuthorize = require("../middlewares/authMiddleware");
const scs = require("../services/StrategyCalculationService");

const router = express.Router();

// Helper to validate FY parameter (YYYY-YYYY format where endYear = startYear + 1)
function validateFinancialYearFormat(fy) {
  if (!fy || typeof fy !== "string") return false;
  const parts = fy.trim().split("-");
  if (parts.length !== 2) return false;
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  if (isNaN(start) || isNaN(end)) return false;
  return end === start + 1;
}

// GET /api/strategy/categories - Read all Strategy Categories (Active only by default, allow fetching all if explicitly requested)
router.get("/categories", async (req, res) => {
  try {
    const { all } = req.query;
    let query = `SELECT id, name, code, display_order, is_active, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description,
                 (SELECT COUNT(m.id) FROM strategy_source_mappings m JOIN inquiry_lead_source s ON m.source_id = s.id WHERE m.strategy_category_id = strategy_source_categories.id AND m.is_active = 1 AND s.status = 1) AS mapped_sources_count
                 FROM strategy_source_categories`;
    if (all !== "true") {
      query += ` WHERE is_active = 1`;
    }
    query += ` ORDER BY display_order ASC, id ASC`;
    
    const [rows] = await db.promise().query(query);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("Error fetching strategy categories:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/source-categories - For each active Lead Source, return its mapped active Strategy Categories
// Also returns allow_category_selection flag so the Lead form knows whether to show a picker or auto-assign.
router.get("/source-categories", async (req, res) => {
  try {
    // Step 1: Get all active sources with their flag
    const [sources] = await db.promise().query(`
      SELECT id AS source_id, name AS source_name, allow_category_selection
      FROM inquiry_lead_source
      WHERE status = 1
      ORDER BY id ASC
    `);

    // Step 2: Get all active strategy categories
    const [allCategories] = await db.promise().query(`
      SELECT id, name, code, display_order
      FROM strategy_source_categories
      WHERE is_active = 1
      ORDER BY display_order ASC, id ASC
    `);

    // Step 3: Get all source→category mappings for active sources
    const [mappings] = await db.promise().query(`
      SELECT
        s.id   AS source_id,
        c.id   AS category_id,
        c.name AS category_name,
        c.code AS category_code,
        c.display_order,
        m.is_default
      FROM inquiry_lead_source s
      JOIN strategy_source_mappings m ON m.source_id = s.id AND m.is_active = 1
      JOIN strategy_source_categories c ON c.id = m.strategy_category_id AND c.is_active = 1
      WHERE s.status = 1
      ORDER BY s.id ASC, m.is_default DESC, c.display_order ASC, c.id ASC
    `);

    // Step 4: Build grouped map — include ALL sources (even those with 0 mappings)
    const grouped = {};
    for (const src of sources) {
      grouped[src.source_id] = {
        source_id: src.source_id,
        source_name: src.source_name,
        allow_category_selection: src.allow_category_selection === 1,
        categories: []
      };
    }
    for (const row of mappings) {
      if (grouped[row.source_id]) {
        grouped[row.source_id].categories.push({
          id: row.category_id,
          name: row.category_name,
          code: row.category_code,
          display_order: row.display_order,
          is_default: row.is_default
        });
      }
    }

    // Step 5: For sources with allow_category_selection = true but 0 specific mappings, default to all active categories
    for (const srcId of Object.keys(grouped)) {
      if (grouped[srcId].allow_category_selection && grouped[srcId].categories.length === 0) {
        grouped[srcId].categories = allCategories.map(c => ({
          id: c.id,
          name: c.name,
          code: c.code,
          display_order: c.display_order,
          is_default: 0
        }));
      }
    }

    res.json({ success: true, data: Object.values(grouped), allCategories });
  } catch (err) {
    console.error("Error fetching source-categories map:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// POST /api/strategy/categories - Create a new Strategy Category
router.post("/categories", authenticateAndAuthorize("Admin", "Super Admin"), async (req, res) => {
  try {
    const { name, code, display_order = 0, is_active = 1, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description } = req.body;
    if (!name || !code) {
      return res.status(400).json({ success: false, message: "Name and Code are required." });
    }

    const [existing] = await db.promise().query(
      "SELECT id FROM strategy_source_categories WHERE code = ? OR name = ?", 
      [code, name]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "Category with this Name or Code already exists." });
    }

    const [result] = await db.promise().query(
      `INSERT INTO strategy_source_categories (name, code, display_order, is_active, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, code, display_order, is_active, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description]
    );

    res.json({ success: true, message: "Strategy Category created successfully.", data: { id: result.insertId } });
  } catch (err) {
    console.error("Error creating strategy category:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// PUT /api/strategy/categories/:id - Update a Strategy Category
router.put("/categories/:id", authenticateAndAuthorize("Admin", "Super Admin"), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, display_order, is_active, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description } = req.body;
    
    if (!name || !code) {
      return res.status(400).json({ success: false, message: "Name and Code are required." });
    }

    const [existing] = await db.promise().query(
      "SELECT id FROM strategy_source_categories WHERE (code = ? OR name = ?) AND id != ?", 
      [code, name, id]
    );
    if (existing.length > 0) {
      return res.status(400).json({ success: false, message: "Another category with this Name or Code already exists." });
    }

    await db.promise().query(
      `UPDATE strategy_source_categories 
       SET name = ?, code = ?, display_order = ?, is_active = ?, icon_svg = ?, icon_background = ?, icon_color = ?, badge_background = ?, badge_text_color = ?, description = ?
       WHERE id = ?`,
      [name, code, display_order, is_active, icon_svg, icon_background, icon_color, badge_background, badge_text_color, description, id]
    );

    res.json({ success: true, message: "Strategy Category updated successfully." });
  } catch (err) {
    console.error("Error updating strategy category:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/source-mappings - Read all inquiry_lead_source records along with default mapping info and dynamic Lead-level category distribution
router.get("/source-mappings", async (req, res) => {
  try {
    const { search = "", category_id, mapping_status = "all" } = req.query;

    // 1. Fetch all active sources and their source-level fallback mapping
    const [sources] = await db.promise().query(`
      SELECT 
        s.id AS source_id,
        s.name AS source_name,
        s.status AS source_status,
        s.allow_category_selection,
        m.id AS mapping_id,
        m.strategy_category_id,
        c.name AS category_name,
        c.code AS category_code,
        m.updated_at,
        m.updated_by
      FROM inquiry_lead_source s
      LEFT JOIN strategy_source_mappings m ON m.id = (
        SELECT id FROM strategy_source_mappings 
        WHERE source_id = s.id AND is_active = 1 
        ORDER BY is_default DESC, id DESC 
        LIMIT 1
      )
      LEFT JOIN strategy_source_categories c ON c.id = m.strategy_category_id AND c.is_active = 1
      WHERE s.status = 1
      ORDER BY s.name ASC
    `);

    // 2. Fetch Lead-level Strategy Category distribution across all active sources
    const [distRows] = await db.promise().query(`
      SELECT 
        s.id AS source_id,
        l.strategy_category_id,
        ssc.name AS category_name,
        ssc.code AS category_code,
        ssc.badge_background,
        ssc.badge_text_color,
        COUNT(DISTINCT l.lead_id) AS leads_count,
        COUNT(DISTINCT CASE WHEN q.quotation_status IN ('Approved', 'Won') THEN q.id END) AS won_quotations_count,
        COALESCE(SUM(CASE WHEN q.quotation_status IN ('Approved', 'Won') THEN COALESCE(qs.amount_9 + qs.amount_18, q.amount) ELSE 0 END), 0) AS won_revenue
      FROM inquiry_lead_source s
      JOIN lead l ON (l.source COLLATE utf8mb4_general_ci = CAST(s.id AS CHAR) COLLATE utf8mb4_general_ci OR l.source COLLATE utf8mb4_general_ci = s.name COLLATE utf8mb4_general_ci)
      LEFT JOIN strategy_source_categories ssc ON ssc.id = l.strategy_category_id AND ssc.is_active = 1
      LEFT JOIN quotation q ON q.lead_id = l.lead_id
      LEFT JOIN (
        SELECT quotation_id, SUM(amount_9) AS amount_9, SUM(amount_18) AS amount_18
        FROM quotation_splits
        GROUP BY quotation_id
      ) qs ON qs.quotation_id = q.id
      WHERE s.status = 1
      GROUP BY s.id, l.strategy_category_id, ssc.name, ssc.code, ssc.badge_background, ssc.badge_text_color
    `);

    const distMap = {};
    for (const d of distRows) {
      if (!distMap[d.source_id]) distMap[d.source_id] = [];
      distMap[d.source_id].push(d);
    }

    let totalMapped = 0;
    let totalUnmapped = 0;
    let totalUnmappedWonRevenue = 0;

    let processedRows = sources.map(src => {
      const dList = distMap[src.source_id] || [];
      const leadCategories = [];
      let uncategorizedLeads = 0;
      let uncategorizedWonRevenue = 0;
      let totalLeads = 0;
      let totalWonRevenue = 0;

      for (const d of dList) {
        const lCount = Number(d.leads_count || 0);
        const wRev = Number(d.won_revenue || 0);
        totalLeads += lCount;
        totalWonRevenue += wRev;

        if (d.strategy_category_id && d.category_name) {
          leadCategories.push({
            category_id: d.strategy_category_id,
            category_name: d.category_name,
            category_code: d.category_code,
            badge_background: d.badge_background,
            badge_text_color: d.badge_text_color,
            leads_count: lCount,
            won_quotations_count: Number(d.won_quotations_count || 0),
            won_revenue: wRev
          });
        } else {
          uncategorizedLeads += lCount;
          uncategorizedWonRevenue += wRev;
        }
      }

      const hasDefaultMapping = Boolean(src.strategy_category_id && src.category_name);
      // Source is mapped if it has a default fallback category OR all its active leads with revenue have valid lead categories
      const isMapped = hasDefaultMapping || (totalLeads > 0 && uncategorizedWonRevenue === 0 && leadCategories.length > 0);
      const mappingStatus = isMapped ? "Mapped" : "Unmapped";

      if (isMapped) {
        totalMapped++;
      } else {
        totalUnmapped++;
        if (!hasDefaultMapping) {
          totalUnmappedWonRevenue += uncategorizedWonRevenue;
        }
      }

      return {
        ...src,
        mapping_status: mappingStatus,
        is_mapped: isMapped,
        has_default_mapping: hasDefaultMapping,
        lead_categories: leadCategories,
        uncategorized_leads: uncategorizedLeads,
        uncategorized_won_revenue: uncategorizedWonRevenue,
        total_leads: totalLeads,
        total_won_revenue: totalWonRevenue
      };
    });

    // Apply query filters
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      processedRows = processedRows.filter(r => {
        const nameMatch = r.source_name && r.source_name.toLowerCase().includes(q);
        const defaultCatMatch = r.category_name && r.category_name.toLowerCase().includes(q);
        const leadCatMatch = r.lead_categories.some(lc => lc.category_name && lc.category_name.toLowerCase().includes(q));
        return nameMatch || defaultCatMatch || leadCatMatch;
      });
    }

    if (category_id) {
      const cId = Number(category_id);
      processedRows = processedRows.filter(r => {
        const isDefault = r.strategy_category_id === cId;
        const hasLeadCat = r.lead_categories.some(lc => lc.category_id === cId);
        return isDefault || hasLeadCat;
      });
    }

    if (mapping_status === "mapped") {
      processedRows = processedRows.filter(r => r.is_mapped);
    } else if (mapping_status === "unmapped") {
      processedRows = processedRows.filter(r => !r.is_mapped);
    }

    // Sort mapped first, then by source_name
    processedRows.sort((a, b) => {
      if (a.is_mapped !== b.is_mapped) return a.is_mapped ? -1 : 1;
      return String(a.source_name).localeCompare(String(b.source_name));
    });

    res.json({
      success: true,
      data: processedRows,
      summary: {
        total_sources: sources.length,
        mapped_count: totalMapped,
        unmapped_count: totalUnmapped,
        unmapped_won_revenue: totalUnmappedWonRevenue
      }
    });
  } catch (err) {
    console.error("Error fetching source mappings:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// PUT /api/strategy/source-mappings/:sourceId - Map a Sub Source to a Main Category
router.put("/source-mappings/:sourceId", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { sourceId } = req.params;
  const { strategy_category_id } = req.body;
  const updatedBy = req.user?.username || req.user?.name || req.user?.email || "Admin";

  if (!strategy_category_id) {
    return res.status(400).json({ success: false, message: "strategy_category_id is required" });
  }

  try {
    // Verify source exists
    const [sourceRows] = await db.promise().query("SELECT id, name FROM inquiry_lead_source WHERE id = ?", [sourceId]);
    if (sourceRows.length === 0) {
      return res.status(404).json({ success: false, message: "Sub Source not found" });
    }

    // Verify category exists
    const [catRows] = await db.promise().query("SELECT id, name FROM strategy_source_categories WHERE id = ?", [strategy_category_id]);
    if (catRows.length === 0) {
      return res.status(404).json({ success: false, message: "Strategy Category not found" });
    }

    // Upsert mapping
    const upsertSql = `
      INSERT INTO strategy_source_mappings (source_id, strategy_category_id, is_active, created_by, updated_by)
      VALUES (?, ?, 1, ?, ?)
      ON DUPLICATE KEY UPDATE 
        strategy_category_id = VALUES(strategy_category_id),
        is_active = 1,
        updated_by = VALUES(updated_by)
    `;
    await db.promise().query(upsertSql, [sourceId, strategy_category_id, updatedBy, updatedBy]);

    // Record audit log
    await db.promise().query(`
      INSERT INTO strategy_goal_audit_logs (entity_type, entity_id, strategy_category_id, action_type, old_value, new_value, reason, performed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "SOURCE_MAPPING",
      sourceId,
      strategy_category_id,
      "MAP_SUB_SOURCE",
      sourceRows[0].name,
      catRows[0].name,
      `Mapped Sub Source '${sourceRows[0].name}' to Main Category '${catRows[0].name}'`,
      updatedBy
    ]);

    const resyncSummary = {
      affectedClosedQuotations: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      failed: 0
    };
    try {
      const [affectedQRows] = await db.promise().query(
        `SELECT q.id FROM quotation q
         LEFT JOIN lead l ON l.lead_id = q.lead_id
         WHERE q.quotation_status IN ('Approved', 'Won')
           AND (q.source COLLATE utf8mb4_general_ci = ? OR CAST(q.source AS CHAR) COLLATE utf8mb4_general_ci = ? OR l.source COLLATE utf8mb4_general_ci = ? OR CAST(l.source AS CHAR) COLLATE utf8mb4_general_ci = ?)`,
        [sourceRows[0].name, String(sourceId), sourceRows[0].name, String(sourceId)]
      );
      resyncSummary.affectedClosedQuotations = affectedQRows.length;
      for (const aq of affectedQRows) {
        try {
          const syncRes = await scs.syncWonQuotationContribution(aq.id);
          if (syncRes.action === "CREATED" || syncRes.action === "REACTIVATED") resyncSummary.created++;
          else if (syncRes.action === "UPDATED") resyncSummary.updated++;
          else resyncSummary.unchanged++;
        } catch (syncErr) {
          resyncSummary.failed++;
          console.error(`Resync warning for quotation #${aq.id} after mapping change:`, syncErr.message);
        }
      }
    } catch (resyncQueryErr) {
      console.error("Error finding affected quotations for mapping change:", resyncQueryErr.message);
    }

    res.json({
      success: true,
      message: `Successfully mapped '${sourceRows[0].name}' to '${catRows[0].name}'`,
      resyncSummary
    });
  } catch (err) {
    console.error("Error updating source mapping:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// DELETE /api/strategy/source-mappings/:sourceId - Remove a mapping for a Sub Source
router.delete("/source-mappings/:sourceId", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { sourceId } = req.params;
  const updatedBy = req.user?.username || req.user?.name || req.user?.email || "Admin";

  try {
    // 1. Get current mapping details for audit log
    const [mappingRows] = await db.promise().query(`
      SELECT m.strategy_category_id, c.name AS category_name, s.name AS source_name 
      FROM strategy_source_mappings m
      JOIN inquiry_lead_source s ON s.id = m.source_id
      JOIN strategy_source_categories c ON c.id = m.strategy_category_id
      WHERE m.source_id = ? AND m.is_active = 1
    `, [sourceId]);

    if (mappingRows.length === 0) {
      return res.status(404).json({ success: false, message: "No active mapping found for this source" });
    }

    const { category_name, source_name, strategy_category_id } = mappingRows[0];

    // 2. Delete the mapping
    await db.promise().query("DELETE FROM strategy_source_mappings WHERE source_id = ?", [sourceId]);

    // 3. Record audit log
    await db.promise().query(`
      INSERT INTO strategy_goal_audit_logs (entity_type, entity_id, strategy_category_id, action_type, old_value, new_value, reason, performed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      "SOURCE_MAPPING",
      sourceId,
      strategy_category_id,
      "REMOVE_MAPPING",
      category_name,
      "Not Assigned",
      "Mapping Removed",
      updatedBy
    ]);

    // 4. Resync quotations for this source (quotations without explicit category will be excluded)
    try {
      const [affectedQRows] = await db.promise().query(
        `SELECT q.id FROM quotation q
         LEFT JOIN lead l ON l.lead_id = q.lead_id
         WHERE q.quotation_status IN ('Approved', 'Won')
           AND (q.source COLLATE utf8mb4_general_ci = ? OR CAST(q.source AS CHAR) COLLATE utf8mb4_general_ci = ? OR l.source COLLATE utf8mb4_general_ci = ? OR CAST(l.source AS CHAR) COLLATE utf8mb4_general_ci = ?)`,
        [source_name, String(sourceId), source_name, String(sourceId)]
      );
      for (const aq of affectedQRows) {
        await scs.syncWonQuotationContribution(aq.id).catch(() => {});
      }
    } catch (resyncErr) {
      console.error("Error resyncing after delete mapping:", resyncErr.message);
    }

    res.json({
      success: true,
      message: `Successfully removed mapping for '${source_name}'`
    });
  } catch (err) {
    console.error("Error removing source mapping:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/unmapped-sources - Get summary & details of unmapped sources + affected quotation count
router.get("/unmapped-sources", async (req, res) => {
  try {
    const [rows] = await db.promise().query(`
      SELECT 
        s.id AS source_id,
        s.name AS source_name,
        COUNT(q.id) AS affected_quotations_count,
        COALESCE(SUM(COALESCE(qs.amount_9 + qs.amount_18, q.amount)), 0) AS affected_net_revenue
      FROM inquiry_lead_source s
      LEFT JOIN strategy_source_mappings m ON m.source_id = s.id AND m.is_active = 1
      LEFT JOIN strategy_source_categories c ON c.id = m.strategy_category_id AND c.is_active = 1
      JOIN quotation q ON (q.source COLLATE utf8mb4_general_ci = s.name COLLATE utf8mb4_general_ci OR q.source COLLATE utf8mb4_general_ci = CAST(s.id AS CHAR) COLLATE utf8mb4_general_ci)
      LEFT JOIN lead l ON l.lead_id = q.lead_id
      LEFT JOIN (
        SELECT quotation_id, SUM(amount_9) AS amount_9, SUM(amount_18) AS amount_18
        FROM quotation_splits
        GROUP BY quotation_id
      ) qs ON qs.quotation_id = q.id
      LEFT JOIN strategy_quotation_contributions sqc ON sqc.quotation_id = q.id AND sqc.is_active = 1
      WHERE s.status = 1 
        AND q.quotation_status IN ('Approved', 'Won')
        AND sqc.id IS NULL
        AND COALESCE(q.strategy_category_id, l.strategy_category_id) IS NULL
        AND (m.strategy_category_id IS NULL OR c.id IS NULL)
      GROUP BY s.id, s.name
      ORDER BY affected_net_revenue DESC, affected_quotations_count DESC, s.name ASC
    `);

    let totalUnmappedSources = rows.length;
    let totalAffectedQuotations = 0;
    let totalAffectedRevenue = 0;

    rows.forEach(r => {
      totalAffectedQuotations += Number(r.affected_quotations_count || 0);
      totalAffectedRevenue += Number(r.affected_net_revenue || 0);
    });

    res.json({
      success: true,
      summary: {
        total_unmapped_sources: totalUnmappedSources,
        total_affected_quotations: totalAffectedQuotations,
        total_affected_revenue: totalAffectedRevenue
      },
      data: rows
    });
  } catch (err) {
    console.error("Error fetching unmapped sources:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/unmapped-quotations is implemented below with Phase 4 collation-safe logic and financialYear filtering

/* ==========================================================================
 * PHASE 3: CORE STRATEGY CALCULATION APIs
 * ========================================================================== */

// GET /api/strategy/month/:financialYear/:month - Complete Month Strategy Calculation
router.get("/month/:financialYear/:month", async (req, res) => {
  const { financialYear, month } = req.params;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY' (e.g. '2026-2027' where end year is start year + 1)."
    });
  }

  const monthNum = Number(month);
  if (isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
    return res.status(400).json({
      success: false,
      message: "Invalid calendar month number. Expected 1 to 12."
    });
  }

  try {
    const data = await scs.getMonthStrategy(financialYear, monthNum);
    res.json({ success: true, data });
  } catch (err) {
    console.error(`Error calculating Month Strategy for ${financialYear}/${month}:`, err);
    res.status(500).json({ success: false, message: "Calculation Error", error: err.message });
  }
});

// GET /api/strategy/month/:financialYear/:month/carry-allocation - Read Month Carry Allocation Data
router.get("/month/:financialYear/:month/carry-allocation", authenticateAndAuthorize(), async (req, res) => {
  const { financialYear, month } = req.params;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY'."
    });
  }

  const mNum = Number(month);
  if (isNaN(mNum) || mNum < 1 || mNum > 12) {
    return res.status(400).json({
      success: false,
      message: "Invalid calendar month number. Expected 1 to 12."
    });
  }

  try {
    const data = await scs.getMonthCarryAllocationData(financialYear, mNum);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error(`Error fetching Month Carry Allocation Data for ${financialYear}/${month}:`, err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// POST /api/strategy/month/carry-allocate - Transactionally allocate source month balance
router.post("/month/carry-allocate", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { sourceFinancialYear, sourceMonth, reason, allocations } = req.body;
  const performedBy = req.user?.username || req.user?.name || req.user?.email || (req.user?.id ? "User " + req.user.id : "Admin");

  if (!validateFinancialYearFormat(sourceFinancialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid sourceFinancialYear format. Expected 'YYYY-YYYY'."
    });
  }

  const mNum = Number(sourceMonth);
  if (isNaN(mNum) || mNum < 1 || mNum > 12) {
    return res.status(400).json({
      success: false,
      message: "sourceMonth must be between 1 and 12."
    });
  }

  if (!Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({
      success: false,
      message: "allocations array is required and must not be empty."
    });
  }

  try {
    const result = await scs.allocateMonthCarryBalance({
      sourceFinancialYear,
      sourceMonth: mNum,
      reason,
      performedBy,
      allocations
    });
    res.json(result);
  } catch (err) {
    console.error("Error executing Month Carry Allocation:", err);
    res.status(400).json({ success: false, message: err.message || "Allocation validation error" });
  }
});

// DELETE /api/strategy/month/carry-allocate - Remove month carry allocation
router.delete("/month/carry-allocate", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { sourceFinancialYear, sourceMonth, categoryId } = req.body;
  const performedBy = req.user?.username || req.user?.name || req.user?.email || (req.user?.id ? "User " + req.user.id : "Admin");

  if (!validateFinancialYearFormat(sourceFinancialYear)) {
    return res.status(400).json({ success: false, message: "Invalid sourceFinancialYear format." });
  }

  const mNum = Number(sourceMonth);
  const catId = Number(categoryId);
  if (isNaN(mNum) || mNum < 1 || mNum > 12) {
    return res.status(400).json({ success: false, message: "sourceMonth must be between 1 and 12." });
  }
  if (isNaN(catId) || catId < 1) {
    return res.status(400).json({ success: false, message: "categoryId is required." });
  }

  try {
    const result = await scs.removeMonthCarryAllocation(sourceFinancialYear, mNum, catId, performedBy);
    res.json(result);
  } catch (err) {
    console.error("Error removing Month Carry Allocation:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/quarter/:financialYear/:quarter - Complete Quarter Strategy Summary
router.get("/quarter/:financialYear/:quarter", async (req, res) => {
  const { financialYear, quarter } = req.params;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY' (e.g. '2026-2027' where end year is start year + 1)."
    });
  }

  const qNum = Number(quarter);
  if (isNaN(qNum) || qNum < 1 || qNum > 4) {
    return res.status(400).json({
      success: false,
      message: "Invalid quarter number. Expected 1, 2, 3, or 4."
    });
  }

  try {
    const data = await scs.getQuarterSummary(financialYear, qNum);
    res.json({ success: true, data });
  } catch (err) {
    console.error(`Error calculating Quarter Summary for ${financialYear}/Q${quarter}:`, err);
    res.status(500).json({ success: false, message: "Calculation Error", error: err.message });
  }
});

// GET /api/strategy/quarter/:financialYear/:quarter/closing-balance - Final Quarter Closing Balance
router.get("/quarter/:financialYear/:quarter/closing-balance", async (req, res) => {
  const { financialYear, quarter } = req.params;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY' (e.g. '2026-2027' where end year is start year + 1)."
    });
  }

  const qNum = Number(quarter);
  if (isNaN(qNum) || qNum < 1 || qNum > 4) {
    return res.status(400).json({
      success: false,
      message: "Invalid quarter number. Expected 1, 2, 3, or 4."
    });
  }

  try {
    const data = await scs.getQuarterClosingBalance(financialYear, qNum);
    res.json({ success: true, data });
  } catch (err) {
    console.error(`Error calculating Quarter Closing Balance for ${financialYear}/Q${quarter}:`, err);
    res.status(500).json({ success: false, message: "Calculation Error", error: err.message });
  }
});

// OPTIONAL DEVELOPMENT/VERIFICATION ENDPOINT: Authoritative Won Date Check
router.get("/debug/won-date/:quotationId", authenticateAndAuthorize("Admin", "Super Admin"), async (req, res) => {
  const { quotationId } = req.params;
  try {
    const data = await scs.getAuthoritativeWonDate(Number(quotationId));
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: "Resolver Error", error: err.message });
  }
});

// POST /api/strategy/rebuild-achievements - Rebuild historical Strategy contribution achievements for a financial year
router.post("/rebuild-achievements", authenticateAndAuthorize("Admin", "Super Admin"), async (req, res) => {
  const { financialYear } = req.body;
  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY' (e.g. '2026-2027')."
    });
  }

  try {
    const summary = await scs.rebuildHistoricalAchievements(financialYear);
    res.json({ success: true, financialYear, summary });
  } catch (err) {
    console.error(`Error rebuilding historical achievements for ${financialYear}:`, err);
    res.status(500).json({ success: false, message: "Rebuild Error", error: err.message });
  }
});

// GET /api/strategy/unmapped-quotations - Identify Approved/Won quotations whose source is unmapped or missing
router.get("/unmapped-quotations", authenticateAndAuthorize(), async (req, res) => {
  try {
    const { financialYear } = req.query;
    const [qRows] = await db.promise().query(
      `SELECT q.id AS quotationId, q.quotation_no AS quotationNo, q.customer_name AS customerName,
              q.company_name AS companyName, q.quotation_status AS quotationStatus, q.source AS sourceName,
              q.strategy_category_id AS quotationStrategyCategoryId,
              COALESCE(qs.amount_9 + qs.amount_18, q.amount) AS netRevenueAmount,
              l.source AS leadSource,
              l.strategy_category_id AS leadStrategyCategoryId
       FROM quotation q
       LEFT JOIN (
         SELECT quotation_id, SUM(amount_9) AS amount_9, SUM(amount_18) AS amount_18
         FROM quotation_splits
         GROUP BY quotation_id
       ) qs ON qs.quotation_id = q.id
       LEFT JOIN lead l ON l.lead_id = q.lead_id
       WHERE q.quotation_status IN ('Approved', 'Won')
       ORDER BY q.id DESC`
    );

    const unmappedList = [];
    for (const q of qRows) {
      const sourceInput = (q.sourceName && String(q.sourceName).trim() !== "") ? q.sourceName : (q.leadSource || "");
      const effectiveCatId = q.quotationStrategyCategoryId || q.leadStrategyCategoryId;
      let isMapped = false;
      let exclusionReason = "SOURCE_NOT_MAPPED";
      let resolvedSourceName = String(sourceInput);
      let resolvedSourceId = null;

      if (effectiveCatId) {
        const [catRows] = await db.promise().query(
          "SELECT id, name FROM strategy_source_categories WHERE id = ? AND is_active = 1",
          [effectiveCatId]
        );
        if (catRows.length > 0) {
          isMapped = true;
        }
      }

      if (!isMapped) {
        const mappingInfo = await scs.getMappedCategoryBySource(sourceInput);
        if (mappingInfo.mapped) {
          isMapped = true;
        } else {
          exclusionReason = mappingInfo.reason;
          resolvedSourceName = mappingInfo.sourceName || String(sourceInput);
          resolvedSourceId = mappingInfo.sourceId || null;
        }
      }

      if (!isMapped) {
        try {
          const wonDateInfo = await scs.getAuthoritativeWonDate(q.quotationId);
          const fy = scs.getFinancialYearFromDate(wonDateInfo.wonDate);
          if (!financialYear || fy === financialYear) {
            unmappedList.push({
              quotationId: q.quotationId,
              quotationNo: q.quotationNo,
              customerName: q.customerName,
              companyName: q.companyName,
              quotationStatus: q.quotationStatus,
              sourceName: mappingInfo.sourceName || String(sourceInput),
              sourceId: mappingInfo.sourceId || null,
              exclusionReason: mappingInfo.reason,
              authoritativeWonDate: wonDateInfo.wonDate,
              financialYear: fy,
              netRevenueAmount: scs.roundMoney(q.netRevenueAmount)
            });
          }
        } catch (dateErr) {
          // If won date cannot be resolved, still list if not filtered by fy
          if (!financialYear) {
            unmappedList.push({
              quotationId: q.quotationId,
              quotationNo: q.quotationNo,
              customerName: q.customerName,
              companyName: q.companyName,
              quotationStatus: q.quotationStatus,
              sourceName: mappingInfo.sourceName || String(sourceInput),
              sourceId: mappingInfo.sourceId || null,
              exclusionReason: mappingInfo.reason,
              authoritativeWonDate: null,
              financialYear: null,
              netRevenueAmount: scs.roundMoney(q.netRevenueAmount)
            });
          }
        }
      }
    }

    res.json({ success: true, total: unmappedList.length, data: unmappedList });
  } catch (err) {
    console.error("Error fetching unmapped quotations:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

/* ==========================================================================
 * PHASE 5: MONTHLY BASE GOAL MANAGEMENT CRUD APIs
 * ========================================================================== */

// POST /api/strategy/goals/bulk - Bulk save multiple category/month Base Goals in a single transaction
router.post("/goals/bulk", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { financialYear, reason, goals } = req.body;
  const performedBy = req.user?.username || req.user?.name || req.user?.email || (req.user?.id ? "User " + req.user.id : "Admin");

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY' (e.g. '2026-2027' where end year is start year + 1)."
    });
  }

  if (!Array.isArray(goals) || goals.length === 0) {
    return res.status(400).json({
      success: false,
      message: "goals array is required and cannot be empty."
    });
  }

  try {
    const result = await scs.bulkUpsertBaseGoals({
      financialYear,
      reason,
      performedBy,
      goals
    });
    res.json({
      success: true,
      message: `Bulk Base Goals saved. ${result.created} created, ${result.updated} updated, ${result.unchanged} unchanged.`,
      summary: result
    });
  } catch (err) {
    console.error("Error saving bulk Base Goals:", err);
    res.status(400).json({ success: false, message: err.message || "Bulk save validation error" });
  }
});

// POST /api/strategy/goals - Create or update single category/month Base Goal
router.post("/goals", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { financialYear, monthNumber, strategyCategoryId, baseGoalAmount, reason } = req.body;
  const performedBy = req.user?.username || req.user?.name || req.user?.email || (req.user?.id ? "User " + req.user.id : "Admin");

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY' (e.g. '2026-2027')."
    });
  }

  const mNum = Number(monthNumber);
  if (isNaN(mNum) || mNum < 1 || mNum > 12) {
    return res.status(400).json({
      success: false,
      message: "monthNumber must be between 1 and 12."
    });
  }

  const catId = Number(strategyCategoryId);
  if (isNaN(catId) || catId <= 0) {
    return res.status(400).json({
      success: false,
      message: "strategyCategoryId is required."
    });
  }

  if (baseGoalAmount === null || baseGoalAmount === undefined || baseGoalAmount === "") {
    return res.status(400).json({
      success: false,
      message: "baseGoalAmount is required."
    });
  }

  try {
    const result = await scs.upsertBaseGoal({
      financialYear,
      monthNumber: mNum,
      strategyCategoryId: catId,
      baseGoalAmount,
      reason,
      performedBy
    });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error("Error saving Base Goal:", err);
    res.status(400).json({ success: false, message: err.message || "Failed to save Base Goal" });
  }
});

// PUT /api/strategy/goals/:id - Update single Base Goal amount by ID
router.put("/goals/:id", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { id } = req.params;
  const { baseGoalAmount, reason } = req.body;
  const performedBy = req.user?.username || req.user?.name || req.user?.email || (req.user?.id ? "User " + req.user.id : "Admin");

  if (baseGoalAmount === null || baseGoalAmount === undefined || baseGoalAmount === "") {
    return res.status(400).json({
      success: false,
      message: "baseGoalAmount is required."
    });
  }

  try {
    const result = await scs.updateBaseGoalById(id, {
      baseGoalAmount,
      reason,
      performedBy
    });
    if (!result.found) {
      return res.status(404).json({ success: false, message: "Base Goal record not found." });
    }
    res.json({ success: true, data: result });
  } catch (err) {
    console.error(`Error updating Base Goal #${id}:`, err);
    res.status(400).json({ success: false, message: err.message || "Failed to update Base Goal" });
  }
});

// GET /api/strategy/goals/:financialYear/:month - Read 5 category Base Goals for a specific FY and month
router.get("/goals/:financialYear/:month", authenticateAndAuthorize(), async (req, res) => {
  const { financialYear, month } = req.params;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY'."
    });
  }

  const mNum = Number(month);
  if (isNaN(mNum) || mNum < 1 || mNum > 12) {
    return res.status(400).json({
      success: false,
      message: "month must be between 1 and 12."
    });
  }

  try {
    const data = await scs.getMonthGoals(financialYear, mNum);
    res.json({ success: true, data });
  } catch (err) {
    console.error(`Error fetching month Base Goals for ${financialYear}/${month}:`, err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/goals/:financialYear - Read complete 5 x 12 Base Goal matrix for a Financial Year
router.get("/goals/:financialYear", authenticateAndAuthorize(), async (req, res) => {
  const { financialYear } = req.params;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY' (e.g. '2026-2027')."
    });
  }

  try {
    const data = await scs.getFinancialYearGoalsMatrix(financialYear);
    res.json({ success: true, data });
  } catch (err) {
    console.error(`Error fetching FY Base Goals matrix for ${financialYear}:`, err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/quarter/:financialYear/:quarter/allocation - Read Quarter Closing Balance, Next Quarter Context & confirmed allocations
router.get("/quarter/:financialYear/:quarter/allocation", authenticateAndAuthorize(), async (req, res) => {
  const { financialYear, quarter } = req.params;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY'."
    });
  }

  const qNum = Number(quarter);
  if (isNaN(qNum) || qNum < 1 || qNum > 4) {
    return res.status(400).json({
      success: false,
      message: "Invalid quarter number. Expected 1, 2, 3, or 4."
    });
  }

  try {
    const data = await scs.getQuarterAllocationData(financialYear, qNum);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error(`Error fetching Quarter Allocation Data for ${financialYear}/Q${quarter}:`, err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// POST /api/strategy/quarter/allocate - Transactionally allocate source quarter closing balance across next quarter
router.post("/quarter/allocate", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { sourceFinancialYear, sourceQuarterNumber, reason, allocations } = req.body;
  const performedBy = req.user?.username || req.user?.name || req.user?.email || (req.user?.id ? "User " + req.user.id : "Admin");

  if (!validateFinancialYearFormat(sourceFinancialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid sourceFinancialYear format. Expected 'YYYY-YYYY'."
    });
  }

  const qNum = Number(sourceQuarterNumber);
  if (isNaN(qNum) || qNum < 1 || qNum > 4) {
    return res.status(400).json({
      success: false,
      message: "sourceQuarterNumber must be between 1 and 4."
    });
  }

  if (!Array.isArray(allocations) || allocations.length === 0) {
    return res.status(400).json({
      success: false,
      message: "allocations array is required and must not be empty."
    });
  }

  try {
    const result = await scs.allocateQuarterBalance({
      sourceFinancialYear,
      sourceQuarterNumber: qNum,
      reason,
      performedBy,
      allocations
    });
    res.json(result);
  } catch (err) {
    console.error("Error executing Quarter Allocation:", err);
    res.status(400).json({ success: false, message: err.message || "Allocation validation error" });
  }
});

// POST /api/strategy/quarter/reset - Transactionally reset all confirmed allocations for a quarter
router.post("/quarter/reset", authenticateAndAuthorize("Admin", "Super Admin", "Leads Management", "Sales"), async (req, res) => {
  const { sourceFinancialYear, sourceQuarterNumber, reason } = req.body;
  const performedBy = req.user?.username || req.user?.name || req.user?.email || (req.user?.id ? "User " + req.user.id : "Admin");

  if (!validateFinancialYearFormat(sourceFinancialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid sourceFinancialYear format. Expected 'YYYY-YYYY'."
    });
  }

  const qNum = Number(sourceQuarterNumber);
  if (isNaN(qNum) || qNum < 1 || qNum > 4) {
    return res.status(400).json({
      success: false,
      message: "sourceQuarterNumber must be between 1 and 4."
    });
  }

  try {
    const result = await scs.resetQuarterAllocations({
      sourceFinancialYear,
      sourceQuarterNumber: qNum,
      reason,
      performedBy
    });
    res.json(result);
  } catch (err) {
    console.error("Error resetting Quarter Allocations:", err);
    res.status(400).json({ success: false, message: err.message || "Reset error" });
  }
});

/* ==========================================================================
 * PHASE 8: STRATEGY OVERVIEW & CONTRIBUTION DRILL-DOWN APIs
 * ========================================================================== */

// GET /api/strategy/overview/:financialYear - Centralized Strategy Overview Dashboard data
router.get("/overview/:financialYear", authenticateAndAuthorize(), async (req, res) => {
  const { financialYear } = req.params;
  const { mode, period } = req.query;

  if (!validateFinancialYearFormat(financialYear)) {
    return res.status(400).json({
      success: false,
      message: "Invalid Financial Year format. Expected 'YYYY-YYYY'."
    });
  }

  try {
    const data = await scs.getStrategyOverview(financialYear, { mode, period });
    res.json({ success: true, data });
  } catch (err) {
    console.error(`Error fetching Strategy Overview for ${financialYear}:`, err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

// GET /api/strategy/category/:categoryId/contributions - Paginated won/approved quotations contributing to achievement
router.get("/category/:categoryId/contributions", authenticateAndAuthorize(), async (req, res) => {
  const { categoryId } = req.params;
  const { financialYear, mode, month, quarter, page, limit } = req.query;

  const catId = Number(categoryId);
  if (isNaN(catId) || catId < 1) {
    return res.status(400).json({ success: false, message: "Invalid categoryId." });
  }

  try {
    const data = await scs.getCategoryContributions(catId, {
      financialYear,
      mode,
      month,
      quarter,
      page,
      limit
    });
    res.json(data);
  } catch (err) {
    console.error(`Error fetching contributions for category ${categoryId}:`, err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

/* ==========================================================================
 * PHASE 9: CENTRALIZED STRATEGY AUDIT TRAIL HISTORY API
 * ========================================================================== */

// GET /api/strategy/history - Complete unified audit trail of Base Goal & Quarter Allocation changes
router.get("/history", authenticateAndAuthorize(), async (req, res) => {
  const {
    financialYear,
    actionType,
    categoryId,
    quarter,
    month,
    performedBy,
    dateFrom,
    dateTo,
    page,
    limit
  } = req.query;

  try {
    const data = await scs.getStrategyHistory({
      financialYear,
      actionType,
      categoryId,
      quarter,
      month,
      performedBy,
      dateFrom,
      dateTo,
      page,
      limit
    });
    res.json(data);
  } catch (err) {
    console.error("Error fetching Strategy History:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

module.exports = router;
/* ==========================================================================
 * PHASE 9: CENTRALIZED STRATEGY AUDIT TRAIL HISTORY API
 * ========================================================================== */

// GET /api/strategy/history - Complete unified audit trail of Base Goal & Quarter Allocation changes
router.get("/history", authenticateAndAuthorize(), async (req, res) => {
  const {
    financialYear,
    actionType,
    categoryId,
    quarter,
    month,
    performedBy,
    dateFrom,
    dateTo,
    page,
    limit
  } = req.query;

  try {
    const data = await scs.getStrategyHistory({
      financialYear,
      actionType,
      categoryId,
      quarter,
      month,
      performedBy,
      dateFrom,
      dateTo,
      page,
      limit
    });
    res.json(data);
  } catch (err) {
    console.error("Error fetching Strategy History:", err);
    res.status(500).json({ success: false, message: "Database error", error: err.message });
  }
});

module.exports = router;
