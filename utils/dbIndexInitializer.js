const db = require("../db");

/**
 * Automatically ensures database indexes exist on primary filter and foreign key columns.
 * Drastically reduces MySQL query execution time from seconds to milliseconds.
 */
async function initializeIndexes() {
  const indexDefinitions = [
    // lead table indexes
    { table: "lead", name: "idx_lead_status", columns: "status" },
    { table: "lead", name: "idx_lead_created_at", columns: "created_at" },
    { table: "lead", name: "idx_lead_source", columns: "source" },

    // lead_follow_up table indexes
    { table: "lead_follow_up", name: "idx_lfu_lead_id", columns: "lead_id" },
    { table: "lead_follow_up", name: "idx_lfu_fu_date", columns: "follow_up_date" },
    { table: "lead_follow_up", name: "idx_lfu_created_at", columns: "created_at" },

    // quotation table indexes
    { table: "quotation", name: "idx_quotation_lead_id", columns: "lead_id" },
    { table: "quotation", name: "idx_quotation_status", columns: "quotation_status" },
    { table: "quotation", name: "idx_quotation_created_at", columns: "created_at" },

    // project table indexes
    { table: "project", name: "idx_project_quotation_id", columns: "quotation_id" },
    { table: "project", name: "idx_project_created_at", columns: "created_at" },

    // customer_data table indexes
    { table: "customer_data", name: "idx_customer_company", columns: "company_name" },
    { table: "customer_data", name: "idx_customer_name", columns: "customer_name" },
    { table: "customer_data", name: "idx_customer_mobile", columns: "mobile" },
    { table: "customer_data", name: "idx_customer_email", columns: "email" },

    // contacts table indexes
    { table: "contacts", name: "idx_contacts_customer_id", columns: "customer_id" },
    { table: "contacts", name: "idx_contacts_company", columns: "company_name" },

    // tasks table indexes
    { table: "tasks", name: "idx_tasks_status", columns: "status" },
    { table: "tasks", name: "idx_tasks_assignee", columns: "assignee" },
    { table: "tasks", name: "idx_tasks_created_at", columns: "created_at" },
  ];

  for (const idx of indexDefinitions) {
    try {
      // Check if index already exists
      const [existing] = await db
        .promise()
        .query(
          `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
          [idx.table, idx.name]
        );

      if (existing.length === 0) {
        const formattedCols = idx.columns.split(',').map(c => `\`${c.trim()}\``).join(', ');
        await db
          .promise()
          .query(`CREATE INDEX \`${idx.name}\` ON \`${idx.table}\` (${formattedCols})`);
        console.log(`⚡ Created database index: ${idx.name} on \`${idx.table}\`(${idx.columns})`);
      }
    } catch (err) {
      // Ignore if table doesn't exist yet or index creation fails
      console.warn(`[Index Optimization Warning] ${idx.name}:`, err.message);
    }
  }

  // Ensure required columns exist in quotation table
  const quotationRequiredColumns = [
    { name: "mobile_no", type: "VARCHAR(20) DEFAULT NULL" },
    { name: "lost_reason", type: "TEXT DEFAULT NULL" },
    { name: "activity_type", type: "VARCHAR(100) DEFAULT NULL" },
    { name: "proforma_percentage", type: "DECIMAL(5,2) DEFAULT NULL" },
    { name: "assignee_log", type: "TEXT DEFAULT NULL" },
    { name: "sales_assigned_at", type: "DATETIME DEFAULT NULL" },
    { name: "estimation_assigned_at", type: "DATETIME DEFAULT NULL" },
  ];

  for (const col of quotationRequiredColumns) {
    try {
      const [cols] = await db
        .promise()
        .query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotation' AND COLUMN_NAME = ?`,
          [col.name]
        );
      if (cols.length === 0) {
        await db
          .promise()
          .query(`ALTER TABLE \`quotation\` ADD COLUMN \`${col.name}\` ${col.type}`);
        console.log(`⚡ Added column ${col.name} to quotation table`);
      }
    } catch (err) {
      console.warn(`[Column Migration Warning] quotation.${col.name}:`, err.message);
    }
  }

  // Populate missing mobile_no from lead table if available
  try {
    await db
      .promise()
      .query(
        `UPDATE quotation q JOIN lead l ON q.lead_id = l.lead_id SET q.mobile_no = l.mobile_no WHERE (q.mobile_no IS NULL OR q.mobile_no = '') AND l.mobile_no IS NOT NULL AND l.mobile_no != ''`
      );
  } catch (err) {
    console.warn(`[Column Migration Warning] mobile_no populate:`, err.message);
  }

  // Ensure location, architecture, category, priority, description, lost_reason, won_at, followup_status columns exist in lead table
  const leadRequiredColumns = [
    { name: "location", type: "VARCHAR(255) DEFAULT NULL" },
    { name: "architecture", type: "VARCHAR(255) DEFAULT NULL" },
    { name: "category", type: "VARCHAR(255) DEFAULT NULL" },
    { name: "priority", type: "VARCHAR(100) DEFAULT NULL" },
    { name: "description", type: "TEXT DEFAULT NULL" },
    { name: "lost_reason", type: "TEXT DEFAULT NULL" },
    { name: "won_at", type: "DATETIME DEFAULT NULL" },
    { name: "followup_status", type: "VARCHAR(20) DEFAULT NULL" },
  ];

  for (const col of leadRequiredColumns) {
    try {
      const [cols] = await db
        .promise()
        .query(
          `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lead' AND COLUMN_NAME = ?`,
          [col.name]
        );
      if (cols.length === 0) {
        await db
          .promise()
          .query(`ALTER TABLE \`lead\` ADD COLUMN \`${col.name}\` ${col.type}`);
        console.log(`⚡ Added column ${col.name} to lead table`);
      }
    } catch (err) {
      console.warn(`[Column Migration Warning] lead.${col.name}:`, err.message);
    }
  }
}

module.exports = { initializeIndexes };
