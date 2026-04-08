const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getPool, sql } = require('../config/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { userId, password } = req.body;

  // Validate input
  if (!userId || !password) {
    return res.status(400).json({
      success: false,
      message: 'User ID and password are required',
    });
  }

  try {
    const pool = getPool();

    // Query user from database
    // Using the schema provided by the user: dbo.Users (ID, UserName, Password)
    const result = await pool
      .request()
      .input('userId', sql.VarChar, userId)
      .query(`
        SELECT [ID], [UserName], [Password]
        FROM dbo.Users
        WHERE CAST([ID] AS VARCHAR) = @userId OR [UserName] = @userId
      `);

    if (result.recordset.length === 0) {
      return res.status(401).json({
        success: false,
        message: 'Invalid User ID/Name or Password',
      });
    }

    const user = result.recordset[0];

    // Compare password
    // The database stores passwords as Base64 encoded strings
    const inputPasswordBase64 = Buffer.from(password).toString('base64');
    const isValidPassword = inputPasswordBase64 === user.Password;

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: 'Invalid User ID/Name or Password',
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user.ID,
        userName: user.UserName,
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' } // Token valid for 8 hours
    );

    return res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        userId: user.ID,
        userName: user.UserName,
      },
    });
  } catch (err) {
    console.error('Login error full detail:', err);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message,
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

module.exports = router;
