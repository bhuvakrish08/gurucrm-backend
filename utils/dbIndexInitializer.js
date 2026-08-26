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

  // Ensure mobile_no column exists in quotation table
  try {
    const [cols] = await db
      .promise()
      .query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotation' AND COLUMN_NAME = 'mobile_no'`
      );
    if (cols.length === 0) {
      await db
        .promise()
        .query(`ALTER TABLE \`quotation\` ADD COLUMN \`mobile_no\` VARCHAR(20) DEFAULT NULL AFTER \`reference\``);
      console.log(`⚡ Added column mobile_no to quotation table`);
    }
    // Populate missing mobile_no from lead table
    await db
      .promise()
      .query(
        `UPDATE quotation q JOIN lead l ON q.lead_id = l.lead_id SET q.mobile_no = l.mobile_no WHERE (q.mobile_no IS NULL OR q.mobile_no = '') AND l.mobile_no IS NOT NULL AND l.mobile_no != ''`
      );
  } catch (err) {
    console.warn(`[Column Migration Warning] mobile_no:`, err.message);
  }
}

module.exports = { initializeIndexes };
