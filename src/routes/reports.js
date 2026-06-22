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
// Direct SQL — returns one row per product per order with known column names
router.get('/pending-orders', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, orderNo, productId, pendingOnly } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `
      SELECT
        o.trans_no        AS OrderNo,
        o.VouchNo         AS VouchNo,
        CONVERT(varchar(10), o.trans_dt, 103) AS OrderDate,
        a.ac_name         AS PartyName,
        p.prod_code       AS ItemCode,
        p.prod_name       AS ProductName,
        ISNULL(ot.Qty, 0)                                                       AS OrderQty,
        ISNULL(ot.Rec_Qty, 0)                                                   AS DispatchQty,
        ISNULL(ot.Qty, 0) - ISNULL(ot.Rec_Qty, 0) - ISNULL(ot.SetoffQty, 0)   AS BalQty
      FROM s_order o
      LEFT JOIN Acmast a    ON o.client_code = a.ac_code
      LEFT JOIN ord_tran ot ON o.trans_no    = ot.trans_no
      LEFT JOIN Product p   ON ot.pr_code    = p.prod_code
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
    if (partyId && partyId !== 'All') {
      // Support comma-separated list for multi-select (e.g. "C001,C002,C003")
      const partyIds = String(partyId).split(',').map(id => id.trim()).filter(Boolean);
      if (partyIds.length === 1) {
        request.input('partyId', sql.VarChar, partyIds[0]);
        query += ' AND o.client_code = @partyId';
      } else if (partyIds.length > 1) {
        const paramNames = partyIds.map((id, idx) => {
          request.input(`partyId${idx}`, sql.VarChar, id);
          return `@partyId${idx}`;
        });
        query += ` AND o.client_code IN (${paramNames.join(',')})`;
      }
    }
    if (orderNo && orderNo !== 'All') {
      // Support comma-separated list for multi-select (e.g. "100001,100002,100003")
      const orderNos = String(orderNo).split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      if (orderNos.length === 1) {
        request.input('orderNo', sql.Int, orderNos[0]);
        query += ' AND o.trans_no = @orderNo';
      } else if (orderNos.length > 1) {
        // Safely inject validated integers directly (no string injection risk)
        query += ` AND o.trans_no IN (${orderNos.join(',')})`;
      }
    }
    if (productId && productId !== 'All') {
      request.input('productId', sql.VarChar, productId);
      query += ' AND ot.pr_code = @productId';
    }
    if (pendingOnly === 'true' || pendingOnly === true) {
      query += ' AND (ISNULL(ot.Qty, 0) - ISNULL(ot.Rec_Qty, 0) - ISNULL(ot.SetoffQty, 0)) > 0';
    }
    query += ' ORDER BY o.trans_no DESC, p.prod_code';

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
// Filters: fromDate, toDate, partyId (comma-separated), productId (comma-separated), summary
// summary=true  → StockReport_Summary equivalent (GROUP BY product)
// summary=false → StockReport_Detail equivalent (row per order-item)
router.get('/stock', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, productId, summary } = req.query;
    const isSummary = summary === 'true' || summary === true;
    const pool = getPool();
    const request = pool.request();

    let query;

    if (isSummary) {
      // ── Summary mode: one row per product (StockReport_Summary) ───────────
      query = `
        SELECT
          p.pr_code   AS ItemCode,
          p.pr_name   AS ProductName,
          SUM(ISNULL(ot.Qty, 0))                                                       AS OrderQty,
          SUM(ISNULL(ot.Rec_Qty, 0))                                                   AS DispatchQty,
          SUM(ISNULL(ot.Qty, 0) - ISNULL(ot.Rec_Qty, 0) - ISNULL(ot.SetoffQty, 0))  AS BalQty
        FROM ord_tran ot
        LEFT JOIN prdmast p ON ot.pr_code    = p.pr_code
        LEFT JOIN s_order o ON ot.trans_no   = o.trans_no
        LEFT JOIN Acmast  a ON o.client_code = a.ac_code
        WHERE 1=1
      `;
    } else {
      // ── Detail mode: one row per order-item (StockReport_Detail) ─────────
      query = `
        SELECT
          o.trans_no  AS TransNo,
          o.Vouchno   AS VouchNo,
          Convert(varchar(10), o.trans_dt, 103) AS OrderDate,
          a.ac_name   AS PartyName,
          p.pr_code   AS ItemCode,
          p.pr_name   AS ProductName,
          ISNULL(ot.Qty, 0)                                                             AS OrderQty,
          ISNULL(ot.Rec_Qty, 0)                                                         AS DispatchQty,
          (ISNULL(ot.Qty, 0) - ISNULL(ot.Rec_Qty, 0) - ISNULL(ot.SetoffQty, 0))       AS BalQty
        FROM ord_tran ot
        LEFT JOIN prdmast p ON ot.pr_code    = p.pr_code
        LEFT JOIN s_order o ON ot.trans_no   = o.trans_no
        LEFT JOIN Acmast  a ON o.client_code = a.ac_code
        WHERE o.book_type = 'SO'
      `;
    }

    // ── Common filters ────────────────────────────────────────────────────────
    if (fromDate) {
      request.input('fromDate', sql.DateTime, new Date(fromDate));
      query += ' AND o.trans_dt >= @fromDate';
    }
    if (toDate) {
      request.input('toDate', sql.DateTime, new Date(toDate));
      query += ' AND o.trans_dt <= @toDate';
    }
    if (partyId && partyId !== 'All') {
      const partyIds = String(partyId).split(',').map(id => id.trim()).filter(Boolean);
      if (partyIds.length === 1) {
        request.input('partyId', sql.VarChar, partyIds[0]);
        query += ' AND o.client_code = @partyId';
      } else {
        const params = partyIds.map((id, idx) => { request.input(`partyId${idx}`, sql.VarChar, id); return `@partyId${idx}`; });
        query += ` AND o.client_code IN (${params.join(',')})`;
      }
    }
    if (productId && productId !== 'All') {
      const productIds = String(productId).split(',').map(id => id.trim()).filter(Boolean);
      if (productIds.length === 1) {
        request.input('productId', sql.VarChar, productIds[0]);
        query += ' AND ot.pr_code = @productId';
      } else {
        const params = productIds.map((id, idx) => { request.input(`productId${idx}`, sql.VarChar, id); return `@productId${idx}`; });
        query += ` AND ot.pr_code IN (${params.join(',')})`;
      }
    }

    // ── ORDER BY ──────────────────────────────────────────────────────────────
    if (isSummary) {
      query += ' GROUP BY p.pr_code, p.pr_name ORDER BY p.pr_name ASC';
    } else {
      query += ' ORDER BY o.trans_dt DESC, o.Vouchno DESC, p.pr_name ASC';
    }

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
