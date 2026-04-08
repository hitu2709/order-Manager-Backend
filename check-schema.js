const sql = require('mssql');
require('dotenv').config();

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: { encrypt: true, trustServerCertificate: true },
};

async function check() {
  try {
    const pool = await sql.connect(config);
    
    // Get just the first ~15 cols of s_order (the ones we insert)
    console.log('\n--- s_order first columns ---');
    const r = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH
      FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_NAME = 'S_order' AND ORDINAL_POSITION <= 20
      ORDER BY ORDINAL_POSITION
    `);
    console.table(r.recordset);

    await sql.close();
  } catch (err) {
    console.error('Error:', err.message);
  }
}
check();
