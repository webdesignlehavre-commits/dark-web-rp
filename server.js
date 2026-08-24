const express = require('express');
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_CODE = '2022';

// PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT DEFAULT '',
      html_content TEXT NOT NULL,
      css_content TEXT DEFAULT '',
      js_content TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT NOW(),
      approved_at TIMESTAMP
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS store_products (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price INTEGER DEFAULT 0,
      crypto TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      category TEXT DEFAULT '',
      badge TEXT DEFAULT '',
      badge_class TEXT DEFAULT '',
      seller TEXT DEFAULT 'D4rkSh0p_Admin',
      reviews INTEGER DEFAULT 0,
      stars REAL DEFAULT 5.0,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  console.log('[DB] Tables creees');
}

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non autorise' });
  try {
    const result = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Session invalide' });
    req.user = result.rows[0];
    next();
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
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
  try {
    const id = uuidv4();
    await pool.query('INSERT INTO users (id, username, password) VALUES ($1, $2, $3)', [id, username, password]);
    const token = uuidv4();
    await pool.query('INSERT INTO sessions (token, user_id, is_admin) VALUES ($1, $2, false)', [token, id]);
    res.json({ success: true, token, username });
  } catch (e) {
    if (e.message?.includes('unique')) return res.status(400).json({ error: 'Pseudo deja pris' });
    res.status(500).json({ error: 'Erreur serveur: ' + e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (password === ADMIN_CODE && username?.toLowerCase() === 'admin') {
    const token = uuidv4();
    await pool.query('INSERT INTO sessions (token, user_id, is_admin) VALUES ($1, $2, true)', [token, 'admin']);
    return res.json({ success: true, token, username: 'ADMIN', is_admin: true });
  }
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND password = $2', [username, password]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Identifiants incorrects' });
    const user = result.rows[0];
    const token = uuidv4();
    await pool.query('INSERT INTO sessions (token, user_id, is_admin) VALUES ($1, $2, false)', [token, user.id]);
    res.json({ success: true, token, username: user.username, is_admin: false });
  } catch { res.status(500).json({ error: 'Erreur serveur' }); }
});

app.post('/api/logout', requireAuth, async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ success: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  if (req.user.is_admin) return res.json({ username: 'ADMIN', is_admin: true });
  try {
    const result = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.user.user_id]);
    res.json({ username: result.rows[0]?.username || 'Inconnu', is_admin: false });
  } catch { res.json({ username: 'Inconnu', is_admin: false }); }
});

// === SITES ===
app.post('/api/sites', requireAuth, async (req, res) => {
  const { name, description, html_content, css_content, js_content } = req.body;
  if (!name || !html_content) return res.status(400).json({ error: 'Nom et HTML requis' });
  const id = uuidv4();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + id.slice(0, 6);
  try {
    await pool.query(`INSERT INTO sites (id, user_id, name, slug, description, html_content, css_content, js_content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, req.user.user_id, name, slug, description || '', html_content, css_content || '', js_content || '']);
    res.json({ success: true, id, slug, status: 'pending' });
  } catch (e) { res.status(500).json({ error: 'Erreur: ' + e.message }); }
});

app.get('/api/sites', async (req, res) => {
  try {
    const result = await pool.query(`SELECT id, name, slug, description, created_at, approved_at FROM sites WHERE status = 'approved' ORDER BY approved_at DESC`);
    res.json(result.rows);
  } catch { res.json([]); }
});

app.get('/api/sites/pending', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT s.*, u.username FROM sites s LEFT JOIN users u ON s.user_id = u.id WHERE s.status = 'pending' ORDER BY s.created_at DESC`);
    res.json(result.rows);
  } catch { res.json([]); }
});

app.get('/api/sites/all', requireAuth, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`SELECT s.*, u.username FROM sites s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC`);
    res.json(result.rows);
  } catch { res.json([]); }
});

app.get('/api/sites/:slug', async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM sites WHERE slug = $1 AND status = 'approved'`, [req.params.slug]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Site non trouve' });
    res.json(result.rows[0]);
  } catch { res.status(404).json({ error: 'Erreur' }); }
});

app.put('/api/sites/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  await pool.query(`UPDATE sites SET status = 'approved', approved_at = NOW() WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
});

app.put('/api/sites/:id/reject', requireAuth, requireAdmin, async (req, res) => {
  await pool.query(`UPDATE sites SET status = 'rejected' WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
});

app.delete('/api/sites/:id', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM sites WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.get('/site/:slug', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sites WHERE slug = $1 AND status = $2', [req.params.slug, 'approved']);
    if (result.rows.length === 0) return res.status(404).send('<h1 style="color:red;text-align:center;margin-top:100px;font-family:monospace;background:#000;padding:50px">[!] Site non trouve ou non approuve</h1>');
    const site = result.rows[0];
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${site.name}</title><style>${site.css_content}</style></head><body>${site.html_content}<script>${site.js_content}<\/script></body></html>`);
  } catch { res.status(404).send('Erreur'); }
});

// === STORE (dark store) ===
app.get('/api/store/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM store_products ORDER BY id ASC');
    res.json(result.rows);
  } catch { res.json([]); }
});

app.post('/api/store/products', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, price, crypto, icon, category, badge, badge_class, seller, reviews, stars } = req.body;
  if (!name) return res.status(400).json({ error: 'Nom requis' });
  try {
    const result = await pool.query(
      `INSERT INTO store_products (name, description, price, crypto, icon, category, badge, badge_class, seller, reviews, stars) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [name, description || '', price || 0, crypto || '', icon || '', category || '', badge || '', badge_class || '', seller || 'D4rkSh0p_Admin', reviews || 0, stars || 5.0]
    );
    res.json({ success: true, product: result.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/store/products/:id', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, price, crypto, icon, category, badge, badge_class, seller } = req.body;
  try {
    await pool.query(
      `UPDATE store_products SET name=$1, description=$2, price=$3, crypto=$4, icon=$5, category=$6, badge=$7, badge_class=$8, seller=$9 WHERE id=$10`,
      [name, description, price, crypto, icon, category, badge, badge_class, seller, req.params.id]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/store/products/:id', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM store_products WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// === STATS ===
app.get('/api/stats', async (req, res) => {
  try {
    const sites = await pool.query('SELECT COUNT(*) FROM sites');
    const approved = await pool.query("SELECT COUNT(*) FROM sites WHERE status = 'approved'");
    const pending = await pool.query("SELECT COUNT(*) FROM sites WHERE status = 'pending'");
    const users = await pool.query('SELECT COUNT(*) FROM users');
    const products = await pool.query('SELECT COUNT(*) FROM store_products');
    res.json({
      totalSites: parseInt(sites.rows[0].count),
      approvedSites: parseInt(approved.rows[0].count),
      pendingSites: parseInt(pending.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
      totalProducts: parseInt(products.rows[0].count)
    });
  } catch { res.json({ totalSites: 0, approvedSites: 0, pendingSites: 0, totalUsers: 0, totalProducts: 0 }); }
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
async function start() {
  try {
    await initDB();
    
    // Seed default store products if empty
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

    app.listen(PORT, () => {
      console.log('');
      console.log('  ╔═══════════════════════════════════════════╗');
      console.log('  ║        DARKNET RP - SERVEUR LANCE         ║');
      console.log('  ╠═══════════════════════════════════════════╣');
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
