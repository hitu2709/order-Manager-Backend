const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { getPool, sql } = require('../config/db');

// All report routes are protected - require JWT token

// GET /api/reports/report1
router.get('/report1', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '85%' });
});

// GET /api/reports/report2
router.get('/report2', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '150' });
});

// GET /api/reports/report3
router.get('/report3', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '45' });
});

// GET /api/reports/report4
router.get('/report4', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '20' });
});

// GET /api/reports/pending-orders
// Filters: fromDate, toDate, partyId, orderNo, productId, pendingOnly
router.get('/pending-orders', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, orderNo, productId, pendingOnly } = req.query;
    const pool = getPool();
    const request = pool.request();
    
    let query = `
      SELECT 
        o.trans_no as OrderID, 
        a.ac_name as CustomerName, 
        o.trans_dt as OrderDate, 
        o.amount as TotalAmount,
        ISNULL(q.TotalQty, 0) as TotalQty,
        'Pending' as Status
      FROM s_order o
      LEFT JOIN Acmast a ON o.client_code = a.ac_code
      LEFT JOIN (SELECT trans_no, SUM(qty) as TotalQty FROM ord_tran GROUP BY trans_no) q ON o.trans_no = q.trans_no
      WHERE 1=1
    `;

    if (fromDate) {
      request.input('fromDate', sql.DateTime, new Date(fromDate));
      query += " AND o.trans_dt >= @fromDate";
    }
    if (toDate) {
      request.input('toDate', sql.DateTime, new Date(toDate));
      query += " AND o.trans_dt <= @toDate";
    }
    if (partyId && partyId !== 'All') {
      request.input('partyId', sql.VarChar, partyId);
      query += " AND o.client_code = @partyId";
    }
    if (orderNo && orderNo !== 'All') {
      request.input('orderNo', sql.Int, parseInt(orderNo));
      query += " AND o.trans_no = @orderNo";
    }
    if (productId && productId !== 'All') {
      // For product filter, we need to check if the product exists in ord_tran for that order
      request.input('productId', sql.VarChar, productId);
      query += " AND EXISTS (SELECT 1 FROM ord_tran ot WHERE ot.trans_no = o.trans_no AND ot.pr_code = @productId)";
    }
    
    // In this simplified schema, let's assume 'Pending' depends on a flag or missing dispatch
    // For now, we'll just return the filtered orders.
    
    query += " ORDER BY o.trans_dt DESC, o.trans_no DESC";
    
    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Pending orders report error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching pending orders report' });
  }
});

module.exports = router;
