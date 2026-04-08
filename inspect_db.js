const { connectDB, getPool, sql } = require('./src/config/db');
require('dotenv').config();

async function inspectPassword() {
  try {
    const pool = await connectDB();
    const result = await pool.request()
      .input('userName', sql.VarChar, 'Inv')
      .query('SELECT [ID], [UserName], [Password] FROM dbo.Users WHERE [UserName] = @userName OR CAST([ID] AS VARCHAR) = @userName');
    
    if (result.recordset.length > 0) {
      const user = result.recordset[0];
      console.log('User ID:', user.ID);
      console.log('UserName:', user.UserName);
      console.log('Password Format:', user.Password);
      console.log('Password Length:', user.Password.length);
      
      if (user.Password.startsWith('$2')) {
        console.log('Detected: Likely BCrypt hash');
      } else if (user.Password.length === 32) {
        console.log('Detected: Likely MD5 hash');
      } else if (user.Password.length === 40) {
        console.log('Detected: Likely SHA-1 hash');
      } else if (user.Password.length === 64) {
        console.log('Detected: Likely SHA-256 hash');
      } else {
        console.log('Detected: Unknown format or plain text');
      }
    } else {
      console.log('No users found in dbo.Users table.');
    }
    process.exit(0);
  } catch (err) {
    console.error('Inspection failed:', err.message);
    process.exit(1);
  }
}

inspectPassword();
