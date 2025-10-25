const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'kaii-store.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    name TEXT,
    role TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price INTEGER,
    stock INTEGER,
    description TEXT,
    image_url TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    type TEXT,
    details TEXT,
    logo_url TEXT,
    is_active INTEGER DEFAULT 1
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    total INTEGER,
    payment_method_id INTEGER,
    proof_image_url TEXT,
    status TEXT DEFAULT 'pending_payment',
    order_content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  const stmt = db.prepare("INSERT OR IGNORE INTO users (email, password, name, role) VALUES (?, ?, ?, ?)");
  stmt.run("admin@kaii.com", "admin123", "Admin KAII", "admin");
  stmt.finalize();

  db.run(`INSERT OR IGNORE INTO payment_methods (name, type, details, is_active) 
          VALUES ('Keris', 'e-wallet', 'Nomor: 0812-3456-7890\nAtas Nama: KAII STORE', 1)`);
});

module.exports = db;
