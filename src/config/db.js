const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true,           // Use true for Azure, false for local SQL Server
    trustServerCertificate: true, // Set true for local/dev SQL Server
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

async function connectDB() {
  try {
    pool = await sql.connect(config);
    console.log('✅ Connected to Microsoft SQL Server successfully');
    return pool;
  } catch (err) {
    console.error('❌ SQL Server connection failed:', err.message);
    process.exit(1);
  }
}

function getPool() {
  if (!pool) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return pool;
}

module.exports = { connectDB, getPool, sql };
