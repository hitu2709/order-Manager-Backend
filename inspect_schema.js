const { connectDB, getPool, sql } = require('./src/config/db');
require('dotenv').config();

async function inspectSchema() {
  try {
    const pool = await connectDB();
    
    console.log('\n--- Inspecting S_order Table Columns ---');
    const sOrderRes = await pool.request().query("SELECT TOP 1 * FROM s_order");
    if (sOrderRes.recordset.length > 0) {
      console.log('Available Columns in s_order:', Object.keys(sOrderRes.recordset[0]).join(', '));
    } else {
      console.log('s_order table is empty.');
    }

    console.log('\n--- Inspecting ord_tran Table Columns ---');
    const ordTranRes = await pool.request().query("SELECT TOP 1 * FROM ord_tran");
    if (ordTranRes.recordset.length > 0) {
      console.log('Available Columns in ord_tran:', Object.keys(ordTranRes.recordset[0]).join(', '));
    } else {
      console.log('ord_tran table is empty.');
    }

    process.exit(0);
  } catch (err) {
    console.error('Inspection failed:', err.message);
    process.exit(1);
  }
}

inspectSchema();
