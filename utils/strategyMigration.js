const db = require("../db");

async function runMigration(databasePool = db) {
  const promiseDb = databasePool.promise ? databasePool.promise() : databasePool;

  const createCategoriesTable = `
    CREATE TABLE IF NOT EXISTS strategy_source_categories (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      code VARCHAR(100) NOT NULL UNIQUE,
      display_order INT(11) NOT NULL DEFAULT 0,
      is_active INT(11) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createMappingsTable = `
    CREATE TABLE IF NOT EXISTS strategy_source_mappings (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source_id INT(11) NOT NULL UNIQUE,
      strategy_category_id INT(11) NOT NULL,
      is_active INT(11) NOT NULL DEFAULT 1,
      created_by VARCHAR(255) NULL,
      updated_by VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_strategy_category (strategy_category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createGoalsTable = `
    CREATE TABLE IF NOT EXISTS strategy_monthly_goals (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      financial_year VARCHAR(50) NOT NULL,
      quarter_number INT(11) NOT NULL,
      month_number INT(11) NOT NULL,
      month_key VARCHAR(20) NOT NULL,
      strategy_category_id INT(11) NOT NULL,
      base_goal_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      created_by VARCHAR(255) NULL,
      updated_by VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY unique_monthly_goal (financial_year, month_number, strategy_category_id),
      INDEX idx_goal_lookup (financial_year, quarter_number, month_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createContributionsTable = `
    CREATE TABLE IF NOT EXISTS strategy_quotation_contributions (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      quotation_id INT(11) NOT NULL UNIQUE,
      source_id INT(11) NULL,
      source_name VARCHAR(255) NULL,
      strategy_category_id INT(11) NOT NULL,
      won_date DATE NOT NULL,
      financial_year VARCHAR(50) NOT NULL,
      quarter_number INT(11) NOT NULL,
      month_number INT(11) NOT NULL,
      contribution_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      is_active INT(11) NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_category_period (strategy_category_id, financial_year, quarter_number, month_number, is_active),
      INDEX idx_source (source_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createAdjustmentsTable = `
    CREATE TABLE IF NOT EXISTS strategy_adjustments (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      financial_year VARCHAR(50) NOT NULL,
      source_financial_year VARCHAR(50) NULL,
      destination_financial_year VARCHAR(50) NULL,
      source_quarter INT(11) NULL,
      destination_quarter INT(11) NULL,
      source_month INT(11) NULL,
      destination_month INT(11) NULL,
      strategy_category_id INT(11) NOT NULL,
      adjustment_scope VARCHAR(100) NULL,
      adjustment_type VARCHAR(100) NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      reason TEXT NULL,
      reference_type VARCHAR(100) NULL,
      reference_id INT(11) NULL,
      created_by VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_adj_period (financial_year, destination_quarter, destination_month, strategy_category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createAllocationsTable = `
    CREATE TABLE IF NOT EXISTS strategy_quarter_allocations (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      source_financial_year VARCHAR(50) NOT NULL,
      source_quarter INT(11) NOT NULL,
      destination_financial_year VARCHAR(50) NOT NULL,
      destination_quarter INT(11) NOT NULL,
      destination_month INT(11) NOT NULL,
      strategy_category_id INT(11) NOT NULL,
      allocation_type VARCHAR(100) NOT NULL,
      amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
      reason TEXT NULL,
      created_by VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_alloc_dest (destination_financial_year, destination_quarter, destination_month, strategy_category_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  const createAuditLogsTable = `
    CREATE TABLE IF NOT EXISTS strategy_goal_audit_logs (
      id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY,
      entity_type VARCHAR(100) NOT NULL,
      entity_id INT(11) NULL,
      financial_year VARCHAR(50) NULL,
      quarter_number INT(11) NULL,
      month_number INT(11) NULL,
      strategy_category_id INT(11) NULL,
      action_type VARCHAR(255) NOT NULL,
      old_value LONGTEXT NULL,
      new_value LONGTEXT NULL,
      metadata_json LONGTEXT NULL,
      reason TEXT NULL,
      performed_by VARCHAR(255) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_audit_fy (financial_year, quarter_number, month_number)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;

  try {
    console.log("Running Strategy Module migrations...");
    await promiseDb.query(createCategoriesTable);
    await promiseDb.query(createMappingsTable);
    await promiseDb.query(createGoalsTable);
    await promiseDb.query(createContributionsTable);
    await promiseDb.query(createAdjustmentsTable);
    await promiseDb.query(createAllocationsTable);
    await promiseDb.query(createAuditLogsTable);

    // Additive schema updates for Phase 6/7 Allocation and Adjustment write model
    const safeAlter = async (query) => {
      try {
        await promiseDb.query(query);
      } catch (e) {
        if (e.code !== "ER_DUP_FIELDNAME" && e.errno !== 1060 && !String(e.message).includes("Duplicate column")) {
          throw e;
        }
      }
    };

    await safeAlter("ALTER TABLE strategy_quarter_allocations ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'CONFIRMED'");
    await safeAlter("ALTER TABLE strategy_quarter_allocations ADD COLUMN source_closing_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00");
    await safeAlter("ALTER TABLE strategy_adjustments ADD COLUMN is_active INT(11) NOT NULL DEFAULT 1");

    console.log("✅ Strategy Module migrations & seeding completed successfully.");
    return { success: true };
  } catch (err) {
    console.error("❌ Error running Strategy Module migrations:", err);
    throw err;
  }
}

module.exports = { runMigration };
