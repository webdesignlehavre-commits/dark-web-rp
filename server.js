const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = '2022';
const USE_PG = !!process.env.DATABASE_URL;

let pool;
if (USE_PG) {
  const { Pool } = require('pg');
  pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

// === JSON FILE DB ===
const DB_FILE = path.join(__dirname, 'data', 'db.json');
let db = { users: [], sessions: [], sites: [], store_products: [] };

function loadDB() {
  try {
    if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    else saveDB();
  } catch { saveDB(); }
}

function saveDB() {
  try {
    if (!fs.existsSync(path.join(__dirname, 'data'))) fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (e) { console.error('Save error:', e.message); }
}

// === DB ABSTRACTION ===
async function dbQuery(table, filter = () => true) {
  if (USE_PG) {
    const col = { users: '*', sessions: '*', sites: '*', store_products: '*' };
    const result = await pool.query(`SELECT * FROM ${table}`);
    return result.rows.filter(filter);
  }
  return (db[table] || []).filter(filter);
}

async function dbFind(table, condition) {
  if (USE_PG) {
    const keys = Object.keys(condition);
    const vals = Object.values(condition);
    const where = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    const result = await pool.query(`SELECT * FROM ${table} WHERE ${where}`, vals);
    return result.rows[0] || null;
  }
  return (db[table] || []).find(row => keys.every(k => row[k] === condition[k])) || null;
}

async function dbInsert(table, data) {
  if (USE_PG) {
    const keys = Object.keys(data);
    const vals = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const result = await pool.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders}) RETURNING *`, vals);
    return result.rows[0];
  }
  db[table] = db[table] || [];
  db[table].push(data);
  saveDB();
  return data;
}

async function dbUpdate(table, condition, updates) {
  if (USE_PG) {
    const cKeys = Object.keys(condition);
    const uKeys = Object.keys(updates);
    const allKeys = [...uKeys, ...cKeys];
    const allVals = [...Object.values(updates), ...Object.values(condition)];
    const set = uKeys.map((k, i) => `${k} = $${i + 1}`).join(', ');
    const where = cKeys.map((k, i) => `${k} = $${uKeys.length + i + 1}`).join(' AND ');
    await pool.query(`UPDATE ${table} SET ${set} WHERE ${where}`, allVals);
    return;
  }
  const idx = (db[table] || []).findIndex(row => cKeys.every(k => row[k] === condition[k]));
  if (idx >= 0) { Object.assign(db[table][idx], updates); saveDB(); }
}

async function dbDelete(table, condition) {
  if (USE_PG) {
    const keys = Object.keys(condition);
    const vals = Object.values(condition);
    const where = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
    await pool.query(`DELETE FROM ${table} WHERE ${where}`, vals);
    return;
  }
  db[table] = (db[table] || []).filter(row => !(keys.every(k => row[k] === condition[k])));
  saveDB();
}

async function dbCount(table, filter) {
  if (USE_PG) {
    let q = `SELECT COUNT(*) FROM ${table}`;
    if (filter) {
      const keys = Object.keys(filter);
      const vals = Object.values(filter);
      const where = keys.map((k, i) => `${k} = $${i + 1}`).join(' AND ');
      q += ` WHERE ${where}`;
      const result = await pool.query(q, vals);
      return parseInt(result.rows[0].count);
    }
    const result = await pool.query(q);
    return parseInt(result.rows[0].count);
  }
  const items = filter ? (db[table] || []).filter(row => Object.keys(filter).every(k => row[k] === filter[k])) : (db[table] || []);
  return items.length;
}

// === INIT ===
async function initDB() {
  if (USE_PG) {
    await pool.query(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sites (id TEXT PRIMARY KEY, user_id TEXT, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', html_content TEXT NOT NULL, css_content TEXT DEFAULT '', js_content TEXT DEFAULT '', status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW(), approved_at TIMESTAMP)`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, is_admin BOOLEAN DEFAULT false, created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS store_products (id SERIAL PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '', price INTEGER DEFAULT 0, crypto TEXT DEFAULT '', icon TEXT DEFAULT '', category TEXT DEFAULT '', badge TEXT DEFAULT '', badge_class TEXT DEFAULT '', seller TEXT DEFAULT 'D4rkSh0p_Admin', reviews INTEGER DEFAULT 0, stars REAL DEFAULT 5.0, created_at TIMESTAMP DEFAULT NOW())`);
    console.log('[DB] PostgreSQL tables creees');

    const count = await pool.query('SELECT COUNT(*) FROM store_products');
    if (parseInt(count.rows[0].count) === 0) {
      const defaults = [
        ["USB Keylogger", "Enregistre toutes les frappes clavier. USB discrete. Range: 10m via WiFi.", 2500, "0.00042 BTC", "\u{1F50C}", "hacking", "HOT", "hot", "TechDealer", 14, 4.8],
        ["Malware Pack v3", "12 malware differs. Ransomware, trojan, keylogger. Support 30 jours.", 8000, "0.00134 BTC", "\u{1F4BB}", "hacking", "NEW", "", "VirusMaster", 7, 4.5],
        ["AK-47 Supprimee", "AK-47 avec silencieux custom. Munitions 7.62 incluses (30 balles).", 15000, "0.00251 BTC", "\u{1F52B}", "weapons", "", "", "Armurier_76", 22, 4.9],
        ["Silencieux Mod.45", "Silencieux universel calibre .45. Compatible Glock, USP, 1911.", 5000, "0.00083 BTC", "\u{1F528}", "weapons", "", "", "Armurier_76", 9, 4.7],
        ["Cannabis Premium", "50g de Green Dragon. THC: 28%. Cultive en indoor.", 3000, "0.00050 BTC", "\u{1F33F}", "drugs", "PREMIUM", "", "GrowMaster", 31, 4.6],
        ["Methamphetamine Crystal", "20g pur. Qualite Breaking Bad. Livraison sechee.", 7500, "0.00125 BTC", "\u2728", "drugs", "", "", "Chemist_X", 5, 4.2],
        ["Passeport Faux", "Passeport francais tres haute qualite. Photo personnalisee.", 12000, "0.00200 BTC", "\u{1F4DC}", "docs", "TOP", "hot", "DocMaker", 18, 4.9],
        ["Permis de conduire", "Permis francais avec code barre. Verifiable en ligne.", 4000, "0.00067 BTC", "\u{1F697}", "docs", "", "", "DocMaker", 12, 4.4],
        ["Lockpick Set Pro", "Kit complet 32 outils. Pochette discrete. Tutoriel inclus.", 800, "0.00013 BTC", "\u{1F512}", "tools", "", "", "LockBreaker", 25, 4.8],
        ["GPS Tracker Mini", "Tracker GPS 5cm. Batterie 7 jours. Suivi en temps reel.", 3500, "0.00058 BTC", "\u{1F4CD}", "tools", "NEW", "", "SpyGadgets", 8, 4.3],
        ["Flash Drive 256GB", "Cle USB chiffree AES-256. Formatage a distance possible.", 1200, "0.00020 BTC", "\u{1F4BE}", "hacking", "", "", "TechDealer", 16, 4.7],
        ["Glock 19 + Munitions", "Glock 19 Gen5. 3 chargeurs (45 balles). Etui de ceinture.", 9000, "0.00150 BTC", "\u{1F52A}", "weapons", "", "", "Armurier_76", 19, 4.8]
      ];
      for (const p of defaults) {
        await pool.query(`INSERT INTO store_products (name, description, price, crypto, icon, category, badge, badge_class, seller, reviews, stars) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, p);
      }
      console.log('[DB] 12 produits par defaut inseres');
    }
  } else {
    loadDB();
    console.log('[DB] Mode JSON local (pas de PostgreSQL)');
    if (db.store_products.length === 0) {
      db.store_products = [
        { id: 1, name: "USB Keylogger", description: "Enregistre toutes les frappes clavier. USB discrete. Range: 10m via WiFi.", price: 2500, crypto: "0.00042 BTC", icon: "\u{1F50C}", category: "hacking", badge: "HOT", badge_class: "hot", seller: "TechDealer", reviews: 14, stars: 4.8 },
        { id: 2, name: "Malware Pack v3", description: "12 malware differs. Ransomware, trojan, keylogger. Support 30 jours.", price: 8000, crypto: "0.00134 BTC", icon: "\u{1F4BB}", category: "hacking", badge: "NEW", badge_class: "", seller: "VirusMaster", reviews: 7, stars: 4.5 },
        { id: 3, name: "AK-47 Supprimee", description: "AK-47 avec silencieux custom. Munitions 7.62 incluses (30 balles).", price: 15000, crypto: "0.00251 BTC", icon: "\u{1F52B}", category: "weapons", badge: "", badge_class: "", seller: "Armurier_76", reviews: 22, stars: 4.9 },
        { id: 4, name: "Silencieux Mod.45", description: "Silencieux universel calibre .45. Compatible Glock, USP, 1911.", price: 5000, crypto: "0.00083 BTC", icon: "\u{1F528}", category: "weapons", badge: "", badge_class: "", seller: "Armurier_76", reviews: 9, stars: 4.7 },
        { id: 5, name: "Cannabis Premium", description: "50g de Green Dragon. THC: 28%. Cultive en indoor.", price: 3000, crypto: "0.00050 BTC", icon: "\u{1F33F}", category: "drugs", badge: "PREMIUM", badge_class: "", seller: "GrowMaster", reviews: 31, stars: 4.6 },
        { id: 6, name: "Methamphetamine Crystal", description: "20g pur. Qualite Breaking Bad. Livraison sechee.", price: 7500, crypto: "0.00125 BTC", icon: "\u2728", category: "drugs", badge: "", badge_class: "", seller: "Chemist_X", reviews: 5, stars: 4.2 },
        { id: 7, name: "Passeport Faux", description: "Passeport francais tres haute qualite. Photo personnalisee.", price: 12000, crypto: "0.00200 BTC", icon: "\u{1F4DC}", category: "docs", badge: "TOP", badge_class: "hot", seller: "DocMaker", reviews: 18, stars: 4.9 },
        { id: 8, name: "Permis de conduire", description: "Permis francais avec code barre. Verifiable en ligne.", price: 4000, crypto: "0.00067 BTC", icon: "\u{1F697}", category: "docs", badge: "", badge_class: "", seller: "DocMaker", reviews: 12, stars: 4.4 },
        { id: 9, name: "Lockpick Set Pro", description: "Kit complet 32 outils. Pochette discrete. Tutoriel inclus.", price: 800, crypto: "0.00013 BTC", icon: "\u{1F512}", category: "tools", badge: "", badge_class: "", seller: "LockBreaker", reviews: 25, stars: 4.8 },
        { id: 10, name: "GPS Tracker Mini", description: "Tracker GPS 5cm. Batterie 7 jours. Suivi en temps reel.", price: 3500, crypto: "0.00058 BTC", icon: "\u{1F4CD}", category: "tools", badge: "NEW", badge_class: "", seller: "SpyGadgets", reviews: 8, stars: 4.3 },
        { id: 11, name: "Flash Drive 256GB", description: "Cle USB chiffree AES-256. Formatage a distance possible.", price: 1200, crypto: "0.00020 BTC", icon: "\u{1F4BE}", category: "hacking", badge: "", badge_class: "", seller: "TechDealer", reviews: 16, stars: 4.7 },
        { id: 12, name: "Glock 19 + Munitions", description: "Glock 19 Gen5. 3 chargeurs (45 balles). Etui de ceinture.", price: 9000, crypto: "0.00150 BTC", icon: "\u{1F52A}", category: "weapons", badge: "", badge_class: "", seller: "Armurier_76", reviews: 19, stars: 4.8 }
      ];
      saveDB();
      console.log('[DB] 12 produits par defaut inseres');
    }
  }
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non autorise' });
  const session = await dbFind('sessions', { token });
  if (!session) return res.status(401).json({ error: 'Session invalide' });
  req.user = session;
  next();
}

async function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin requis' });
  next();
}

// === AUTH ===
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Champs requis' });
  if (username.length < 3 || password.length < 4) return res.status(400).json({ error: 'Pseudo 3+ chars, mdp 4+ chars' });
  const existing = await dbFind('users', { username });
  if (existing) return res.status(400).json({ error: 'Pseudo deja pris' });
  const id = uuidv4();
  await dbInsert('users', { id, username, password });
  const token = uuidv4();
  await dbInsert('sessions', { token, user_id: id, is_admin: false });
  res.json({ success: true, token, username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (password === ADMIN_CODE && username?.toLowerCase() === 'admin') {
    const token = uuidv4();
    await dbInsert('sessions', { token, user_id: 'admin', is_admin: true });
    return res.json({ success: true, token, username: 'ADMIN', is_admin: true });
  }
  const user = await dbFind('users', { username, password });
  if (!user) return res.status(401).json({ error: 'Identifiants incorrects' });
  const token = uuidv4();
  await dbInsert('sessions', { token, user_id: user.id, is_admin: false });
  res.json({ success: true, token, username: user.username, is_admin: false });
});

app.post('/api/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) await dbDelete('sessions', { token });
  res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  if (req.user.is_admin) return res.json({ username: 'ADMIN', is_admin: true });
  const user = await dbFind('users', { id: req.user.user_id });
  res.json({ username: user?.username || 'Inconnu', is_admin: false });
});

// === SITES ===
app.post('/api/sites', requireAuth, async (req, res) => {
  const { name, description, html_content, css_content, js_content } = req.body;
  if (!name || !html_content) return res.status(400).json({ error: 'Nom et HTML requis' });
  const id = uuidv4();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + id.slice(0, 6);
  await dbInsert('sites', { id, user_id: req.user.user_id, name, slug, description: description || '', html_content, css_content: css_content || '', js_content: js_content || '', status: 'pending', created_at: new Date().toISOString(), approved_at: null });
  res.json({ success: true, id, slug, status: 'pending' });
});

app.get('/api/sites', async (req, res) => {
  const sites = await dbQuery('sites', s => s.status === 'approved');
  res.json(sites.map(s => ({ id: s.id, name: s.name, slug: s.slug, description: s.description, created_at: s.created_at, approved_at: s.approved_at })));
});

app.get('/api/sites/pending', requireAuth, requireAdmin, async (req, res) => {
  const sites = await dbQuery('sites', s => s.status === 'pending');
  const users = await dbQuery('users');
  const enriched = sites.map(s => ({ ...s, username: users.find(u => u.id === s.user_id)?.username || 'Inconnu' }));
  res.json(enriched);
});

app.get('/api/sites/all', requireAuth, requireAdmin, async (req, res) => {
  const sites = await dbQuery('sites', () => true);
  const users = await dbQuery('users');
  const enriched = sites.map(s => ({ ...s, username: users.find(u => u.id === s.user_id)?.username || 'Inconnu' }));
  res.json(enriched);
});

app.get('/api/sites/:slug', async (req, res) => {
  const site = await dbFind('sites', { slug: req.params.slug });
  if (!site || site.status !== 'approved') return res.status(404).json({ error: 'Site non trouve' });
  res.json(site);
});

app.put('/api/sites/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  await dbUpdate('sites', { id: req.params.id }, { status: 'approved', approved_at: new Date().toISOString() });
  res.json({ success: true });
});

app.put('/api/sites/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  await dbUpdate('sites', { id: req.params.id }, { status: 'rejected' });
  res.json({ success: true });
});

app.delete('/api/sites/:id', requireAuth, requireAdmin, async (req, res) => {
  await dbDelete('sites', { id: req.params.id });
  res.json({ success: true });
});

app.get('/site/:slug', async (req, res) => {
  const site = await dbFind('sites', { slug: req.params.slug });
  if (!site || site.status !== 'approved') return res.status(404).send('<h1 style="color:red;text-align:center;margin-top:100px;font-family:monospace;background:#000;padding:50px">[!] Site non trouve ou non approuve</h1>');
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${site.name}</title><style>${site.css_content}</style></head><body>${site.html_content}<script>${site.js_content}<\/script></body></html>`);
});

// === STORE ===
app.get('/api/store/products', async (req, res) => {
  const products = await dbQuery('store_products', () => true);
  if (USE_PG) res.json(products);
  else res.json(products.sort((a, b) => a.id - b.id));
});

app.post('/api/store/products', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, price, crypto, icon, category, badge, badge_class, seller, reviews, stars } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  let id = 1;
  if (USE_PG) {
    const result = await dbInsert('store_products', { name, description: description || '', price: price || 0, crypto: crypto || '', icon: icon || '', category: category || '', badge: badge || '', badge_class: badge_class || '', seller: seller || 'D4rkSh0p_Admin', reviews: reviews || 0, stars: stars || 5.0 });
    return res.json({ success: true, product: result });
  } else {
    id = Math.max(0, ...db.store_products.map(p => p.id)) + 1;
    const product = { id, name, description: description || '', price: price || 0, crypto: crypto || '', icon: icon || '', category: category || '', badge: badge || '', badge_class: badge_class || '', seller: seller || 'D4rkSh0p_Admin', reviews: reviews || 0, stars: stars || 5.0 };
    await dbInsert('store_products', product);
    res.json({ success: true, product });
  }
});

app.put('/api/store/products/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, price, crypto, icon, category, badge, badge_class, seller } = req.body;
  const id = USE_PG ? req.params.id : parseInt(req.params.id);
  await dbUpdate('store_products', { id }, { name, description, price, crypto, icon, category, badge, badge_class, seller });
  res.json({ success: true });
});

app.delete('/api/store/products/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = USE_PG ? req.params.id : parseInt(req.params.id);
  await dbDelete('store_products', { id });
  res.json({ success: true });
});

// === STATS ===
app.get('/api/stats', async (req, res) => {
  const totalSites = await dbCount('sites');
  const approvedSites = await dbCount('sites', { status: 'approved' });
  const pendingSites = await dbCount('sites', { status: 'pending' });
  const totalUsers = await dbCount('users');
  const totalProducts = await dbCount('store_products');
  res.json({ totalSites, approvedSites, pendingSites, totalUsers, totalProducts });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
async function start() {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log('');
      console.log('  ╔═══════════════════════════════════════════╗');
      console.log('  ║        DARKNET RP - SERVEUR LANCE         ║');
      console.log('  ╠═══════════════════════════════════════════╣');
      console.log(`  ║  Mode: ${USE_PG ? 'PostgreSQL' : 'JSON local'}                     ║`);
      console.log(`  ║  URL:  http://localhost:${PORT}              ║`);
      console.log(`  ║  Admin: admin / ${ADMIN_CODE}                    ║`);
      console.log(`  ║  Store Admin Code: 2023                   ║`);
      console.log('  ╚═══════════════════════════════════════════╝');
      console.log('');
    });
  } catch (e) {
    console.error('Erreur demarrage:', e.message);
    process.exit(1);
  }
}

start();
