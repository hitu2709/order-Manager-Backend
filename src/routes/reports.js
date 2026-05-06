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
// Calls PendingOrder stored procedure — same params as the original Crystal Reports code
router.get('/pending-orders', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, orderNo, productId, pendingOnly } = req.query;
    const pool = getPool();
    const request = pool.request();

    // Match exactly: @Acc_Code, @Prod_code, @VouchNo, @Frm_Date, @Till_Date, @Ispending
    request.input('Acc_Code',  sql.VarChar(20), (partyId   && partyId   !== 'All') ? partyId   : '');
    request.input('Prod_code', sql.VarChar(50), (productId && productId !== 'All') ? productId : '');
    request.input('VouchNo',   sql.VarChar(20), (orderNo   && orderNo   !== 'All') ? String(orderNo) : '');
    request.input('Frm_Date',  sql.DateTime,    fromDate ? new Date(fromDate) : new Date());
    request.input('Till_Date', sql.DateTime,    toDate   ? new Date(toDate)   : new Date());
    request.input('Ispending', sql.Bit,         (pendingOnly === 'true' || pendingOnly === true) ? 1 : 0);

    const result = await request.execute('PendingOrder');
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Pending orders report error:', err);
    // Fallback to raw SQL if stored proc doesn't exist yet
    try {
      const { fromDate, toDate, partyId, orderNo, productId, pendingOnly } = req.query;
      const pool = getPool();
      const req2 = pool.request();
      let query = `
        SELECT
          o.trans_no        AS OrderNo,
          Convert(varchar(10), o.trans_dt, 103) AS OrderDate,
          a.ac_name         AS PartyName,
          SUM(ISNULL(ot.Qty,0))                                                      AS OrderQty,
          SUM(ISNULL(ot.Rec_Qty,0))                                                  AS DispatchQty,
          SUM(ISNULL(ot.Qty,0) - ISNULL(ot.Rec_Qty,0) - ISNULL(ot.SetoffQty,0))    AS BalQty,
          o.VouchNo         AS VouchNo
        FROM s_order o
        LEFT JOIN Acmast a  ON o.client_code = a.ac_code
        LEFT JOIN ord_tran ot ON o.trans_no = ot.trans_no
        WHERE o.book_type = 'SO'
      `;
      if (partyId && partyId !== 'All') {
        req2.input('partyId', sql.VarChar, partyId);
        query += ' AND o.client_code = @partyId';
      }
      if (orderNo && orderNo !== 'All') {
        req2.input('orderNo', sql.Int, parseInt(orderNo));
        query += ' AND o.trans_no = @orderNo';
      }
      if (productId && productId !== 'All') {
        req2.input('productId', sql.VarChar, productId);
        query += ' AND EXISTS (SELECT 1 FROM ord_tran x WHERE x.trans_no = o.trans_no AND x.pr_code = @productId)';
      }
      if (pendingOnly === 'true' || pendingOnly === true) {
        query += ' AND (SELECT SUM(ISNULL(Qty,0) - ISNULL(Rec_Qty,0) - ISNULL(SetoffQty,0)) FROM ord_tran WHERE trans_no = o.trans_no) > 0';
      }
      query += ' GROUP BY o.trans_no, o.trans_dt, a.ac_name, o.VouchNo ORDER BY o.trans_no DESC';
      const result2 = await req2.query(query);
      return res.status(200).json({ success: true, data: result2.recordset });
    } catch (err2) {
      console.error('Pending orders fallback error:', err2);
      return res.status(500).json({ success: false, message: 'Error fetching pending orders report' });
    }
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
// GET /api/reports/dispatch-numbers
// Returns dispatch Trans_Nos filtered by partyId and/or productId (for cascading dropdowns)
router.get('/dispatch-numbers', authMiddleware, async (req, res) => {
  try {
    const { partyId, productId } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `SELECT TOP 200 d.Trans_No, d.Vouchno FROM Rec_Order d WHERE d.book_type = 'DC'`;
    if (partyId && partyId !== 'All') {
      request.input('partyId', sql.VarChar, partyId);
      query += ' AND d.client_code = @partyId';
    }
    if (productId && productId !== 'All') {
      request.input('productId', sql.VarChar, productId);
      query += ' AND EXISTS (SELECT 1 FROM Rec_Tran rt WHERE rt.Trans_No = d.Trans_No AND rt.pr_code = @productId)';
    }
    query += ' ORDER BY d.Trans_No DESC';

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Dispatch numbers error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching dispatch numbers' });
  }
});

// GET /api/reports/dispatch-products
// Returns products that appear in dispatches, filtered by partyId and/or dispatchNo
router.get('/dispatch-products', authMiddleware, async (req, res) => {
  try {
    const { partyId, dispatchNo } = req.query;
    const pool = getPool();
    const request = pool.request();

    let subQuery = `SELECT DISTINCT rt.pr_code FROM Rec_Tran rt JOIN Rec_Order d ON rt.Trans_No = d.Trans_No WHERE d.book_type = 'DC'`;
    if (partyId && partyId !== 'All') {
      request.input('partyId', sql.VarChar, partyId);
      subQuery += ' AND d.client_code = @partyId';
    }
    if (dispatchNo && dispatchNo !== 'All') {
      request.input('dispatchNo', sql.Int, parseInt(dispatchNo));
      subQuery += ' AND rt.Trans_No = @dispatchNo';
    }

    const result = await request.query(`
      SELECT prod_code as ItemCode, prod_name as ProductName, 0 as Stock, unit1 as Unit
      FROM Product WHERE prod_code IN (${subQuery})
      ORDER BY prod_code
    `);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Dispatch products error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching dispatch products' });
  }
});

module.exports = router;
