const sql = require('mssql');
require('dotenv').config({ path: '../.env' });

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_DATABASE,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
};

async function testConnection() {
  try {
    console.log('Testing connection with config:', { ...config, password: '****' });
    let pool = await sql.connect(config);
    console.log('✅ Connected to SQL Server');

    console.log('Checking dbo.Users table schema...');
    const schemaResult = await pool.request().query(`
      SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'Users' AND TABLE_SCHEMA = 'dbo'
    `);
    console.log('Columns in dbo.Users:');
    console.table(schemaResult.recordset);

    console.log('Checking for any users in dbo.Users...');
    const userCount = await pool.request().query('SELECT COUNT(*) as count FROM dbo.Users');
    console.log('User count:', userCount.recordset[0].count);

    if (userCount.recordset[0].count > 0) {
        const firstUser = await pool.request().query('SELECT TOP 1 * FROM dbo.Users');
        console.log('First user (sanitized):');
        const user = firstUser.recordset[0];
        console.log({ ...user, Password: '***' });
    }

    await sql.close();
  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.originalError) console.error('Original Error:', err.originalError.message);
    process.exit(1);
  }
}

testConnection();
