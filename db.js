const mysql = require("mysql2");

const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT) || 3306,

  waitForConnections: true,
  connectionLimit: 10,
  maxIdle: 10,
  idleTimeout: 60000,
  queueLimit: 100,

  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,

  connectTimeout: 10000,

  dateStrings: true,
});

// Test database connection on startup
db.getConnection((err, connection) => {
  if (err) {
    console.error("❌ Database connection failed:", {
      code: err.code,
      message: err.message,
    });
    return;
  }

  console.log("✅ Connected to MySQL database");
  connection.release();
});

// Database health check every 5 minutes
const keepAliveInterval = setInterval(() => {
  db.query("SELECT 1", (err) => {
    if (err) {
      console.error("❌ Database keep-alive failed:", {
        code: err.code,
        message: err.message,
      });
      return;
    }

    console.log("⏱️ Database keep-alive successful");
  });
}, 5 * 60 * 1000);

keepAliveInterval.unref();

module.exports = db;