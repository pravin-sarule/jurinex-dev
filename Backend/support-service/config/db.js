const { Pool } = require("pg");
require("dotenv").config();

const connectionString =
  process.env.SUPPORT_DATABASE_URL ||
  process.env.SUPPORT_DB_URL ||
  process.env.DATABASE_URL;

if (!connectionString) {
  console.warn("[SupportService] SUPPORT_DATABASE_URL is not configured.");
}

const pool = new Pool(
  connectionString
    ? {
        connectionString,
      }
    : undefined
);

pool.on("error", (err) => {
  console.error("[SupportService] Unexpected database error:", err);
});

module.exports = pool;
