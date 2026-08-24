// Dark Web RP - Client JS
let currentUser = null;
let authToken = localStorage.getItem('darkweb_token');

// API calls
async function api(url, method = 'GET', body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
  
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null
  });
  return res.json();
}

// Check session on load
async function checkSession() {
  if (!authToken) return;
  const data = await api('/api/me');
  if (data.username) {
    currentUser = data;
    updateUI();
  } else {
    localStorage.removeItem('darkweb_token');
    authToken = null;
  }
}

// Update UI based on auth state
function updateUI() {
  const authBtns = document.getElementById('auth-buttons');
  const userBtns = document.getElementById('user-buttons');
  
  if (currentUser) {
    if (authBtns) authBtns.style.display = 'none';
    if (userBtns) {
      userBtns.style.display = 'flex';
      userBtns.innerHTML = `
        <span style="color:var(--accent);font-size:0.85em">${currentUser.is_admin ? 'ADMIN' : currentUser.username}</span>
        ${currentUser.is_admin ? '<a href="/admin.html">PANEL ADMIN</a>' : ''}
        <a href="/submit.html">CREER UN SITE</a>
        <button onclick="logout()">DECONNEXION</button>
      `;
    }
  } else {
    if (authBtns) authBtns.style.display = 'flex';
    if (userBtns) userBtns.style.display = 'none';
  }
}

// Auth functions
async function login(username, password) {
  const data = await api('/api/login', 'POST', { username, password });
  if (data.success) {
    authToken = data.token;
    localStorage.setItem('darkweb_token', data.token);
    currentUser = { username: data.username, is_admin: data.is_admin };
    updateUI();
    return { success: true, is_admin: data.is_admin };
  }
  return { success: false, error: data.error };
}

async function register(username, password) {
  const data = await api('/api/register', 'POST', { username, password });
  if (data.success) {
    authToken = data.token;
    localStorage.setItem('darkweb_token', data.token);
    currentUser = { username: data.username, is_admin: false };
    updateUI();
    return { success: true };
  }
  return { success: false, error: data.error };
}

async function logout() {
  await api('/api/logout', 'POST');
  authToken = null;
  currentUser = null;
  localStorage.removeItem('darkweb_token');
  updateUI();
  window.location.href = '/';
}

// Load sites
async function loadSites() {
  const sites = await api('/api/sites');
  const container = document.getElementById('sites-grid');
  if (!container) return;
  
  if (sites.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px">Aucun site pour le moment. Sois le premier a en creer un.</p>';
    return;
  }
  
  container.innerHTML = sites.map(site => `
    <div class="site-card">
      <div class="site-name">${escapeHtml(site.name)}</div>
      <div class="site-desc">${escapeHtml(site.description || 'Pas de description')}</div>
      <div class="site-meta">
        <span>${new Date(site.approved_at || site.created_at).toLocaleDateString('fr-FR')}</span>
        <a href="/site/${site.slug}" class="site-link" target="_blank">ACCEDER</a>
      </div>
    </div>
  `).join('');
}

// Load pending sites (admin)
async function loadPendingSites() {
  const sites = await api('/api/sites/pending');
  const container = document.getElementById('pending-sites');
  if (!container) return;
  
  if (sites.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px">Aucun site en attente.</p>';
    return;
  }
  
  container.innerHTML = sites.map(site => `
    <div class="admin-card">
      <div class="site-header">
        <div>
          <div class="site-name">${escapeHtml(site.name)}</div>
          <div style="color:var(--text-muted);font-size:0.75em">Par: ${escapeHtml(site.username || 'Anonyme')} | ${new Date(site.created_at).toLocaleDateString('fr-FR')}</div>
        </div>
        <span class="status-badge status-pending">EN ATTENTE</span>
      </div>
      <div class="site-desc">${escapeHtml(site.description || '')}</div>
      <iframe src="/site/${site.slug}" class="preview-frame" sandbox="allow-scripts"></iframe>
      <div class="actions">
        <button class="btn btn-approve" onclick="approveSite('${site.id}')">APPROUVER</button>
        <button class="btn btn-reject" onclick="rejectSite('${site.id}')">REJETER</button>
        <button class="btn btn-danger" onclick="deleteSite('${site.id}')">SUPPRIMER</button>
      </div>
    </div>
  `).join('');
}

// Load all sites (admin)
async function loadAllSitesAdmin() {
  const sites = await api('/api/sites/all');
  const container = document.getElementById('all-sites');
  if (!container) return;
  
  container.innerHTML = sites.map(site => `
    <div class="admin-card">
      <div class="site-header">
        <div>
          <div class="site-name">${escapeHtml(site.name)}</div>
          <div style="color:var(--text-muted);font-size:0.75em">Par: ${escapeHtml(site.username || 'Anonyme')} | ${new Date(site.created_at).toLocaleDateString('fr-FR')}</div>
        </div>
        <span class="status-badge status-${site.status}">${site.status.toUpperCase()}</span>
      </div>
      <div class="actions">
        ${site.status !== 'approved' ? `<button class="btn btn-approve" onclick="approveSite('${site.id}')">APPROUVER</button>` : ''}
        ${site.status !== 'rejected' ? `<button class="btn btn-reject" onclick="rejectSite('${site.id}')">REJETER</button>` : ''}
        <button class="btn btn-danger" onclick="deleteSite('${site.id}')">SUPPRIMER</button>
      </div>
    </div>
  `).join('');
}

// Admin actions
async function approveSite(id) {
  await api(`/api/sites/${id}/approve`, 'PUT');
  loadPendingSites();
  loadAllSitesAdmin();
}

async function rejectSite(id) {
  await api(`/api/sites/${id}/reject`, 'PUT');
  loadPendingSites();
  loadAllSitesAdmin();
}

async function deleteSite(id) {
  if (!confirm('Supprimer ce site definitivement ?')) return;
  await api(`/api/sites/${id}`, 'DELETE');
  loadPendingSites();
  loadAllSitesAdmin();
}

// Submit site
async function submitSite(name, description, html, css, js) {
  const data = await api('/api/sites', 'POST', {
    name,
    description,
    html_content: html,
    css_content: css,
    js_content: js
  });
  return data;
}

// Load stats
async function loadStats() {
  const stats = await api('/api/stats');
  const el = document.getElementById('stats');
  if (el && stats) {
    el.innerHTML = `
      <div class="stat"><div class="number">${stats.approvedSites}</div><div class="label">SITES ACTIFS</div></div>
      <div class="stat"><div class="number">${stats.pendingSites}</div><div class="label">EN ATTENTE</div></div>
      <div class="stat"><div class="number">${stats.totalUsers}</div><div class="label">UTILISATEURS</div></div>
    `;
  }
}

// Utility
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showAlert(container, message, type = 'error') {
  const el = document.getElementById(container);
  if (el) {
    el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    setTimeout(() => el.innerHTML = '', 5000);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  checkSession();
});
