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

// GET /api/reports/dispatch
// Filters: fromDate, toDate, partyId, dispatchNo, productId
router.get('/dispatch', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, dispatchNo, productId } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `
      SELECT
        d.Trans_No      AS DispatchID,
        d.Vouchno       AS DispatchNo,
        Convert(varchar(10), d.trans_dt, 103) AS DispatchDate,
        a.ac_name       AS PartyName,
        SUM(ISNULL(dt.Qty, 0)) AS TotalQty
      FROM Rec_Order d
      LEFT JOIN Acmast a ON d.client_code = a.ac_code
      LEFT JOIN Rec_Tran dt ON d.Trans_No = dt.Trans_No
      WHERE d.book_type = 'DC'
    `;

    if (fromDate) {
      request.input('fromDate', sql.DateTime, new Date(fromDate));
      query += ' AND d.trans_dt >= @fromDate';
    }
    if (toDate) {
      request.input('toDate', sql.DateTime, new Date(toDate));
      query += ' AND d.trans_dt <= @toDate';
    }
    if (partyId && partyId !== 'All') {
      request.input('partyId', sql.VarChar, partyId);
      query += ' AND d.client_code = @partyId';
    }
    if (dispatchNo && dispatchNo !== 'All') {
      request.input('dispatchNo', sql.Int, parseInt(dispatchNo));
      query += ' AND d.Trans_No = @dispatchNo';
    }
    if (productId && productId !== 'All') {
      request.input('productId', sql.VarChar, productId);
      query += ' AND EXISTS (SELECT 1 FROM Rec_Tran rt WHERE rt.Trans_No = d.Trans_No AND rt.pr_code = @productId)';
    }

    query += ' GROUP BY d.Trans_No, d.Vouchno, d.trans_dt, a.ac_name ORDER BY d.trans_dt DESC, d.Trans_No DESC';

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Dispatch report error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching dispatch report' });
  }
});

// GET /api/reports/stock
// Filters: fromDate, toDate, partyId, productId, summary
router.get('/stock', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, productId, summary } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `
      SELECT
        p.pr_code       AS ItemCode,
        p.pr_name       AS ProductName,
        SUM(ISNULL(ot.Qty, 0))         AS OrderQty,
        SUM(ISNULL(ot.Rec_Qty, 0))     AS DispatchQty,
        SUM(ISNULL(ot.Qty, 0) - ISNULL(ot.Rec_Qty, 0) - ISNULL(ot.SetoffQty, 0)) AS BalQty
      FROM ord_tran ot
      LEFT JOIN prdmast p ON ot.pr_code = p.pr_code
      LEFT JOIN s_order o ON ot.trans_no = o.trans_no
      LEFT JOIN Acmast a ON o.client_code = a.ac_code
      WHERE 1=1
    `;

    if (fromDate) {
      request.input('fromDate', sql.DateTime, new Date(fromDate));
      query += ' AND o.trans_dt >= @fromDate';
    }
    if (toDate) {
      request.input('toDate', sql.DateTime, new Date(toDate));
      query += ' AND o.trans_dt <= @toDate';
    }
    if (partyId && partyId !== 'All') {
      request.input('partyId', sql.VarChar, partyId);
      query += ' AND o.client_code = @partyId';
    }
    if (productId && productId !== 'All') {
      request.input('productId', sql.VarChar, productId);
      query += ' AND ot.pr_code = @productId';
    }

    query += ' GROUP BY p.pr_code, p.pr_name ORDER BY p.pr_name ASC';

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Stock report error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching stock report' });
  }
});

// GET /api/reports/supplier-orders
// Filters: fromDate, toDate, productGroup, productId
router.get('/supplier-orders', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, productGroup, productId } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `
      SELECT
        o.Trans_No      AS OrderID,
        o.Vouchno       AS OrderNo,
        Convert(varchar(10), o.trans_dt, 103) AS OrderDate,
        a.ac_name       AS PartyName,
        p.pr_code       AS ItemCode,
        p.pr_name       AS ProductName,
        p.Unit          AS ProductGroup,
        SUM(ISNULL(ot.Qty, 0)) AS OrderQty,
        SUM(ISNULL(ot.Rec_Qty, 0)) AS ReceivedQty
      FROM s_order o
      LEFT JOIN Acmast a ON o.client_code = a.ac_code
      LEFT JOIN ord_tran ot ON o.Trans_No = ot.Trans_No
      LEFT JOIN prdmast p ON ot.pr_code = p.pr_code
      WHERE o.book_type = 'SO'
    `;

    if (fromDate) {
      request.input('fromDate', sql.DateTime, new Date(fromDate));
      query += ' AND o.trans_dt >= @fromDate';
    }
    if (toDate) {
      request.input('toDate', sql.DateTime, new Date(toDate));
      query += ' AND o.trans_dt <= @toDate';
    }
    if (productGroup && productGroup !== 'All') {
      request.input('productGroup', sql.VarChar, productGroup);
      query += ' AND p.Unit = @productGroup';
    }
    if (productId && productId !== 'All') {
      request.input('productId', sql.VarChar, productId);
      query += ' AND ot.pr_code = @productId';
    }

    query += ' GROUP BY o.Trans_No, o.Vouchno, o.trans_dt, a.ac_name, p.pr_code, p.pr_name, p.Unit ORDER BY o.trans_dt DESC, o.Trans_No DESC';

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Supplier order report error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching supplier order report' });
  }
});

module.exports = router;

