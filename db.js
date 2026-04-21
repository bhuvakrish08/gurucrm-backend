const mysql = require("mysql2");

const pool = mysql.createPool({
  host: process.env.DB_HOST,   // example: localhost OR mysql.hostinger.com
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  connectTimeout: 10000
});

// check connection
pool.getConnection((err, connection) => {

  if (err) {

    console.error("❌ MySQL connection failed:", err);

  } else {

    console.log("✅ MySQL Pool Connected");

    connection.release();

  }

});

module.exports = pool;
