let token = null;
let adminPath = null;
let currentPath = '';
let navigationHistory = [];
let historyIndex = -1;
let selectedFile = null;
let settings = {};
let siteFilesCurrentPath = '';
let currentSiteId = null;

// ============ INIT ============

function getAdminPathFromURL() {
  const parts = window.location.pathname.split('/').filter(p => p);
  return parts.length > 0 ? parts[0] : null;
}

adminPath = getAdminPathFromURL();

const loginScreen = document.getElementById('login-screen');
const adminScreen = document.getElementById('admin-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

// ============ TOAST ============

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  const msg = document.getElementById('toast-message');
  if (!toast || !msg) return;
  msg.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => { toast.className = 'toast hidden'; }, 3000);
}

// ============ API HELPER ============

async function api(endpoint, options = {}) {
  const url = `/${adminPath}/api${endpoint}`;
  const headers = { 'Authorization': `Bearer ${token}`, ...options.headers };
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(url, { ...options, headers });
  return response;
}

async function apiJSON(endpoint, options = {}) {
  const response = await api(endpoint, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ============ LOGIN ============

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  try {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const loginPath = pathParts[0] || '';
    if (!loginPath) { loginError.textContent = 'Invalid admin URL'; loginError.classList.add('show'); return; }

    const res = await fetch(`/${loginPath}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (res.ok) {
      token = data.token;
      adminPath = data.adminPath;
      localStorage.setItem('token', token);
      localStorage.setItem('adminPath', adminPath);
      showAdminScreen();
    } else {
      loginError.textContent = data.error;
      loginError.classList.add('show');
    }
  } catch (err) { loginError.textContent = 'Connection error'; loginError.classList.add('show'); }
});

// ============ ADMIN SCREEN ============

function showAdminScreen() {
  loginScreen.classList.remove('active');
  adminScreen.classList.add('active');

  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
    if (!localStorage.getItem('httpsWarningDismissed')) {
      document.getElementById('https-warning').classList.add('show');
      adminScreen.classList.add('has-warning');
    }
  }

  loadSettings();
  loadSystemInfo();
  startAutoRefresh();
}

document.getElementById('close-https-warning').addEventListener('click', () => {
  document.getElementById('https-warning').classList.remove('show');
  adminScreen.classList.remove('has-warning');
  localStorage.setItem('httpsWarningDismissed', 'true');
});

document.getElementById('logout-btn').addEventListener('click', () => {
  token = null; adminPath = null;
  localStorage.removeItem('token');
  localStorage.removeItem('adminPath');
  adminScreen.classList.remove('active');
  loginScreen.classList.add('active');
});

// ============ NAVIGATION ============

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');

    const tab = item.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(`${tab}-tab`).classList.add('active');

    switch (tab) {
      case 'files': loadFiles(); break;
      case 'settings': loadSettings(); break;
      case 'api': loadVariables(); break;
      case 'sites': loadSites(); break;
      case 'security': loadSecurity(); break;
      case 'ports': loadPorts(); loadActivePorts(); break;
    }
  });
});

// ============ SYSTEM INFO ============

async function loadSystemInfo() {
  try {
    const data = await apiJSON('/system');
    document.getElementById('cpu-usage').textContent = `${data.cpu.usage}%`;
    document.getElementById('cpu-model').textContent = `${data.cpu.cores} cores @ ${data.cpu.speed} GHz`;
    document.getElementById('memory-usage').textContent = `${data.memory.percentage}%`;
    document.getElementById('memory-total').textContent = `${data.memory.used} / ${data.memory.total} GB`;
    if (data.disk.length > 0) {
      document.getElementById('disk-usage').textContent = `${data.disk[0].percentage}%`;
      document.getElementById('disk-total').textContent = `${data.disk[0].used} / ${data.disk[0].size} GB`;
    }
    document.getElementById('uptime').textContent = `${data.os.uptime}h`;
    document.getElementById('os-info').textContent = `${data.os.distro} ${data.os.release}`;
    document.getElementById('hostname').textContent = data.os.hostname;
    document.getElementById('platform').textContent = data.os.platform;
    document.getElementById('processes').textContent = `${data.processes.running} running / ${data.processes.all} total`;
  } catch (e) { console.error('System info error:', e); }
}

let refreshInterval;
function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(() => {
    if (settings.autoRefresh !== false) loadSystemInfo();
  }, (settings.refreshInterval || 5) * 1000);
}

// ============ FILE MANAGER ============

async function loadFiles(filePath) {
  const filesList = document.getElementById('files-list');
  filesList.innerHTML = '<div class="loading">Loading files...</div>';

  try {
    const url = filePath ? `/files?path=${encodeURIComponent(filePath)}` : '/files';
    const data = await apiJSON(url);

    currentPath = data.currentPath;

    if (historyIndex === -1 || navigationHistory[historyIndex] !== currentPath) {
      navigationHistory = navigationHistory.slice(0, historyIndex + 1);
      navigationHistory.push(currentPath);
      historyIndex = navigationHistory.length - 1;
    }

    updateBreadcrumb(currentPath);

    if (data.files.length === 0) {
      filesList.innerHTML = '<div class="empty-state"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><p>Empty folder</p></div>';
      return;
    }

    const folders = data.files.filter(f => f.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    const files = data.files.filter(f => !f.isDirectory).sort((a, b) => a.name.localeCompare(b.name));

    filesList.innerHTML = [...folders, ...files].map(file => {
      const escapedPath = file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      return `
        <div class="file-item" ondblclick="${file.isDirectory ? `loadFiles('${escapedPath}')` : ''}">
          <div class="file-icon">
            ${file.isDirectory ?
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' :
              '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
            }
          </div>
          <div class="file-info" style="flex:1;min-width:0;">
            <div class="file-name">${file.name}</div>
            <div class="file-meta">${file.isDirectory ? 'Folder' : formatBytes(file.size)} • ${formatDate(file.modified)}</div>
          </div>
          <div class="file-actions" style="display:flex;gap:0.25rem;">
            <button class="btn-icon" onclick="deleteFile('${escapedPath}', event)" title="Delete">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    filesList.innerHTML = `<div class="loading">Failed to load files: ${e.message}</div>`;
  }
}

function updateBreadcrumb(p) {
  document.getElementById('path-breadcrumb').textContent = p;
}

document.getElementById('refresh-files').addEventListener('click', () => loadFiles(currentPath));
document.getElementById('back-btn').addEventListener('click', () => {
  if (historyIndex > 0) { historyIndex--; loadFiles(navigationHistory[historyIndex]); }
});
document.getElementById('forward-btn').addEventListener('click', () => {
  if (historyIndex < navigationHistory.length - 1) { historyIndex++; loadFiles(navigationHistory[historyIndex]); }
});
document.getElementById('up-btn').addEventListener('click', () => {
  const parts = currentPath.split('/');
  if (parts.length > 2) { parts.pop(); loadFiles(parts.join('/')); }
});
document.getElementById('home-btn').addEventListener('click', () => loadFiles());

document.getElementById('new-folder-btn').addEventListener('click', async () => {
  const name = prompt('Folder name:');
  if (!name) return;
  try {
    await apiJSON('/files/create-folder', { method: 'POST', body: { name, currentPath } });
    loadFiles(currentPath);
    showToast('Folder created', 'success');
  } catch (e) { showToast('Failed to create folder', 'error'); }
});

async function deleteFile(filePath, event) {
  if (event) event.stopPropagation();
  if (!confirm('Delete this item?')) return;
  try {
    await apiJSON('/files', { method: 'DELETE', body: { path: filePath } });
    loadFiles(currentPath);
    showToast('Deleted', 'success');
  } catch (e) { showToast('Failed to delete', 'error'); }
}

// ============ UPLOAD ============

const uploadModal = document.getElementById('upload-modal');
document.getElementById('upload-file-btn').addEventListener('click', () => {
  uploadModal.classList.add('active');
  document.getElementById('upload-result-modal').classList.add('hidden');
  document.getElementById('upload-progress').classList.add('hidden');
  document.getElementById('start-upload-btn').disabled = true;
  selectedFile = null;
  const dz = document.getElementById('dropzone-modal');
  dz.innerHTML = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><p>Drag & drop or click to select file</p>';
});

document.getElementById('close-upload-modal').addEventListener('click', () => uploadModal.classList.remove('active'));

const dropzone = document.getElementById('dropzone-modal');
const fileInput = document.getElementById('file-input-modal');
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('dragover'); if (e.dataTransfer.files[0]) selectFile(e.dataTransfer.files[0]); });
fileInput.addEventListener('change', (e) => { if (e.target.files[0]) selectFile(e.target.files[0]); });

function selectFile(file) {
  selectedFile = file;
  dropzone.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg><p><strong>${file.name}</strong></p><p>${formatBytes(file.size)}</p>`;
  document.getElementById('start-upload-btn').disabled = false;
}

document.getElementById('start-upload-btn').addEventListener('click', async () => {
  if (!selectedFile) return;
  const formData = new FormData();
  formData.append('file', selectedFile);
  const pw = document.getElementById('upload-password-modal').value;
  if (pw) formData.append('password', pw);

  document.getElementById('upload-progress').classList.remove('hidden');
  const xhr = new XMLHttpRequest();
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = (e.loaded / e.total) * 100;
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('progress-text').textContent = `Uploading... ${Math.round(pct)}%`;
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200) {
      const data = JSON.parse(xhr.responseText);
      document.getElementById('download-url-modal').value = data.downloadUrl;
      document.getElementById('upload-result-modal').classList.remove('hidden');
      document.getElementById('upload-progress').classList.add('hidden');
      loadFiles(currentPath);
      showToast('File uploaded!', 'success');
    } else {
      showToast('Upload failed', 'error');
      document.getElementById('upload-progress').classList.add('hidden');
    }
  };
  xhr.open('POST', `/${adminPath}/api/upload`);
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.send(formData);
});

document.getElementById('copy-url-modal').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('download-url-modal').value);
  showToast('URL copied!', 'success');
});

// ============ SETTINGS ============

async function loadSettings() {
  try {
    settings = await apiJSON('/settings');
    document.getElementById('setting-theme').value = settings.theme || 'light';
    document.getElementById('setting-compact').checked = settings.compactMode || false;
    document.getElementById('setting-autorefresh').checked = settings.autoRefresh !== false;
    document.getElementById('setting-interval').value = settings.refreshInterval || 5;
    document.getElementById('setting-hidden').checked = settings.showHiddenFiles || false;
    document.getElementById('setting-dateformat').value = settings.dateFormat || 'locale';
    document.getElementById('setting-maxupload').value = settings.maxUploadSize || 100;
    document.getElementById('setting-notifications').checked = settings.notifications !== false;
    document.getElementById('setting-sounds').checked = settings.soundEffects || false;
    document.getElementById('setting-timeout').value = settings.sessionTimeout || 60;
    document.getElementById('setting-language').value = settings.language || 'en';
    applySettings(settings);
  } catch (e) { console.error('Settings error:', e); }
}

document.getElementById('save-settings').addEventListener('click', async () => {
  settings = {
    theme: document.getElementById('setting-theme').value,
    compactMode: document.getElementById('setting-compact').checked,
    autoRefresh: document.getElementById('setting-autorefresh').checked,
    refreshInterval: parseInt(document.getElementById('setting-interval').value),
    showHiddenFiles: document.getElementById('setting-hidden').checked,
    dateFormat: document.getElementById('setting-dateformat').value,
    maxUploadSize: parseInt(document.getElementById('setting-maxupload').value),
    notifications: document.getElementById('setting-notifications').checked,
    soundEffects: document.getElementById('setting-sounds').checked,
    sessionTimeout: parseInt(document.getElementById('setting-timeout').value),
    language: document.getElementById('setting-language').value
  };
  try {
    await apiJSON('/settings', { method: 'POST', body: settings });
    applySettings(settings);
    showToast('Settings saved!', 'success');
  } catch (e) { showToast('Failed to save settings', 'error'); }
});

function applySettings(s) {
  document.body.classList.toggle('dark-theme', s.theme === 'dark');
  document.body.classList.toggle('compact-mode', s.compactMode);
}

// ============ API VARIABLES ============

const variableModal = document.getElementById('variable-modal');
const commitModal = document.getElementById('commit-modal');

document.getElementById('create-variable-btn').addEventListener('click', () => {
  variableModal.classList.add('active');
  document.getElementById('variable-result').classList.add('hidden');
  ['var-name', 'var-value', 'var-version', 'var-password'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('var-redirect-delay').value = '5';
});

document.getElementById('close-variable-modal').addEventListener('click', () => variableModal.classList.remove('active'));
document.getElementById('close-commit-modal').addEventListener('click', () => commitModal.classList.remove('active'));

document.getElementById('create-variable-submit').addEventListener('click', async () => {
  const name = document.getElementById('var-name').value;
  const value = document.getElementById('var-value').value;
  const version = document.getElementById('var-version').value;
  const password = document.getElementById('var-password').value;
  const redirectDelay = parseInt(document.getElementById('var-redirect-delay').value);
  if (!name || !value || !version) { showToast('Fill all required fields', 'error'); return; }

  try {
    const data = await apiJSON('/variables', { method: 'POST', body: { name, value, version, password, redirectDelay } });
    const url = password ? `${data.url}?password=${encodeURIComponent(password)}` : data.url;
    document.getElementById('variable-url').value = url;
    document.getElementById('variable-result').classList.remove('hidden');
    loadVariables();
    showToast('Variable created!', 'success');
  } catch (e) { showToast('Failed to create variable', 'error'); }
});

document.getElementById('copy-variable-url').addEventListener('click', () => {
  navigator.clipboard.writeText(document.getElementById('variable-url').value);
  showToast('URL copied!', 'success');
});

async function loadVariables() {
  const list = document.getElementById('variables-list');
  list.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const variables = await apiJSON('/variables');
    const entries = Object.entries(variables);

    if (entries.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No variables. Create your first one!</p></div>';
      return;
    }

    list.innerHTML = entries.map(([id, v]) => {
      const baseUrl = `${location.protocol}//${location.host}/api/v/${id}`;
      const versionUrl = `${baseUrl}/version/${v.version}`;
      return `
        <div class="variable-card">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:1rem;">
            <div>
              <h3>${v.name}</h3>
              <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem;">
                <span class="meta-badge">v${v.version}</span>
                ${v.password ? '<span class="meta-badge">🔒 Protected</span>' : ''}
                <span class="meta-badge">${v.commits.length} commits</span>
              </div>
            </div>
            <div style="display:flex;gap:0.5rem;">
              <button class="btn-secondary" onclick="openCommitModal('${id}')">Commit</button>
              <button class="btn-icon" onclick="deleteVariable('${id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
            </div>
          </div>
          <div class="variable-value">${v.value}</div>
          <div class="variable-url-section">
            <label>API URL:</label>
            <div class="url-container">
              <input type="text" value="${baseUrl}" readonly>
              <button class="btn-copy" onclick="copyToClipboard('${baseUrl}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            </div>
          </div>
          <div class="variable-url-section">
            <label>Version URL:</label>
            <div class="url-container">
              <input type="text" value="${versionUrl}" readonly>
              <button class="btn-copy" onclick="copyToClipboard('${versionUrl}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            </div>
          </div>
          <details style="margin-top:1rem;">
            <summary style="cursor:pointer;color:var(--text-secondary);font-size:0.9rem;">Commit History (${v.commits.length})</summary>
            <div style="margin-top:0.5rem;">
              ${v.commits.slice().reverse().map(c => `<div style="display:flex;justify-content:space-between;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.85rem;"><span class="meta-badge">v${c.version}</span><span style="color:var(--text-secondary)">${new Date(c.timestamp).toLocaleString()}</span></div>`).join('')}
            </div>
          </details>
        </div>`;
    }).join('');
  } catch (e) { list.innerHTML = '<div class="loading">Failed to load variables</div>'; }
}

function openCommitModal(id) {
  document.getElementById('commit-var-id').value = id;
  document.getElementById('commit-value').value = '';
  document.getElementById('commit-version').value = '';
  commitModal.classList.add('active');
}

document.getElementById('commit-submit').addEventListener('click', async () => {
  const id = document.getElementById('commit-var-id').value;
  const value = document.getElementById('commit-value').value;
  const version = document.getElementById('commit-version').value;
  if (!value || !version) { showToast('Fill all fields', 'error'); return; }
  try {
    await apiJSON(`/variables/${id}/commit`, { method: 'POST', body: { value, version } });
    commitModal.classList.remove('active');
    loadVariables();
    showToast('Version committed!', 'success');
  } catch (e) { showToast('Failed to commit', 'error'); }
});

async function deleteVariable(id) {
  if (!confirm('Delete this variable?')) return;
  try { await apiJSON(`/variables/${id}`, { method: 'DELETE' }); loadVariables(); showToast('Deleted', 'success'); }
  catch (e) { showToast('Failed to delete', 'error'); }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text);
  showToast('Copied!', 'success');
}

// ============ SITES ============

const siteModal = document.getElementById('site-modal');
const siteFilesModal = document.getElementById('site-files-modal');
const fileEditorModal = document.getElementById('file-editor-modal');

document.getElementById('create-site-btn').addEventListener('click', () => siteModal.classList.add('active'));
document.getElementById('close-site-modal').addEventListener('click', () => siteModal.classList.remove('active'));
document.getElementById('close-site-files-modal').addEventListener('click', () => siteFilesModal.classList.remove('active'));
document.getElementById('close-file-editor-modal').addEventListener('click', () => fileEditorModal.classList.remove('active'));

document.getElementById('create-site-submit').addEventListener('click', async () => {
  const name = document.getElementById('site-name').value;
  const type = document.getElementById('site-type').value;
  const port = document.getElementById('site-port').value;
  const domain = document.getElementById('site-domain').value;
  if (!name || !port) { showToast('Fill required fields', 'error'); return; }

  try {
    await apiJSON('/sites', { method: 'POST', body: { name, type, port: parseInt(port), domain } });
    siteModal.classList.remove('active');
    loadSites();
    showToast('Site created!', 'success');
  } catch (e) { showToast('Failed to create site', 'error'); }
});

async function loadSites() {
  const list = document.getElementById('sites-list');
  list.innerHTML = '<div class="loading">Loading sites...</div>';

  try {
    const sites = await apiJSON('/sites');
    const arr = Object.values(sites);

    if (arr.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No sites. Create your first one!</p></div>';
      return;
    }

    list.innerHTML = arr.map(site => `
      <div class="site-card">
        <div class="site-header">
          <div class="site-info">
            <h3>${site.name}</h3>
            <div class="site-meta">
              <span class="meta-badge">${site.type}</span>
              <span class="meta-badge">:${site.port}</span>
              <span class="meta-badge status-${site.status}">${site.status}</span>
              ${site.domain ? `<span class="meta-badge">${site.domain}</span>` : ''}
            </div>
          </div>
          <div class="site-actions">
            ${site.status === 'stopped' ?
              `<button class="btn-primary" onclick="startSite('${site.id}')">▶ Start</button>` :
              `<button class="btn-secondary" onclick="stopSite('${site.id}')" style="border-color:#ef4444;color:#ef4444;">■ Stop</button>`
            }
            <button class="btn-secondary" onclick="openSiteFiles('${site.id}','${site.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}','${site.name}')">📁 Files</button>
            <button class="btn-secondary" onclick="openSiteTerminal('${site.id}','${site.name}')">💻 Terminal</button>
            ${site.status === 'running' ? `<a href="http://${location.hostname}:${site.port}" target="_blank" class="btn-secondary">🌐 Open</a>` : ''}
            <button class="btn-icon" onclick="deleteSite('${site.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
        <div class="site-path">📂 ${site.path}</div>
      </div>
    `).join('');
  } catch (e) { list.innerHTML = '<div class="loading">Failed to load sites</div>'; }
}

async function startSite(id) {
  try {
    showToast('Starting site...', 'info');
    const data = await apiJSON(`/sites/${id}/start`, { method: 'POST' });
    showToast(data.message || 'Site started!', 'success');
    loadSites();
  } catch (e) { showToast('Failed: ' + e.message, 'error'); }
}

async function stopSite(id) {
  try {
    await apiJSON(`/sites/${id}/stop`, { method: 'POST' });
    showToast('Site stopped', 'success');
    loadSites();
  } catch (e) { showToast('Failed to stop site', 'error'); }
}

async function deleteSite(id) {
  if (!confirm('Delete this site and all its files?')) return;
  try { await apiJSON(`/sites/${id}`, { method: 'DELETE' }); loadSites(); showToast('Deleted', 'success'); }
  catch (e) { showToast('Failed to delete', 'error'); }
}

// ============ SITE FILES ============

async function openSiteFiles(siteId, sitePath, siteName) {
  currentSiteId = siteId;
  siteFilesCurrentPath = sitePath;
  document.getElementById('site-files-title').textContent = `📁 ${siteName}`;
  siteFilesModal.classList.add('active');
  loadSiteFiles(sitePath);
}

async function loadSiteFiles(dirPath) {
  const list = document.getElementById('site-files-list');
  list.innerHTML = '<div class="loading">Loading...</div>';
  siteFilesCurrentPath = dirPath;
  document.getElementById('site-files-path').textContent = dirPath;

  try {
    const data = await apiJSON(`/files?path=${encodeURIComponent(dirPath)}`);

    if (data.files.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>Empty folder</p></div>';
      return;
    }

    const folders = data.files.filter(f => f.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    const files = data.files.filter(f => !f.isDirectory).sort((a, b) => a.name.localeCompare(b.name));

    list.innerHTML = [...folders, ...files].map(file => {
      const escapedPath = file.path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const isEditable = !file.isDirectory && isTextFile(file.name);
      return `
        <div class="site-file-item" ${file.isDirectory ? `ondblclick="loadSiteFiles('${escapedPath}')"` : ''}>
          <div class="file-info">
            <div class="file-icon ${file.isDirectory ? 'folder' : 'file'}">
              ${file.isDirectory ?
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>' :
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>'
              }
            </div>
            <span class="file-name">${file.name}</span>
          </div>
          <span class="file-meta">${file.isDirectory ? '' : formatBytes(file.size)}</span>
          <div class="file-actions">
            ${isEditable ? `<button class="btn-icon-small" onclick="editFile('${escapedPath}','${file.name}')" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>` : ''}
            <button class="btn-icon-small danger" onclick="deleteSiteFile('${escapedPath}', event)" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>`;
    }).join('');
  } catch (e) { list.innerHTML = `<div class="loading">Error: ${e.message}</div>`; }
}

function isTextFile(name) {
  const exts = ['.html','.htm','.css','.js','.jsx','.ts','.tsx','.json','.md','.txt','.py','.php','.rb','.go','.rs','.java','.vue','.svelte','.yaml','.yml','.xml','.env','.gitignore','.sh','.bat','.conf','.cfg','.ini','.toml','.sql','.csv','.log','.htaccess'];
  return exts.some(ext => name.toLowerCase().endsWith(ext));
}

document.getElementById('site-files-back').addEventListener('click', () => {
  const parent = siteFilesCurrentPath.split('/').slice(0, -1).join('/');
  if (parent) loadSiteFiles(parent);
});

document.getElementById('site-files-up').addEventListener('click', () => {
  const parent = siteFilesCurrentPath.split('/').slice(0, -1).join('/');
  if (parent) loadSiteFiles(parent);
});

document.getElementById('site-files-new-folder').addEventListener('click', async () => {
  const name = prompt('Folder name:');
  if (!name) return;
  try {
    await apiJSON('/files/create-folder', { method: 'POST', body: { name, currentPath: siteFilesCurrentPath } });
    loadSiteFiles(siteFilesCurrentPath);
    showToast('Folder created', 'success');
  } catch (e) { showToast('Failed', 'error'); }
});

document.getElementById('site-files-new-file').addEventListener('click', async () => {
  const name = prompt('File name (e.g., script.js):');
  if (!name) return;
  try {
    await apiJSON('/files/create-file', { method: 'POST', body: { name, currentPath: siteFilesCurrentPath, content: '' } });
    loadSiteFiles(siteFilesCurrentPath);
    showToast('File created', 'success');
  } catch (e) { showToast('Failed', 'error'); }
});

document.getElementById('site-files-upload').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = async (e) => {
    for (const file of e.target.files) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('targetPath', siteFilesCurrentPath);
      try {
        await fetch(`/${adminPath}/api/sites/upload`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` },
          body: formData
        });
      } catch (err) { showToast(`Failed to upload ${file.name}`, 'error'); }
    }
    loadSiteFiles(siteFilesCurrentPath);
    showToast('Files uploaded!', 'success');
  };
  input.click();
});

async function deleteSiteFile(filePath, event) {
  if (event) event.stopPropagation();
  if (!confirm('Delete this item?')) return;
  try {
    await apiJSON('/files', { method: 'DELETE', body: { path: filePath } });
    loadSiteFiles(siteFilesCurrentPath);
    showToast('Deleted', 'success');
  } catch (e) { showToast('Failed to delete', 'error'); }
}

// ============ FILE EDITOR ============

async function editFile(filePath, fileName) {
  try {
    const data = await apiJSON(`/files/content?path=${encodeURIComponent(filePath)}`);
    document.getElementById('file-editor-title').textContent = `✏️ ${fileName}`;
    document.getElementById('editor-file-path').value = filePath;
    document.getElementById('file-editor-content').value = data.content;
    fileEditorModal.classList.add('active');
  } catch (e) { showToast('Failed to open file: ' + e.message, 'error'); }
}

document.getElementById('save-file-btn').addEventListener('click', async () => {
  const filePath = document.getElementById('editor-file-path').value;
  const content = document.getElementById('file-editor-content').value;
  try {
    await apiJSON('/files/content', { method: 'POST', body: { path: filePath, content } });
    showToast('File saved!', 'success');
    fileEditorModal.classList.remove('active');
    loadSiteFiles(siteFilesCurrentPath);
  } catch (e) { showToast('Failed to save', 'error'); }
});

document.getElementById('cancel-edit-btn').addEventListener('click', () => {
  fileEditorModal.classList.remove('active');
});

// Tab support in editor
document.getElementById('file-editor-content').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const ta = e.target;
    const start = ta.selectionStart;
    ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(ta.selectionEnd);
    ta.selectionStart = ta.selectionEnd = start + 2;
  }
});

// ============ SITE TERMINAL ============

function openSiteTerminal(siteId, siteName) {
  currentSiteId = siteId;

  // Create terminal modal if not exists
  let modal = document.getElementById('terminal-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'terminal-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content modal-large">
        <div class="modal-header">
          <h3 id="terminal-title">Terminal</h3>
          <button class="modal-close" onclick="document.getElementById('terminal-modal').classList.remove('active')">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">
          <div id="terminal-output" style="background:#0f172a;color:#e2e8f0;font-family:'Courier New',monospace;font-size:0.85rem;padding:1rem;border-radius:8px;min-height:300px;max-height:400px;overflow-y:auto;margin-bottom:1rem;white-space:pre-wrap;word-break:break-all;">Welcome to Welizium Terminal\n$ </div>
          <div style="display:flex;gap:0.5rem;">
            <input type="text" id="terminal-input" placeholder="Enter command (npm install, npm run dev, etc.)" style="flex:1;padding:0.75rem 1rem;border:1px solid var(--border);border-radius:8px;font-family:monospace;font-size:0.9rem;">
            <button class="btn-primary" id="terminal-run">Run</button>
          </div>
          <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap;">
            <button class="btn-secondary" onclick="terminalCmd('npm install')">npm install</button>
            <button class="btn-secondary" onclick="terminalCmd('npm run dev')">npm run dev</button>
            <button class="btn-secondary" onclick="terminalCmd('npm run build')">npm run build</button>
            <button class="btn-secondary" onclick="terminalCmd('npm start')">npm start</button>
            <button class="btn-secondary" onclick="terminalCmd('ls -la')">ls -la</button>
            <button class="btn-secondary" onclick="terminalCmd('cat package.json')">package.json</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    document.getElementById('terminal-run').addEventListener('click', () => {
      terminalCmd(document.getElementById('terminal-input').value);
    });

    document.getElementById('terminal-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') terminalCmd(document.getElementById('terminal-input').value);
    });
  }

  document.getElementById('terminal-title').textContent = `💻 Terminal — ${siteName}`;
  document.getElementById('terminal-output').textContent = `Welcome to Welizium Terminal\nSite: ${siteName}\n$ `;
  modal.classList.add('active');
}

async function terminalCmd(command) {
  if (!command || !currentSiteId) return;
  const output = document.getElementById('terminal-output');
  const input = document.getElementById('terminal-input');
  input.value = '';

  output.textContent += `${command}\n`;
  output.textContent += '⏳ Running...\n';
  output.scrollTop = output.scrollHeight;

  try {
    const res = await fetch(`/${adminPath}/api/sites/${currentSiteId}/exec`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ command })
    });
    const data = await res.json();

    if (data.stdout) output.textContent += data.stdout + '\n';
    if (data.stderr) output.textContent += data.stderr + '\n';
    if (!data.success) output.textContent += `❌ Exit code: ${data.exitCode || 'error'}\n`;
    else output.textContent += '✅ Done\n';
  } catch (e) {
    output.textContent += `❌ Error: ${e.message}\n`;
  }

  output.textContent += '$ ';
  output.scrollTop = output.scrollHeight;
}

// ============ SECURITY ============

async function loadSecurity() {
  try {
    const s = await apiJSON('/security');
    document.getElementById('security-2fa').checked = s.twoFactor || false;
    document.getElementById('security-session-timeout').value = s.sessionTimeout || 60;
    document.getElementById('security-max-attempts').value = s.maxAttempts || 5;
    document.getElementById('security-force-https').checked = s.forceHttps || false;
    document.getElementById('security-hsts').checked = s.hsts || false;
    document.getElementById('security-firewall').checked = s.firewall !== false;
    document.getElementById('security-block-suspicious').checked = s.blockSuspicious !== false;

    const ipList = document.getElementById('ip-list');
    if (s.ipWhitelist && s.ipWhitelist.length > 0) {
      ipList.innerHTML = s.ipWhitelist.map(ip => `
        <div class="ip-item"><span>${ip}</span><button class="btn-icon" onclick="removeIP('${ip}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
    } else {
      ipList.innerHTML = '<p style="color:var(--text-secondary);padding:1rem;">No IPs in whitelist</p>';
    }
  } catch (e) { console.error('Security load error:', e); }
}

document.getElementById('add-ip-btn').addEventListener('click', async () => {
  const ip = document.getElementById('ip-input').value.trim();
  if (!ip) return;
  try {
    const s = await apiJSON('/security');
    if (!s.ipWhitelist) s.ipWhitelist = [];
    if (!s.ipWhitelist.includes(ip)) {
      s.ipWhitelist.push(ip);
      await apiJSON('/security', { method: 'POST', body: s });
      document.getElementById('ip-input').value = '';
      loadSecurity();
    }
  } catch (e) { showToast('Failed to add IP', 'error'); }
});

async function removeIP(ip) {
  try {
    const s = await apiJSON('/security');
    s.ipWhitelist = (s.ipWhitelist || []).filter(i => i !== ip);
    await apiJSON('/security', { method: 'POST', body: s });
    loadSecurity();
  } catch (e) { showToast('Failed', 'error'); }
}

document.getElementById('save-security').addEventListener('click', async () => {
  const current = await apiJSON('/security');
  const s = {
    twoFactor: document.getElementById('security-2fa').checked,
    sessionTimeout: parseInt(document.getElementById('security-session-timeout').value),
    maxAttempts: parseInt(document.getElementById('security-max-attempts').value),
    forceHttps: document.getElementById('security-force-https').checked,
    hsts: document.getElementById('security-hsts').checked,
    firewall: document.getElementById('security-firewall').checked,
    blockSuspicious: document.getElementById('security-block-suspicious').checked,
    ipWhitelist: current.ipWhitelist || []
  };
  try {
    await apiJSON('/security', { method: 'POST', body: s });
    showToast('Security settings saved!', 'success');
  } catch (e) { showToast('Failed to save', 'error'); }
});

// ============ PORTS ============

const portModal = document.getElementById('port-modal');
document.getElementById('add-port-btn').addEventListener('click', () => portModal.classList.add('active'));
document.getElementById('close-port-modal').addEventListener('click', () => portModal.classList.remove('active'));

document.getElementById('add-port-submit').addEventListener('click', async () => {
  const port = document.getElementById('port-number').value;
  const protocol = document.getElementById('port-protocol').value;
  const action = document.getElementById('port-action').value;
  const description = document.getElementById('port-description').value;
  if (!port) { showToast('Enter port number', 'error'); return; }

  try {
    await apiJSON('/ports', { method: 'POST', body: { port: parseInt(port), protocol, action, description } });
    portModal.classList.remove('active');
    loadPorts();
    document.getElementById('port-number').value = '';
    document.getElementById('port-description').value = '';
    showToast('Port rule added', 'success');
  } catch (e) { showToast('Failed', 'error'); }
});

async function loadPorts() {
  const list = document.getElementById('ports-list');
  list.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const ports = await apiJSON('/ports');
    const arr = Object.values(ports);

    if (arr.length === 0) {
      list.innerHTML = '<div class="empty-state"><p>No firewall rules</p></div>';
      return;
    }

    list.innerHTML = arr.map(rule => `
      <div class="port-card">
        <div class="port-header">
          <div class="port-info">
            <h3>Port ${rule.port}</h3>
            <div class="port-meta">
              <span class="meta-badge">${rule.protocol.toUpperCase()}</span>
              <span class="meta-badge action-${rule.action}">${rule.action.toUpperCase()}</span>
              <span class="meta-badge status-${rule.enabled ? 'running' : 'stopped'}">${rule.enabled ? 'Enabled' : 'Disabled'}</span>
              <span class="meta-badge">${rule.applied ? '✅ Applied' : '⚪ Not applied'}</span>
              ${rule.method ? `<span class="meta-badge">${rule.method}</span>` : ''}
            </div>
            ${rule.description ? `<p class="port-description">${rule.description}</p>` : ''}
          </div>
          <div class="port-actions">
            ${!rule.applied ?
              `<button class="btn-primary" onclick="applyPortRule('${rule.id}')" style="font-size:0.8rem;">Apply Rule</button>` :
              `<button class="btn-secondary" onclick="removePortRule('${rule.id}')" style="font-size:0.8rem;">Remove Rule</button>`
            }
            <button class="btn-secondary" onclick="togglePort('${rule.id}')" style="font-size:0.8rem;">${rule.enabled ? 'Disable' : 'Enable'}</button>
            <button class="btn-icon" onclick="deletePort('${rule.id}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = '<div class="loading">Failed to load ports</div>'; }
}

async function loadActivePorts() {
  const list = document.getElementById('active-ports-list');
  list.innerHTML = '<div class="loading">Scanning...</div>';
  try {
    const res = await fetch(`/${adminPath}/api/ports/active`, { headers: { 'Authorization': `Bearer ${token}` } });
    const ports = await res.json();
    if (ports.length === 0) { list.innerHTML = '<div class="empty-state"><p>No active ports</p></div>'; return; }
    list.innerHTML = ports.map(p => `
      <div class="port-card" style="padding:1rem;margin-bottom:0.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>:${p.port}</strong>
            <div style="display:flex;gap:0.5rem;margin-top:0.25rem;">
              <span class="meta-badge">${p.protocol.toUpperCase()}</span>
              <span class="meta-badge status-running">${p.state}</span>
              <span class="meta-badge">${p.process}</span>
            </div>
          </div>
        </div>
      </div>`).join('');
  } catch (e) { list.innerHTML = '<div class="loading">Failed to scan</div>'; }
}

async function applyPortRule(id) {
  try {
    const data = await apiJSON(`/ports/${id}/apply`, { method: 'POST' });
    if (data.success) showToast(`Rule applied via ${data.method}`, 'success');
    else showToast(data.error || 'Failed — need root privileges', 'error');
    loadPorts();
  } catch (e) { showToast('Failed: ' + e.message, 'error'); }
}

async function removePortRule(id) {
  try {
    await apiJSON(`/ports/${id}/remove-rule`, { method: 'POST' });
    showToast('Rule removed', 'success');
    loadPorts();
  } catch (e) { showToast('Failed', 'error'); }
}

async function togglePort(id) {
  try { await apiJSON(`/ports/${id}/toggle`, { method: 'POST' }); loadPorts(); }
  catch (e) { showToast('Failed', 'error'); }
}

async function deletePort(id) {
  if (!confirm('Delete this port rule?')) return;
  try { await apiJSON(`/ports/${id}`, { method: 'DELETE' }); loadPorts(); showToast('Deleted', 'success'); }
  catch (e) { showToast('Failed', 'error'); }
}

document.getElementById('refresh-ports-btn').addEventListener('click', () => { loadPorts(); loadActivePorts(); });

// ============ UTILS ============

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

function formatDate(date) {
  return new Date(date).toLocaleString();
}

// ============ AUTO LOGIN ============

const savedToken = localStorage.getItem('token');
const savedAdminPath = localStorage.getItem('adminPath');
const pathParts = window.location.pathname.split('/').filter(p => p);
const urlPath = pathParts[0] || '';

if (!urlPath) {
  loginError.textContent = 'Invalid URL.';
  loginError.classList.add('show');
  document.getElementById('username').disabled = true;
  document.getElementById('password').disabled = true;
  document.querySelector('.btn-login').disabled = true;
} else if (savedToken && savedAdminPath && urlPath === savedAdminPath) {
  token = savedToken;
  adminPath = savedAdminPath;
  showAdminScreen();
}
