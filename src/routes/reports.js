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
// Calls the SAME stored procedures as the web app:
//   summary=true  -> StockReport_Summary
//   summary=false -> StockReport_Detail
// Params: fromDate, toDate, partyId (comma-separated ac_code), productId (comma-separated prod_code)
router.get('/stock', authMiddleware, async (req, res) => {
  try {
    const { fromDate, toDate, partyId, productId, summary } = req.query;
    const isSummary = summary === 'true' || summary === true;
    const pool = getPool();

    const frm  = fromDate ? new Date(fromDate) : new Date();
    const till = toDate   ? new Date(toDate)   : new Date();

    // Split multi-select; empty array = "All" for that dimension
    const partyIds   = (partyId   && partyId   !== 'All')
      ? String(partyId).split(',').map(s => s.trim()).filter(Boolean)
      : [];
    const productIds = (productId && productId !== 'All')
      ? String(productId).split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // ── Guard: require at least one filter ────────────────────────────────────
    // Calling stored proc with ALL parties x ALL products is too large.
    if (partyIds.length === 0 && productIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Please select at least one Party or one Product before generating the Stock Report.',
      });
    }

    const procName = isSummary ? 'StockReport_Summary' : 'StockReport_Detail';

    // If one dimension is 'All', pass [''] so the proc returns all for it
    const pList    = partyIds.length   > 0 ? partyIds   : [''];
    const prodList = productIds.length > 0 ? productIds : [''];

    // ── Call stored proc for every party x product combination ─────────────────
    const allRows = [];
    for (const pId of pList) {
      // Look up the party display name from Acmast so we can inject it into every
      // row — the SP filtered by @Acc_Code often does not echo the party name back.
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
        request.requestTimeout = 25000; // 25 s per call
        request.input('Acc_Code',  sql.VarChar,  pId    || '');
        request.input('Prod_code', sql.VarChar,  prodId || '');
        request.input('Frm_Date',  sql.DateTime, frm);
        request.input('Till_Date', sql.DateTime, till);
        const result = await request.execute(procName);
        if (result.recordset && result.recordset.length > 0) {
          // Attach the resolved party name so the normaliser can always find it
          result.recordset.forEach(row => { row._resolvedPartyName = resolvedPartyName; });
          allRows.push(...result.recordset);
        }
      }
    }

    // Log actual SP column names to Render logs so we can see the true naming
    if (allRows.length > 0) {
      console.log('[StockReport] SP columns:', Object.keys(allRows[0]));
      console.log('[StockReport] SP sample row:', JSON.stringify(allRows[0]));
    } else {
      console.log('[StockReport] SP returned 0 rows');
    }

    // ── Fuzzy normaliser: case-insensitive column matching ────────────────────
    const normalize = (row) => {
      const keys = Object.keys(row);

      // Try exact match (case-insensitive) first, then substring match
      const find = (...patterns) => {
        for (const pat of patterns) {
          const k = keys.find(k => k.toLowerCase() === pat.toLowerCase());
          if (k !== undefined && row[k] !== null && row[k] !== undefined) return row[k];
        }
        for (const pat of patterns) {
          const k = keys.find(k => k.toLowerCase().includes(pat.toLowerCase()));
          if (k !== undefined && row[k] !== null && row[k] !== undefined) return row[k];
        }
        return undefined;
      };

      return {
        // Party name: prefer the Acmast lookup, fall back to any SP column
        PartyName:
          row._resolvedPartyName ||
          find('PartyName','ac_name','Party_Name','partyname','AccName','CustName','ClientName') || '',

        ItemCode:
          find('ItemCode','pr_code','prod_code','Item_Code','itemcode','ProdCode','ProductCode','code') || '',

        ProductName:
          find('ProductName','pr_name','prod_name','Prod_Name','productname','ProdName','Item_Name','ItemName') || '',

        Opening:
          parseFloat(find(
            'Opening','Opn_Qty','op_qty','OpnQty','OpnBal','OBal',
            'Opening_Qty','OpQty','OpenQty','Opn'
          ) ?? 0) || 0,

        Inward:
          parseFloat(find(
            'Inward','In_Qty','in_qty','InQty','InWard','Inw_Qty',
            'RecQty','Rec_Qty','Purchase','InwardQty'
          ) ?? 0) || 0,

        Outward:
          parseFloat(find(
            'Outward','Out_Qty','out_qty','OutQty','OutWard',
            'DelQty','Sale','Dispatch','OutwardQty'
          ) ?? 0) || 0,

        Balance:
          parseFloat(find(
            'Balance','Bal_Qty','bal_qty','Cls_Qty','BalQty',
            'ClosBal','CBal','Closing_Qty','ClsQty','Closing'
          ) ?? 0) || 0,

        // Detail-mode extras
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
