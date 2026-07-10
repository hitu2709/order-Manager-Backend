const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { getPool, sql } = require('../config/db');

// All report routes are protected - require JWT token

router.get('/report1', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '85%' });
});
router.get('/report2', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '150' });
});
router.get('/report3', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '45' });
});
router.get('/report4', authMiddleware, async (req, res) => {
  return res.status(200).json({ success: true, value: '20' });
});

// GET /api/reports/pending-orders
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

    if (fromDate) { request.input('fromDate', sql.DateTime, new Date(fromDate)); query += ' AND o.trans_dt >= @fromDate'; }
    if (toDate)   { request.input('toDate',   sql.DateTime, new Date(toDate));   query += ' AND o.trans_dt <= @toDate'; }
    if (partyId && partyId !== 'All') {
      const ids = String(partyId).split(',').map(id => id.trim()).filter(Boolean);
      if (ids.length === 1) { request.input('partyId', sql.VarChar, ids[0]); query += ' AND o.client_code = @partyId'; }
      else { const p = ids.map((id, i) => { request.input(`partyId${i}`, sql.VarChar, id); return `@partyId${i}`; }); query += ` AND o.client_code IN (${p.join(',')})`; }
    }
    if (orderNo && orderNo !== 'All') {
      const nos = String(orderNo).split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
      if (nos.length === 1) { request.input('orderNo', sql.Int, nos[0]); query += ' AND o.trans_no = @orderNo'; }
      else { query += ` AND o.trans_no IN (${nos.join(',')})`; }
    }
    if (productId && productId !== 'All') { request.input('productId', sql.VarChar, productId); query += ' AND ot.pr_code = @productId'; }
    if (pendingOnly === 'true') { query += ' AND (ISNULL(ot.Qty, 0) - ISNULL(ot.Rec_Qty, 0) - ISNULL(ot.SetoffQty, 0)) > 0'; }
    query += ' ORDER BY o.trans_no DESC, p.prod_code';

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Pending orders report error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching pending orders report' });
  }
});

// GET /api/reports/dispatch
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

    if (fromDate)  { request.input('fromDate',   sql.DateTime, new Date(fromDate)); query += ' AND d.trans_dt >= @fromDate'; }
    if (toDate)    { request.input('toDate',     sql.DateTime, new Date(toDate));   query += ' AND d.trans_dt <= @toDate'; }
    if (partyId    && partyId    !== 'All') { request.input('partyId',    sql.VarChar, partyId);              query += ' AND d.client_code = @partyId'; }
    if (dispatchNo && dispatchNo !== 'All') { request.input('dispatchNo', sql.Int, parseInt(dispatchNo));     query += ' AND d.Trans_No = @dispatchNo'; }
    if (productId  && productId  !== 'All') { request.input('productId',  sql.VarChar, productId);            query += ' AND EXISTS (SELECT 1 FROM Rec_Tran rt WHERE rt.Trans_No = d.Trans_No AND rt.pr_code = @productId)'; }

    query += ' GROUP BY d.Trans_No, d.Vouchno, d.trans_dt, a.ac_name ORDER BY d.trans_dt DESC, d.Trans_No DESC';

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Dispatch report error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching dispatch report' });
  }
});

// GET /api/reports/stock
// Calls the SAME stored procedures as the web app:
//   summary=true  -> StockReport_Summary
//   summary=false -> StockReport_Detail
// Supports: All Parties x All Products (single SP call, 60s timeout)
//           Filtered parties/products (per-party loop with party name lookup)
router.get('/stock', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, productId, summary } = req.query;
    const isSummary = summary === 'true' || summary === true;
    const pool = getPool();

    const frm  = fromDate ? new Date(fromDate) : new Date();
    const till = toDate   ? new Date(toDate)   : new Date();

    const partyIds   = (partyId   && partyId   !== 'All')
      ? String(partyId).split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const productIds = (productId && productId !== 'All')
      ? String(productId).split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const procName   = isSummary ? 'StockReport_Summary' : 'StockReport_Detail';
    const isAllAll   = partyIds.length === 0 && productIds.length === 0;
    const allRows    = [];

    if (isAllAll) {
      // ── All Parties x All Products: single SP call with empty params ──────────
      // SP returns AccountName in each row so party grouping works automatically.
      const request = pool.request();
      request.requestTimeout = 60000; // 60 s — large dataset
      request.input('Acc_Code',  sql.VarChar,  '');
      request.input('Prod_code', sql.VarChar,  '');
      request.input('Frm_Date',  sql.DateTime, frm);
      request.input('Till_Date', sql.DateTime, till);
      const result = await request.execute(procName);
      if (result.recordset) allRows.push(...result.recordset);

    } else {
      // ── Filtered: iterate over selected parties x products ────────────────────
      const pList    = partyIds.length   > 0 ? partyIds   : [''];
      const prodList = productIds.length > 0 ? productIds : [''];

      for (const pId of pList) {
        // Look up party display name (SP filtered by @Acc_Code may not echo it back)
        let resolvedPartyName = '';
        if (pId) {
          try {
            const pReq = pool.request();
            pReq.input('_acCode', sql.VarChar, pId);
            const pRes = await pReq.query('SELECT ac_name FROM Acmast WHERE ac_code = @_acCode');
            if (pRes.recordset.length > 0) resolvedPartyName = pRes.recordset[0].ac_name || '';
          } catch (_) { /* non-fatal */ }
        }

        for (const prodId of prodList) {
          const request = pool.request();
          request.requestTimeout = 30000; // 30 s per call
          request.input('Acc_Code',  sql.VarChar,  pId    || '');
          request.input('Prod_code', sql.VarChar,  prodId || '');
          request.input('Frm_Date',  sql.DateTime, frm);
          request.input('Till_Date', sql.DateTime, till);
          const result = await request.execute(procName);
          if (result.recordset && result.recordset.length > 0) {
            result.recordset.forEach(row => { row._resolvedPartyName = resolvedPartyName; });
            allRows.push(...result.recordset);
          }
        }
      }
    }

    // Log actual SP column names once for debugging
    if (allRows.length > 0) {
      console.log('[StockReport] SP columns:', Object.keys(allRows[0]));
    } else {
      console.log('[StockReport] SP returned 0 rows');
    }

    // ── Fuzzy normaliser: case-insensitive column matching ────────────────────
    const normalize = (row) => {
      const keys = Object.keys(row);

      const find = (...patterns) => {
        // 1st pass: exact case-insensitive match
        for (const pat of patterns) {
          const k = keys.find(k => k.toLowerCase() === pat.toLowerCase());
          if (k !== undefined && row[k] !== null && row[k] !== undefined) return row[k];
        }
        // 2nd pass: substring match
        for (const pat of patterns) {
          const k = keys.find(k => k.toLowerCase().includes(pat.toLowerCase()));
          if (k !== undefined && row[k] !== null && row[k] !== undefined) return row[k];
        }
        return undefined;
      };

      return {
        // Party: prefer injected lookup name, then SP's AccountName column
        PartyName:
          row._resolvedPartyName ||
          find('AccountName','PartyName','ac_name','Party_Name','partyname','AccName','CustName','ClientName') || '',

        ItemCode:
          find('ProductCode','ItemCode','pr_code','prod_code','Item_Code','itemcode','ProdCode') || '',

        ProductName:
          find('ProductName','pr_name','prod_name','Prod_Name','productname','ProdName','Item_Name','ItemName') || '',

        Opening:
          parseFloat(find(
            'OpeningQty','Opening','Opn_Qty','op_qty','OpnQty','OpnBal','OBal','Opening_Qty','OpQty','OpenQty'
          ) ?? 0) || 0,

        Inward:
          parseFloat(find(
            'InwardQty','Inward','In_Qty','in_qty','InQty','InWard','Inw_Qty','RecQty','Rec_Qty','Purchase'
          ) ?? 0) || 0,

        Outward:
          parseFloat(find(
            'OutwardQty','Outward','Out_Qty','out_qty','OutQty','OutWard','DelQty','Sale','Dispatch'
          ) ?? 0) || 0,

        Balance:
          parseFloat(find(
            'BalanceQty','Balance','Bal_Qty','bal_qty','Cls_Qty','BalQty','ClosBal','CBal','Closing_Qty','ClsQty','Closing'
          ) ?? 0) || 0,

        VouchNo:   find('VouchNo','Vouchno','vouch_no','VoNo','DocNo') || '',
        OrderDate: find('OrderDate','Trans_dt','trans_dt','Date','TrnDate','DocDate') || '',
      };
    };

    const data = allRows.map(normalize);
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error('Stock report error:', err);
    return res.status(500).json({
      success: false,
      message: 'Stock report error: ' + (err.message || err),
    });
  }
});

// GET /api/reports/supplier-orders
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

    if (fromDate)     { request.input('fromDate',     sql.DateTime, new Date(fromDate)); query += ' AND o.trans_dt >= @fromDate'; }
    if (toDate)       { request.input('toDate',       sql.DateTime, new Date(toDate));   query += ' AND o.trans_dt <= @toDate'; }
    if (productGroup && productGroup !== 'All') { request.input('productGroup', sql.VarChar, productGroup); query += ' AND p.Unit = @productGroup'; }
    if (productId    && productId    !== 'All') { request.input('productId',    sql.VarChar, productId);    query += ' AND ot.pr_code = @productId'; }

    query += ' GROUP BY o.Trans_No, o.Vouchno, o.trans_dt, a.ac_name, p.pr_code, p.pr_name, p.Unit ORDER BY o.trans_dt DESC, o.Trans_No DESC';

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Supplier order report error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching supplier order report' });
  }
});

// GET /api/reports/dispatch-parties
// Returns distinct parties who have dispatch records (Rec_Order DC)
router.get('/dispatch-parties', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT DISTINCT a.ac_code AS PartyID, a.ac_name AS PartyName
      FROM Rec_Order d
      JOIN Acmast a ON d.client_code = a.ac_code
      WHERE d.book_type = 'DC'
      ORDER BY a.ac_name
    `);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Dispatch parties error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching dispatch parties' });
  }
});

// GET /api/reports/dispatch-numbers
router.get('/dispatch-numbers', authMiddleware, async (req, res) => {
  try {
    const { partyId, productId } = req.query;
    const pool = getPool();
    const request = pool.request();

    let query = `SELECT TOP 200 d.Trans_No, d.Vouchno FROM Rec_Order d WHERE d.book_type = 'DC'`;
    if (partyId   && partyId   !== 'All') { request.input('partyId',   sql.VarChar, partyId);   query += ' AND d.client_code = @partyId'; }
    if (productId && productId !== 'All') { request.input('productId', sql.VarChar, productId); query += ' AND EXISTS (SELECT 1 FROM Rec_Tran rt WHERE rt.Trans_No = d.Trans_No AND rt.pr_code = @productId)'; }
    query += ' ORDER BY d.Trans_No DESC';

    const result = await request.query(query);
    // Return both Trans_No (for API filtering) and Vouchno (for display)
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Dispatch numbers error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching dispatch numbers' });
  }
});

// GET /api/reports/dispatch-products
router.get('/dispatch-products', authMiddleware, async (req, res) => {
  try {
    const { partyId, dispatchNo } = req.query;
    const pool = getPool();
    const request = pool.request();

    let subQuery = `SELECT DISTINCT rt.pr_code FROM Rec_Tran rt JOIN Rec_Order d ON rt.Trans_No = d.Trans_No WHERE d.book_type = 'DC'`;
    if (partyId    && partyId    !== 'All') { request.input('partyId',    sql.VarChar, partyId);          subQuery += ' AND d.client_code = @partyId'; }
    if (dispatchNo && dispatchNo !== 'All') { request.input('dispatchNo', sql.Int, parseInt(dispatchNo)); subQuery += ' AND rt.Trans_No = @dispatchNo'; }

    // Try Product table first, fall back to prdmast
    let result;
    try {
      result = await request.query(`
        SELECT prod_code AS ItemCode, prod_name AS ProductName, unit1 AS Unit
        FROM Product WHERE prod_code IN (${subQuery})
        ORDER BY prod_code
      `);
    } catch (_) {
      result = await request.query(`
        SELECT pr_code AS ItemCode, pr_name AS ProductName, unit AS Unit
        FROM prdmast WHERE pr_code IN (${subQuery})
        ORDER BY pr_code
      `);
    }
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Dispatch products error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching dispatch products' });
  }
});

module.exports = router;

