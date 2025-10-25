const express = require('express');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('./database');
const fs = require('fs');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'kaii-store-secret-2025';

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static(UPLOADS_DIR));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `proof_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Hanya gambar yang diizinkan!'));
  },
  limits: { fileSize: 2 * 1024 * 1024 }
});

const query = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const run = (sql, params) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID });
    });
  });
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

const adminOnly = (req, res, next) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
};

// === API ===
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    await run('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [name, email, hashed]);
    res.status(201).json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'Email sudah digunakan' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const users = await query('SELECT * FROM users WHERE email = ?', [email]);
  if (!users.length) return res.status(401).json({ error: 'Invalid credentials' });
  const user = users[0];
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET);
  res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
});

app.get('/api/products', authenticateToken, async (req, res) => {
  const products = await query('SELECT * FROM products WHERE stock > 0');
  res.json(products);
});

app.post('/api/checkout', authenticateToken, async (req, res) => {
  const { product_id, quantity, payment_method_id } = req.body;
  const user_id = req.user.id;
  const products = await query('SELECT * FROM products WHERE id = ?', [product_id]);
  if (!products.length) return res.status(404).json({ error: 'Produk tidak ditemukan' });
  const product = products[0];
  if (product.stock < quantity) return res.status(400).json({ error: 'Stok tidak cukup' });
  const total = product.price * quantity;
  await run(
    `INSERT INTO orders (user_id, product_id, quantity, total, payment_method_id, status) 
     VALUES (?, ?, ?, ?, ?, 'pending_payment')`,
    [user_id, product_id, quantity, total, payment_method_id]
  );
  res.json({ success: true });
});

app.post('/api/upload-proof/:orderId', authenticateToken, upload.single('proof'), async (req, res) => {
  const orderId = req.params.orderId;
  const orders = await query('SELECT * FROM orders WHERE id = ? AND user_id = ?', [orderId, req.user.id]);
  if (!orders.length) return res.status(404).json({ error: 'Pesanan tidak ditemukan' });
  await run('UPDATE orders SET proof_image_url = ?, status = ? WHERE id = ?', 
    [`/uploads/${req.file.filename}`, 'pending_confirmation', orderId]);
  res.json({ success: true });
});

app.get('/api/my-orders', authenticateToken, async (req, res) => {
  const orders = await query(`
    SELECT o.*, p.name as product_name, pm.name as payment_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN payment_methods pm ON o.payment_method_id = pm.id
    WHERE o.user_id = ?
    ORDER BY o.created_at DESC
  `, [req.user.id]);
  res.json(orders);
});

// === ADMIN ===
app.get('/api/admin/dashboard', authenticateToken, adminOnly, async (req, res) => {
  const [orders] = await query('SELECT COUNT(*) as total FROM orders');
  const [pending] = await query("SELECT COUNT(*) as total FROM orders WHERE status = 'pending_confirmation'");
  res.json({ total_orders: orders.total, pending_confirmation: pending.total });
});

app.get('/api/admin/products', authenticateToken, adminOnly, async (req, res) => {
  res.json(await query('SELECT * FROM products'));
});
app.post('/api/admin/products', authenticateToken, adminOnly, async (req, res) => {
  const { name, price, stock, description } = req.body;
  await run('INSERT INTO products (name, price, stock, description) VALUES (?, ?, ?, ?)', [name, price, stock, description]);
  res.json({ success: true });
});
app.put('/api/admin/products/:id', authenticateToken, adminOnly, async (req, res) => {
  const { name, price, stock, description } = req.body;
  await run('UPDATE products SET name = ?, price = ?, stock = ?, description = ? WHERE id = ?', 
    [name, price, stock, description, req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/payment-methods', authenticateToken, adminOnly, async (req, res) => {
  res.json(await query('SELECT * FROM payment_methods'));
});
app.post('/api/admin/payment-methods', authenticateToken, adminOnly, async (req, res) => {
  const { name, type, details, is_active } = req.body;
  await run('INSERT INTO payment_methods (name, type, details, is_active) VALUES (?, ?, ?, ?)', 
    [name, type, details, is_active ? 1 : 0]);
  res.json({ success: true });
});
app.put('/api/admin/payment-methods/:id', authenticateToken, adminOnly, async (req, res) => {
  const { name, type, details, is_active } = req.body;
  await run('UPDATE payment_methods SET name = ?, type = ?, details = ?, is_active = ? WHERE id = ?', 
    [name, type, details, is_active ? 1 : 0, req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/orders', authenticateToken, adminOnly, async (req, res) => {
  const orders = await query(`
    SELECT o.*, u.name as user_name, p.name as product_name, pm.name as payment_name
    FROM orders o
    JOIN users u ON o.user_id = u.id
    JOIN products p ON o.product_id = p.id
    JOIN payment_methods pm ON o.payment_method_id = pm.id
    ORDER BY o.created_at DESC
  `);
  res.json(orders);
});

app.post('/api/admin/orders/:id/deliver', authenticateToken, adminOnly, async (req, res) => {
  const { order_content } = req.body;
  await run('UPDATE orders SET order_content = ?, status = ? WHERE id = ?', 
    [order_content, 'completed', req.params.id]);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`✅ KAII STORE berjalan di http://localhost:${PORT}`);
  console.log(`🔐 Admin: admin@kaii.com / admin123`);
});
