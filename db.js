const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

// Connect first time
function handleDisconnect() {
  db.connect((err) => {
    if (err) {
      console.error("Database connection failed:", err);
      setTimeout(handleDisconnect, 5000); // retry after 5 sec
    } else {
      console.log("✅ Connected to MySQL database");
    }
  });
}

handleDisconnect();

// 🔄 Keep database alive every 5 minutes
setInterval(() => {
  db.query("SELECT 1", (err) => {
    if (err) {
      console.error("Keep alive query failed:", err);
    } else {
      console.log("⏱️ Database keep-alive ping sent");
    }
  });
}, 5 * 60 * 1000); // 5 minutes

module.exports = db;