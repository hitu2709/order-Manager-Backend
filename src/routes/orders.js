const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { getPool, sql } = require('../config/db');

// All order routes are protected - require JWT token

// POST /api/orders/create
// Creates a new order and its associated products in one transaction
router.post('/create', authMiddleware, async (req, res) => {
  const { 
    customerName, orderDate, notes, products, 
    transport, flag, adjustment, adjustmentValue, salesman,
    salesmanId, totalAmount, partyId
  } = req.body;

  if (!partyId || !products || products.length === 0) {
    return res.status(400).json({
      success: false,
      message: 'Party and at least one product are required',
    });
  }

  const pool = getPool();
  const transaction = new sql.Transaction(pool);

  try {
    await transaction.begin();
    const request = new sql.Request(transaction);

    // Calculate total amount (use provided or calculate)
    const calcTotal = totalAmount || products.reduce((sum, p) => sum + (p.quantity * p.unitPrice - (p.discount || 0)), 0);

    // 1. Get next trans_no (Global from data_no)
    // We use UPDLOCK, HOLDLOCK to prevent race conditions during heavy traffic
    const maxRes = await request.query(`SELECT MAX(trans_no) as maxId FROM data_no WITH (UPDLOCK, HOLDLOCK)`);
    let nextTransNo = 100000001; // Default start if table is empty
    if (maxRes.recordset.length > 0 && maxRes.recordset[0].maxId) {
       nextTransNo = parseInt(maxRes.recordset[0].maxId) + 1;
    }

    // 2. Get next VouchNo (Daily reset logic)
    // User requested: vouch number should start from 1 every day
    const orderDateObj = orderDate ? new Date(orderDate) : new Date();
    const vouchRequest = new sql.Request(transaction); 
    const maxVouchRes = await vouchRequest
      .input('dt', sql.DateTime, orderDateObj)
      .query(`
        SELECT MAX(CAST(vouch_no AS INT)) AS maxDayVouch 
        FROM data_no 
        WHERE Book_type = 'SO'
        AND trans_no IN (SELECT trans_no FROM s_order WHERE CAST(trans_dt AS DATE) = CAST(@dt AS DATE))
      `);
    
    let nextVouchNo = 1;
    if (maxVouchRes.recordset.length > 0 && maxVouchRes.recordset[0].maxDayVouch) {
       nextVouchNo = parseInt(maxVouchRes.recordset[0].maxDayVouch) + 1;
    }

    // 3. Insert into data_no table first (The lock-claim)
    await request
      .input('dTransNo', sql.BigInt, nextTransNo)
      .input('dVouchNo', sql.NVarChar(10), String(nextVouchNo))
      .input('dBookType', sql.NVarChar(2), 'SO')
      .input('dDate', sql.DateTime, new Date())
      .query(`
        INSERT INTO data_no (trans_no, vouch_no, Book_type, sub_type, sydate)
        VALUES (@dTransNo, @dVouchNo, @dBookType, NULL, @dDate)
      `);

    // Helper to safely truncate strings to max length
    const trunc = (str, len) => String(str || '').substring(0, len);

    // 2. Insert the order header into s_order
    await request
      .input('transNo', sql.Int, nextTransNo)
      .input('transDt', sql.DateTime, orderDate ? new Date(orderDate) : new Date())
      .input('clientCode', sql.NVarChar(7), trunc(partyId, 7))
      .input('amount', sql.Float, calcTotal)
      .input('transport', sql.NVarChar(100), trunc(transport, 100))
      .input('spNote', sql.NText, notes || '')
      .input('username', sql.VarChar(100), trunc(String((req.user && (req.user.userId || req.user.username)) || 'admin'), 100))
      .input('brokerCode', sql.NVarChar(7), trunc(salesmanId || '', 7))
      .input('bookType', sql.NVarChar(2), 'SO')
      .input('vouchNo', sql.NVarChar(10), trunc(String(nextVouchNo), 10))
      .input('addStock', sql.NVarChar(1), '')
      .query(`
        INSERT INTO s_order (trans_no, trans_dt, client_code, amount, transport, Sp_Note, username, Broker_code, book_type, VouchNo, AddStock)
        VALUES (@transNo, @transDt, @clientCode, @amount, @transport, @spNote, @username, @brokerCode, @bookType, @vouchNo, @addStock)
      `);

    // 3. Insert each product into ord_tran
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const prodRequest = new sql.Request(transaction);
      await prodRequest
        .input('transNo', sql.Int, nextTransNo)
        .input('srno', sql.Int, i + 1)
        .input('prCode', sql.VarChar(50), trunc(p.itemCode || p.ProductID || '', 50))
        .input('qty', sql.Float, parseFloat(p.quantity) || 0)
        .input('rate', sql.Real, parseFloat(p.unitPrice) || 0)
        .input('lineAmount', sql.Float, (parseFloat(p.quantity) * parseFloat(p.unitPrice)) - parseFloat(p.discount || 0))
        .input('discount', sql.Money, parseFloat(p.discount || 0))
        .input('bookType', sql.NVarChar(2), 'SO')
        .input('itemHead', sql.NVarChar(50), trunc(p.productName || '', 50))
        .query(`
          INSERT INTO ord_tran (trans_no, srno, pr_code, qty, rate, amount, discount, book_type, ItemHead)
          VALUES (@transNo, @srno, @prCode, @qty, @rate, @lineAmount, @discount, @bookType, @itemHead)
        `);
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: 'Order created successfully',
      orderId: nextTransNo,
    });
  } catch (err) {
    if (transaction) {
      try { await transaction.rollback(); } catch(e) { /* ignore already aborted */ }
    }
    console.error('Create order error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to create order: ' + err.message,
    });
  }
});

// GET /api/parties
// Get all parties for dropdown using Acmast
router.get('/parties', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT 
        A.ac_code as PartyID, 
        A.ac_name as PartyName, 
        A.category as Category, 
        A.discper,
        (SELECT TOP 1 LTRIM(RTRIM(ISNULL(transport, ''))) FROM Ac_Excise WHERE LTRIM(RTRIM(ac_Code)) = LTRIM(RTRIM(A.ac_code))) as Transport
      From Acmast A
      Where A.grp_name Like '%DEBTORS%' 
      Order by A.ac_name
    `);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Fetch parties error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching parties' });
  }
});

// GET /api/salesmen
// Get all salesmen for dropdown using acMast
router.get('/salesmen', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      Select ac_code, ac_name from Acmast where grp_name ='BROKER'
      Union Select NULL as ac_code, '' as ac_name 
    `);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Fetch salesmen error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching salesmen' });
  }
});

// GET /api/products
// Get all products for dropdown using Product (singular)
router.get('/products', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query(`
      SELECT prod_code as ItemCode, prod_name as ProductName, 0 as Stock, unit1 as Unit, Image as ImageUrl, sale_rate as Rate 
      FROM Product 
      ORDER BY prod_code
    `);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error('Fetch products error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching products' });
  }
});

// GET /api/orders/numbers
// Get all order numbers for report dropdowns
router.get('/numbers', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.request().query('SELECT TOP 100 trans_no FROM s_order ORDER BY trans_no DESC');
    return res.status(200).json({ success: true, data: result.recordset.map(r => r.trans_no) });
  } catch (err) {
    console.error('Fetch order numbers error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching order numbers' });
  }
});

// GET /api/orders/list
// Get recent orders list for dashboard using user's exact SQL query
router.get('/list', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    
    const result = await pool.request()
      .query(`
      SELECT 
        Convert(varchar(10), S_order.trans_dt, 103) as [Date],
        S_order.Vouchno as [SaleOrderNo],
        acmast.ac_name as [PartyName],
        (SELECT Sum(isnull(Qty,0)) FROM Ord_Tran WHERE Trans_No = S_order.Trans_No) as Qty,
        (SELECT Sum(isnull(Rec_Qty,0)) FROM Ord_Tran WHERE Trans_No = S_order.Trans_No) as DesptchQty,
        (SELECT Sum(isnull(Qty,0)-(isnull(Rec_Qty,0)+isnull(SetoffQty,0))) FROM Ord_Tran WHERE Trans_No = S_order.Trans_No) as BalQty,
        S_order.Trans_No as [ID]
      FROM S_order 
      LEFT JOIN acmast ON S_order.client_code = acmast.ac_code  
      WHERE S_order.book_type = 'SO'
      ORDER BY S_order.trans_dt DESC, (CASE WHEN isnumeric(S_order.Vouchno)=1 THEN cast(S_order.Vouchno as int) END)
    `);

    // Map to frontend-friendly field names
    const orders = result.recordset.map(r => ({
      OrderID: r.ID,
      SaleOrderNo: r.SaleOrderNo,
      CustomerName: r.PartyName,
      OrderDate: r.Date,
      Qty: r.Qty,
      DesptchQty: r.DesptchQty,
      BalQty: r.BalQty,
    }));

    return res.status(200).json({
      success: true,
      data: orders,
    });
  } catch (err) {
    console.error('List orders error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching orders' });
  }
});

// GET /api/orders/:id
// Get a specific order's header and products
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const pool = getPool();
    const id = parseInt(req.params.id, 10);
    
    // Get header with address info
    const headerResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT o.trans_no as OrderID, o.client_code, a.ac_name as CustomerName, 
               o.trans_dt as OrderDate, 
               LTRIM(RTRIM(ISNULL(o.Broker_code,''))) as SalesmanCode, 
               COALESCE(b.ac_name, LTRIM(RTRIM(o.Broker_code)), 'Missing Name') as SalesmanName,
               'Pending' as Status, o.amount as TotalAmount,
               a.Place, a.Contact_person, a.ac_name1 as Address2,
               o.transport as Transport, o.Sp_Note as Notes
        FROM s_order o
        LEFT JOIN Acmast a ON LTRIM(RTRIM(o.client_code)) = LTRIM(RTRIM(a.ac_code))
        LEFT JOIN Acmast b ON LTRIM(RTRIM(o.Broker_code)) = LTRIM(RTRIM(b.ac_code))
        WHERE o.trans_no = @id
      `);
      
    if (headerResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const order = headerResult.recordset[0];
    
    // Get items with sizing and quality
    const itemsResult = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT t.srno, 
               ISNULL(NULLIF(t.pr_code,''), t.code) as ItemCode, 
               ISNULL(NULLIF(p.prod_name,''), t.ItemHead) as ProductName, 
               t.qty as Quantity, t.rate as UnitPrice, t.discount as Discount, t.amount as TotalPrice,
               t.Size, t.Quality, t.Description
        FROM ord_tran t
        LEFT JOIN Product p ON ISNULL(NULLIF(t.pr_code,''), t.code) = p.prod_code
        WHERE t.trans_no = @id
        ORDER BY t.srno
      `);
      
    // Clean response for production
    const orderData = {
      ...headerResult.recordset[0],
      products: itemsResult.recordset
    };

    return res.status(200).json({ success: true, data: orderData });
  } catch (err) {
    console.error('Get order error:', err);
    return res.status(500).json({ success: false, message: 'Error fetching order' });
  }
});

// PUT /api/orders/:id
// Update an existing order
router.put('/:id', authMiddleware, async (req, res) => {
  const { 
    products, transport, notes, salesmanId, totalAmount, partyId
  } = req.body;
  const id = parseInt(req.params.id, 10);
  const pool = getPool();
  
  try {
    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    const request = new sql.Request(transaction);

    // Helper to safely truncate strings to max length
    const trunc = (str, len) => String(str || '').substring(0, len);

    // 1. Update s_order (Header)
    await request
      .input('id', sql.Int, id)
      .input('amount', sql.Float, parseFloat(totalAmount) || 0)
      .input('transport', sql.NVarChar(100), trunc(transport, 100))
      .input('spNote', sql.NText, notes || '')
      .input('brokerCode', sql.NVarChar(7), trunc(salesmanId || '', 7))
      .input('partyId', sql.NVarChar(7), trunc(partyId || '', 7))
      .query(`
        UPDATE s_order 
        SET amount = @amount, transport = @transport, Sp_Note = @spNote, Broker_code = @brokerCode, client_code = @partyId
        WHERE trans_no = @id
      `);

    // 2. Delete existing items
    await request.query(`DELETE FROM ord_tran WHERE trans_no = @id`);

    // 3. Re-insert items
    if (products && products.length > 0) {
      for (let i = 0; i < products.length; i++) {
        const p = products[i];
        const prodRequest = new sql.Request(transaction);
        await prodRequest
          .input('transNo', sql.Int, id)
          .input('srno', sql.Int, i + 1)
          .input('prCode', sql.VarChar(50), trunc(p.itemCode || p.ProductID || '', 50))
          .input('qty', sql.Float, parseFloat(p.quantity) || 0)
          .input('rate', sql.Real, parseFloat(p.unitPrice) || 0)
          .input('lineAmount', sql.Float, (parseFloat(p.quantity) * parseFloat(p.unitPrice)) - parseFloat(p.discount || 0))
          .input('discount', sql.Money, parseFloat(p.discount || 0))
          .input('bookType', sql.NVarChar(2), 'SO')
          .input('itemHead', sql.NVarChar(50), trunc(p.productName || '', 50))
          .query(`
            INSERT INTO ord_tran (trans_no, srno, pr_code, qty, rate, amount, discount, book_type, ItemHead)
            VALUES (@transNo, @srno, @prCode, @qty, @rate, @lineAmount, @discount, @bookType, @itemHead)
          `);
      }
    }

    await transaction.commit();
    return res.status(200).json({ success: true, message: 'Order updated successfully' });
  } catch (err) {
    console.error('Update order error:', err);
    return res.status(500).json({ success: false, message: 'Error updating order' });
  }
});

// DELETE /api/orders/:id
// Delete an order
router.delete('/:id', authMiddleware, async (req, res) => {
  const pool = getPool();
  const transaction = new sql.Transaction(pool);
  
  try {
    const id = parseInt(req.params.id, 10);
    await transaction.begin();
    const request = new sql.Request(transaction);
    
    await request.input('id', sql.Int, id).query(`DELETE FROM ord_tran WHERE trans_no = @id`);
    await request.query(`DELETE FROM s_order WHERE trans_no = @id`);
    
    await transaction.commit();
    return res.status(200).json({ success: true, message: 'Order deleted successfully' });
  } catch (err) {
    if (transaction) {
      try { await transaction.rollback(); } catch(e) { /* ignore already aborted */ }
    }
    console.error('Delete order error:', err);
    return res.status(500).json({ success: false, message: 'Error deleting order' });
  }
});

module.exports = router;
