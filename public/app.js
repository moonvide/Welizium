let token = null;
let adminPath = null;
let currentPath = '';
let navigationHistory = [];
let historyIndex = -1;
let selectedFile = null;
let settings = {};

function getAdminPathFromURL() {
  const pathParts = window.location.pathname.split('/').filter(p => p);
  return pathParts.length > 0 ? pathParts[0] : null;
}

adminPath = getAdminPathFromURL();

const loginScreen = document.getElementById('login-screen');
const adminScreen = document.getElementById('admin-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const uploadModal = document.getElementById('upload-modal');

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  
  try {
    const pathParts = window.location.pathname.split('/').filter(p => p);
    const loginPath = pathParts.length > 0 ? pathParts[0] : '';
    
    if (!loginPath) {
      loginError.textContent = 'Invalid admin URL';
      loginError.classList.add('show');
      return;
    }
    
    const response = await fetch(`/${loginPath}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      token = data.token;
      adminPath = data.adminPath;
      localStorage.setItem('token', token);
      localStorage.setItem('adminPath', adminPath);
      showAdminScreen();
    } else {
      loginError.textContent = data.error;
      loginError.classList.add('show');
    }
  } catch (error) {
    loginError.textContent = 'Connection error';
    loginError.classList.add('show');
  }
});

function showAdminScreen() {
  loginScreen.classList.remove('active');
  adminScreen.classList.add('active');
  
  if (window.location.protocol === 'http:' && window.location.hostname !== 'localhost') {
    const httpsWarningDismissed = localStorage.getItem('httpsWarningDismissed');
    if (!httpsWarningDismissed) {
      const httpsWarning = document.getElementById('https-warning');
      httpsWarning.classList.add('show');
      adminScreen.classList.add('has-warning');
    }
  }
  
  loadSettings();
  loadSystemInfo();
  startAutoRefresh();
}

document.getElementById('close-https-warning').addEventListener('click', () => {
  const httpsWarning = document.getElementById('https-warning');
  httpsWarning.classList.remove('show');
  adminScreen.classList.remove('has-warning');
  localStorage.setItem('httpsWarningDismissed', 'true');
});

document.getElementById('logout-btn').addEventListener('click', () => {
  token = null;
  adminPath = null;
  localStorage.removeItem('token');
  localStorage.removeItem('adminPath');
  adminScreen.classList.remove('active');
  loginScreen.classList.add('active');
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    
    const tab = item.dataset.tab;
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(`${tab}-tab`).classList.add('active');
    
    if (tab === 'files') {
      loadFiles();
    } else if (tab === 'settings') {
      loadSettings();
    }
  });
});

async function loadSystemInfo() {
  try {
    const response = await fetch(`/${adminPath}/api/system`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    
    document.getElementById('cpu-usage').textContent = `${data.cpu.usage}%`;
    document.getElementById('cpu-model').textContent = `${data.cpu.cores} cores @ ${data.cpu.speed} GHz`;
    
    document.getElementById('memory-usage').textContent = `${data.memory.percentage}%`;
    document.getElementById('memory-total').textContent = `${data.memory.used} GB / ${data.memory.total} GB`;
    
    if (data.disk.length > 0) {
      document.getElementById('disk-usage').textContent = `${data.disk[0].percentage}%`;
      document.getElementById('disk-total').textContent = `${data.disk[0].used} GB / ${data.disk[0].size} GB`;
    }
    
    document.getElementById('uptime').textContent = `${data.os.uptime} hours`;
    document.getElementById('os-info').textContent = `${data.os.distro} ${data.os.release}`;
    
    document.getElementById('hostname').textContent = data.os.hostname;
    document.getElementById('platform').textContent = data.os.platform;
    document.getElementById('processes').textContent = `${data.processes.running} running / ${data.processes.all} total`;
  } catch (error) {
    console.error('Failed to load system info:', error);
  }
}

function startAutoRefresh() {
  setInterval(() => {
    if (settings.autoRefresh !== false) {
      loadSystemInfo();
    }
  }, (settings.refreshInterval || 5) * 1000);
}

async function loadFiles(path = '') {
  const filesList = document.getElementById('files-list');
  filesList.innerHTML = '<div class="loading">Loading files...</div>';
  
  try {
    const url = path ? `/${adminPath}/api/files?path=${encodeURIComponent(path)}` : `/${adminPath}/api/files`;
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      filesList.innerHTML = '<div class="loading">Access denied or failed to load files</div>';
      return;
    }
    
    currentPath = data.currentPath;
    
    if (historyIndex === -1 || navigationHistory[historyIndex] !== currentPath) {
      navigationHistory = navigationHistory.slice(0, historyIndex + 1);
      navigationHistory.push(currentPath);
      historyIndex = navigationHistory.length - 1;
    }
    
    updateBreadcrumb(currentPath);
    
    if (data.files.length === 0) {
      filesList.innerHTML = '<div class="loading">No files found</div>';
      return;
    }
    
    const folders = data.files.filter(f => f.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    const files = data.files.filter(f => !f.isDirectory).sort((a, b) => a.name.localeCompare(b.name));
    const sortedFiles = [...folders, ...files];
    
    filesList.innerHTML = sortedFiles.map(file => `
      <div class="file-item" ondblclick="handleFileDoubleClick('${file.path.replace(/\\/g, '\\\\')}', ${file.isDirectory})">
        <div class="file-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            ${file.isDirectory ? 
              '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>' :
              '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>'
            }
          </svg>
        </div>
        <div class="file-info">
          <div class="file-name">${file.name}</div>
          <div class="file-meta">
            ${file.isDirectory ? 'Folder' : formatBytes(file.size)} • 
            ${formatDate(file.modified)}
          </div>
        </div>
        <div class="file-actions">
          ${!file.isDirectory ? `
            <button class="btn-icon" onclick="deleteFile('${file.path.replace(/\\/g, '\\\\')}', event)" title="Delete">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          ` : ''}
        </div>
      </div>
    `).join('');
  } catch (error) {
    filesList.innerHTML = '<div class="loading">Failed to load files</div>';
  }
}

function updateBreadcrumb(path) {
  const breadcrumb = document.getElementById('path-breadcrumb');
  breadcrumb.textContent = path;
}

function handleFileDoubleClick(path, isDirectory) {
  if (isDirectory) {
    loadFiles(path);
  }
}

document.getElementById('refresh-files').addEventListener('click', () => loadFiles(currentPath));

document.getElementById('back-btn').addEventListener('click', () => {
  if (historyIndex > 0) {
    historyIndex--;
    loadFiles(navigationHistory[historyIndex]);
  }
});

document.getElementById('forward-btn').addEventListener('click', () => {
  if (historyIndex < navigationHistory.length - 1) {
    historyIndex++;
    loadFiles(navigationHistory[historyIndex]);
  }
});

document.getElementById('up-btn').addEventListener('click', () => {
  const parts = currentPath.split('/');
  if (parts.length > 2) {
    parts.pop();
    loadFiles(parts.join('/'));
  }
});

document.getElementById('home-btn').addEventListener('click', () => {
  loadFiles();
});

document.getElementById('new-folder-btn').addEventListener('click', async () => {
  const name = prompt('Enter folder name:');
  if (!name) return;
  
  try {
    const response = await fetch(`/${adminPath}/api/files/create-folder`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name })
    });
    
    if (response.ok) {
      loadFiles(currentPath);
    }
  } catch (error) {
    alert('Failed to create folder');
  }
});

async function deleteFile(filePath, event) {
  if (event) event.stopPropagation();
  if (!confirm('Are you sure you want to delete this file?')) return;
  
  try {
    const response = await fetch(`/${adminPath}/api/files`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ path: filePath })
    });
    
    if (response.ok) {
      loadFiles(currentPath);
    }
  } catch (error) {
    alert('Failed to delete file');
  }
}

document.getElementById('upload-file-btn').addEventListener('click', () => {
  uploadModal.classList.add('active');
  document.getElementById('upload-result-modal').classList.add('hidden');
  document.getElementById('upload-progress').classList.add('hidden');
  document.getElementById('dropzone-modal').classList.remove('has-file');
  document.getElementById('start-upload-btn').disabled = true;
  selectedFile = null;
});

document.getElementById('close-upload-modal').addEventListener('click', () => {
  uploadModal.classList.remove('active');
});

uploadModal.addEventListener('click', (e) => {
  if (e.target === uploadModal) {
    return;
  }
});

const dropzoneModal = document.getElementById('dropzone-modal');
const fileInputModal = document.getElementById('file-input-modal');

dropzoneModal.addEventListener('click', () => fileInputModal.click());

dropzoneModal.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzoneModal.classList.add('dragover');
});

dropzoneModal.addEventListener('dragleave', () => {
  dropzoneModal.classList.remove('dragover');
});

dropzoneModal.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzoneModal.classList.remove('dragover');
  
  if (e.dataTransfer.files.length > 0) {
    selectFile(e.dataTransfer.files[0]);
  }
});

fileInputModal.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    selectFile(e.target.files[0]);
  }
});

function selectFile(file) {
  selectedFile = file;
  dropzoneModal.classList.add('has-file');
  dropzoneModal.innerHTML = `
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
      <polyline points="13 2 13 9 20 9"/>
    </svg>
    <p><strong>${file.name}</strong></p>
    <p>${formatBytes(file.size)}</p>
  `;
  document.getElementById('start-upload-btn').disabled = false;
}

document.getElementById('start-upload-btn').addEventListener('click', async () => {
  if (!selectedFile) return;
  
  const formData = new FormData();
  formData.append('file', selectedFile);
  
  const password = document.getElementById('upload-password-modal').value;
  if (password) {
    formData.append('password', password);
  }
  
  try {
    document.getElementById('upload-progress').classList.remove('hidden');
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-text').textContent = 'Uploading...';
    
    const xhr = new XMLHttpRequest();
    
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        document.getElementById('progress-fill').style.width = percent + '%';
        document.getElementById('progress-text').textContent = `Uploading... ${Math.round(percent)}%`;
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        let downloadUrl = data.downloadUrl;
        if (password) {
          downloadUrl += `?password=${encodeURIComponent(password)}`;
        }
        
        document.getElementById('download-url-modal').value = downloadUrl;
        document.getElementById('upload-result-modal').classList.remove('hidden');
        document.getElementById('upload-progress').classList.add('hidden');
        
        document.getElementById('upload-password-modal').value = '';
        loadFiles(currentPath);
      } else {
        alert('Upload failed');
        document.getElementById('upload-progress').classList.add('hidden');
      }
    });
    
    xhr.open('POST', `/${adminPath}/api/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  } catch (error) {
    alert('Upload failed');
    document.getElementById('upload-progress').classList.add('hidden');
  }
});

document.getElementById('copy-url-modal').addEventListener('click', () => {
  const urlInput = document.getElementById('download-url-modal');
  urlInput.select();
  document.execCommand('copy');
  
  const btn = document.getElementById('copy-url-modal');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;
  
  setTimeout(() => {
    btn.innerHTML = originalHTML;
  }, 2000);
});

async function loadSettings() {
  try {
    const response = await fetch(`/${adminPath}/api/settings`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    settings = await response.json();
    
    document.getElementById('setting-theme').value = settings.theme || 'light';
    document.getElementById('setting-compact').checked = settings.compactMode || false;
    document.getElementById('setting-autorefresh').checked = settings.autoRefresh !== false;
    document.getElementById('setting-interval').value = settings.refreshInterval || 5;
    document.getElementById('setting-hidden').checked = settings.showHiddenFiles || false;
    document.getElementById('setting-dateformat').value = settings.dateFormat || 'locale';
    document.getElementById('setting-maxupload').value = settings.maxUploadSize || 100;
    document.getElementById('setting-defaultpass').checked = settings.defaultPasswordProtection || false;
    document.getElementById('setting-notifications').checked = settings.notifications !== false;
    document.getElementById('setting-sounds').checked = settings.soundEffects || false;
    document.getElementById('setting-timeout').value = settings.sessionTimeout || 60;
    document.getElementById('setting-requirepass').checked = settings.requirePasswordOnDownload || false;
    document.getElementById('setting-language').value = settings.language || 'en';
    
    applySettings(settings);
  } catch (error) {
    console.error('Failed to load settings');
  }
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
    defaultPasswordProtection: document.getElementById('setting-defaultpass').checked,
    notifications: document.getElementById('setting-notifications').checked,
    soundEffects: document.getElementById('setting-sounds').checked,
    sessionTimeout: parseInt(document.getElementById('setting-timeout').value),
    requirePasswordOnDownload: document.getElementById('setting-requirepass').checked,
    language: document.getElementById('setting-language').value
  };
  
  try {
    const response = await fetch(`/${adminPath}/api/settings`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(settings)
    });
    
    if (response.ok) {
      applySettings(settings);
      alert('Settings saved successfully!');
    }
  } catch (error) {
    alert('Failed to save settings');
  }
});

function applySettings(settings) {
  if (settings.theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else {
    document.body.classList.remove('dark-theme');
  }
  
  if (settings.compactMode) {
    document.body.classList.add('compact-mode');
  } else {
    document.body.classList.remove('compact-mode');
  }
  
  if (settings.autoRefresh) {
    startAutoRefresh();
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleString();
}

const savedToken = localStorage.getItem('token');
const savedAdminPath = localStorage.getItem('adminPath');

const pathParts = window.location.pathname.split('/').filter(p => p);
const urlPath = pathParts.length > 0 ? pathParts[0] : '';

if (!urlPath) {
  loginError.textContent = 'Invalid URL. Please use the correct admin panel URL.';
  loginError.classList.add('show');
  document.getElementById('username').disabled = true;
  document.getElementById('password').disabled = true;
  document.querySelector('.btn-login').disabled = true;
} else if (savedToken && savedAdminPath && urlPath === savedAdminPath) {
  token = savedToken;
  adminPath = savedAdminPath;
  showAdminScreen();
}


const variableModal = document.getElementById('variable-modal');
const commitModal = document.getElementById('commit-modal');

document.getElementById('create-variable-btn').addEventListener('click', () => {
  variableModal.classList.add('active');
  document.getElementById('variable-result').classList.add('hidden');
  document.getElementById('var-name').value = '';
  document.getElementById('var-value').value = '';
  document.getElementById('var-version').value = '';
  document.getElementById('var-password').value = '';
  document.getElementById('var-redirect-delay').value = '5';
});

document.getElementById('close-variable-modal').addEventListener('click', () => {
  variableModal.classList.remove('active');
});

document.getElementById('close-commit-modal').addEventListener('click', () => {
  commitModal.classList.remove('active');
});

variableModal.addEventListener('click', (e) => {
  if (e.target === variableModal) {
    return;
  }
});

commitModal.addEventListener('click', (e) => {
  if (e.target === commitModal) {
    return;
  }
});

document.getElementById('create-variable-submit').addEventListener('click', async () => {
  const name = document.getElementById('var-name').value;
  const value = document.getElementById('var-value').value;
  const version = document.getElementById('var-version').value;
  const password = document.getElementById('var-password').value;
  const redirectDelay = parseInt(document.getElementById('var-redirect-delay').value);
  
  if (!name || !value || !version) {
    alert('Please fill in all required fields');
    return;
  }
  
  try {
    const response = await fetch(`/${adminPath}/api/variables`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, value, version, password, redirectDelay })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      let url = data.url;
      if (password) {
        url += `?password=${encodeURIComponent(password)}`;
      }
      
      document.getElementById('variable-url').value = url;
      document.getElementById('variable-result').classList.remove('hidden');
      
      loadVariables();
    } else {
      alert('Failed to create variable');
    }
  } catch (error) {
    alert('Failed to create variable');
  }
});

document.getElementById('copy-variable-url').addEventListener('click', () => {
  const urlInput = document.getElementById('variable-url');
  urlInput.select();
  document.execCommand('copy');
  
  const btn = document.getElementById('copy-variable-url');
  const originalHTML = btn.innerHTML;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  `;
  
  setTimeout(() => {
    btn.innerHTML = originalHTML;
  }, 2000);
});

async function loadVariables() {
  const variablesList = document.getElementById('variables-list');
  variablesList.innerHTML = '<div class="loading">Loading variables...</div>';
  
  try {
    const response = await fetch(`/${adminPath}/api/variables`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const variables = await response.json();
    const varArray = Object.entries(variables);
    
    if (varArray.length === 0) {
      variablesList.innerHTML = '<div class="loading">No variables found. Create your first one!</div>';
      return;
    }
    
    variablesList.innerHTML = varArray.map(([id, variable]) => {
      const baseUrl = `${window.location.protocol}//${window.location.host}/api/${id}`;
      const versionUrl = `${baseUrl}/v/${variable.version}`;
      
      return `
        <div class="variable-card">
          <div class="variable-header">
            <div class="variable-info">
              <h3>${variable.name}</h3>
              <div class="variable-meta">
                <span class="meta-badge">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  v${variable.version}
                </span>
                ${variable.password ? '<span class="meta-badge">🔒 Protected</span>' : ''}
                <span class="meta-badge">${variable.commits.length} commits</span>
              </div>
            </div>
            <div class="variable-actions">
              <button class="btn-secondary" onclick="openCommitModal('${id}', '${variable.version}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 16 16 12 12 8"/>
                  <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Commit
              </button>
              <button class="btn-icon" onclick="deleteVariable('${id}')" title="Delete">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="variable-value">${variable.value}</div>
          
          <div class="variable-url-section">
            <label>Latest Version URL:</label>
            <div class="url-container">
              <input type="text" value="${baseUrl}" readonly>
              <button class="btn-copy" onclick="copyToClipboard('${baseUrl}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="variable-url-section">
            <label>Specific Version URL:</label>
            <div class="url-container">
              <input type="text" value="${versionUrl}" readonly>
              <button class="btn-copy" onclick="copyToClipboard('${versionUrl}')">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
              </button>
            </div>
          </div>
          
          <div class="commits-list">
            <h4>Commit History</h4>
            ${variable.commits.slice().reverse().map(commit => `
              <div class="commit-item">
                <span class="commit-version">v${commit.version}</span>
                <span class="commit-time">${new Date(commit.timestamp).toLocaleString()}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    variablesList.innerHTML = '<div class="loading">Failed to load variables</div>';
  }
}

function openCommitModal(id, currentVersion) {
  document.getElementById('commit-var-id').value = id;
  document.getElementById('commit-value').value = '';
  document.getElementById('commit-version').value = '';
  commitModal.classList.add('active');
}

document.getElementById('commit-submit').addEventListener('click', async () => {
  const id = document.getElementById('commit-var-id').value;
  const value = document.getElementById('commit-value').value;
  const version = document.getElementById('commit-version').value;
  
  if (!value || !version) {
    alert('Please fill in all fields');
    return;
  }
  
  try {
    const response = await fetch(`/${adminPath}/api/variables/${id}/commit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ value, version })
    });
    
    if (response.ok) {
      commitModal.classList.remove('active');
      loadVariables();
      alert('Version committed successfully!');
    } else {
      alert('Failed to commit version');
    }
  } catch (error) {
    alert('Failed to commit version');
  }
});

async function deleteVariable(id) {
  if (!confirm('Are you sure you want to delete this variable?')) return;
  
  try {
    const response = await fetch(`/${adminPath}/api/variables/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadVariables();
    } else {
      alert('Failed to delete variable');
    }
  } catch (error) {
    alert('Failed to delete variable');
  }
}

function copyToClipboard(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    if (tab === 'api') {
      loadVariables();
    }
  });
});


const siteModal = document.getElementById('site-modal');
const portModal = document.getElementById('port-modal');

document.getElementById('create-site-btn').addEventListener('click', () => {
  siteModal.classList.add('active');
});

document.getElementById('close-site-modal').addEventListener('click', () => {
  siteModal.classList.remove('active');
});

document.getElementById('add-port-btn').addEventListener('click', () => {
  portModal.classList.add('active');
});

document.getElementById('close-port-modal').addEventListener('click', () => {
  portModal.classList.remove('active');
});

document.getElementById('create-site-submit').addEventListener('click', async () => {
  const name = document.getElementById('site-name').value;
  const type = document.getElementById('site-type').value;
  const port = document.getElementById('site-port').value;
  const domain = document.getElementById('site-domain').value;
  
  if (!name || !port) {
    alert('Please fill in required fields');
    return;
  }
  
  try {
    const response = await fetch(`/${adminPath}/api/sites`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, type, port: parseInt(port), domain })
    });
    
    if (response.ok) {
      siteModal.classList.remove('active');
      loadSites();
      alert('Site created successfully!');
    } else {
      alert('Failed to create site');
    }
  } catch (error) {
    alert('Failed to create site');
  }
});

async function loadSites() {
  const sitesList = document.getElementById('sites-list');
  sitesList.innerHTML = '<div class="loading">Loading sites...</div>';
  
  try {
    const response = await fetch(`/${adminPath}/api/sites`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const sites = await response.json();
    const sitesArray = Object.values(sites);
    
    if (sitesArray.length === 0) {
      sitesList.innerHTML = '<div class="loading">No sites found. Create your first one!</div>';
      return;
    }
    
    sitesList.innerHTML = sitesArray.map(site => `
      <div class="site-card">
        <div class="site-header">
          <div class="site-info">
            <h3>${site.name}</h3>
            <div class="site-meta">
              <span class="meta-badge">${site.type}</span>
              <span class="meta-badge">Port: ${site.port}</span>
              <span class="meta-badge status-${site.status}">${site.status}</span>
              ${site.domain ? `<span class="meta-badge">${site.domain}</span>` : ''}
            </div>
          </div>
          <div class="site-actions">
            ${site.status === 'stopped' ? 
              `<button class="btn-secondary" onclick="startSite('${site.id}')">Start</button>` :
              `<button class="btn-secondary" onclick="stopSite('${site.id}')">Stop</button>`
            }
            <button class="btn-secondary" onclick="openSiteFiles('${site.path}')">Files</button>
            <button class="btn-icon" onclick="deleteSite('${site.id}')" title="Delete">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="site-path">Path: ${site.path}</div>
      </div>
    `).join('');
  } catch (error) {
    sitesList.innerHTML = '<div class="loading">Failed to load sites</div>';
  }
}

async function startSite(id) {
  try {
    const response = await fetch(`/${adminPath}/api/sites/${id}/start`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadSites();
    }
  } catch (error) {
    alert('Failed to start site');
  }
}

async function stopSite(id) {
  try {
    const response = await fetch(`/${adminPath}/api/sites/${id}/stop`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadSites();
    }
  } catch (error) {
    alert('Failed to stop site');
  }
}

async function deleteSite(id) {
  if (!confirm('Are you sure you want to delete this site?')) return;
  
  try {
    const response = await fetch(`/${adminPath}/api/sites/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadSites();
    }
  } catch (error) {
    alert('Failed to delete site');
  }
}

function openSiteFiles(sitePath) {
  document.querySelector('[data-tab="files"]').click();
  setTimeout(() => {
    loadFiles(sitePath);
  }, 100);
}

async function loadSecurity() {
  try {
    const response = await fetch(`/${adminPath}/api/security`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const security = await response.json();
    
    document.getElementById('security-2fa').checked = security.twoFactor || false;
    document.getElementById('security-session-timeout').value = security.sessionTimeout || 60;
    document.getElementById('security-max-attempts').value = security.maxAttempts || 5;
    document.getElementById('security-force-https').checked = security.forceHttps || false;
    document.getElementById('security-hsts').checked = security.hsts || false;
    document.getElementById('security-firewall').checked = security.firewall !== false;
    document.getElementById('security-block-suspicious').checked = security.blockSuspicious !== false;
    
    const ipList = document.getElementById('ip-list');
    if (security.ipWhitelist && security.ipWhitelist.length > 0) {
      ipList.innerHTML = security.ipWhitelist.map(ip => `
        <div class="ip-item">
          <span>${ip}</span>
          <button class="btn-icon" onclick="removeIP('${ip}')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      `).join('');
    } else {
      ipList.innerHTML = '<p style="color: var(--text-secondary); padding: 1rem;">No IPs in whitelist</p>';
    }
  } catch (error) {
    console.error('Failed to load security settings');
  }
}

document.getElementById('add-ip-btn').addEventListener('click', async () => {
  const ipInput = document.getElementById('ip-input');
  const ip = ipInput.value.trim();
  
  if (!ip) return;
  
  try {
    const response = await fetch(`/${adminPath}/api/security`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const security = await response.json();
    
    if (!security.ipWhitelist) {
      security.ipWhitelist = [];
    }
    
    if (!security.ipWhitelist.includes(ip)) {
      security.ipWhitelist.push(ip);
      
      await fetch(`/${adminPath}/api/security`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(security)
      });
      
      ipInput.value = '';
      loadSecurity();
    }
  } catch (error) {
    alert('Failed to add IP');
  }
});

async function removeIP(ip) {
  try {
    const response = await fetch(`/${adminPath}/api/security`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const security = await response.json();
    security.ipWhitelist = security.ipWhitelist.filter(i => i !== ip);
    
    await fetch(`/${adminPath}/api/security`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(security)
    });
    
    loadSecurity();
  } catch (error) {
    alert('Failed to remove IP');
  }
}

document.getElementById('save-security').addEventListener('click', async () => {
  const security = {
    twoFactor: document.getElementById('security-2fa').checked,
    sessionTimeout: parseInt(document.getElementById('security-session-timeout').value),
    maxAttempts: parseInt(document.getElementById('security-max-attempts').value),
    forceHttps: document.getElementById('security-force-https').checked,
    hsts: document.getElementById('security-hsts').checked,
    firewall: document.getElementById('security-firewall').checked,
    blockSuspicious: document.getElementById('security-block-suspicious').checked
  };
  
  const currentResponse = await fetch(`/${adminPath}/api/security`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const currentSecurity = await currentResponse.json();
  security.ipWhitelist = currentSecurity.ipWhitelist || [];
  
  try {
    const response = await fetch(`/${adminPath}/api/security`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(security)
    });
    
    if (response.ok) {
      alert('Security settings saved successfully!');
    }
  } catch (error) {
    alert('Failed to save security settings');
  }
});

async function loadPorts() {
  const portsList = document.getElementById('ports-list');
  portsList.innerHTML = '<div class="loading">Loading ports...</div>';
  
  try {
    const response = await fetch(`/${adminPath}/api/ports`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const ports = await response.json();
    const portsArray = Object.values(ports);
    
    if (portsArray.length === 0) {
      portsList.innerHTML = '<div class="loading">No port rules found. Add your first one!</div>';
      return;
    }
    
    portsList.innerHTML = portsArray.map(rule => `
      <div class="port-card">
        <div class="port-header">
          <div class="port-info">
            <h3>Port ${rule.port}</h3>
            <div class="port-meta">
              <span class="meta-badge">${rule.protocol.toUpperCase()}</span>
              <span class="meta-badge action-${rule.action}">${rule.action}</span>
              <span class="meta-badge status-${rule.enabled ? 'running' : 'stopped'}">${rule.enabled ? 'Enabled' : 'Disabled'}</span>
            </div>
            ${rule.description ? `<p class="port-description">${rule.description}</p>` : ''}
          </div>
          <div class="port-actions">
            <button class="btn-secondary" onclick="togglePort('${rule.id}')">
              ${rule.enabled ? 'Disable' : 'Enable'}
            </button>
            <button class="btn-icon" onclick="deletePort('${rule.id}')" title="Delete">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    portsList.innerHTML = '<div class="loading">Failed to load ports</div>';
  }
}

async function loadActivePorts() {
  const activePortsList = document.getElementById('active-ports-list');
  activePortsList.innerHTML = '<div class="loading">Scanning ports...</div>';
  
  try {
    const response = await fetch(`/${adminPath}/api/ports/active`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    const activePorts = await response.json();
    
    if (activePorts.length === 0) {
      activePortsList.innerHTML = '<div class="loading">No active ports detected</div>';
      return;
    }
    
    activePortsList.innerHTML = activePorts.map(port => `
      <div class="port-card">
        <div class="port-header">
          <div class="port-info">
            <h3>Port ${port.port}</h3>
            <div class="port-meta">
              <span class="meta-badge">${port.protocol.toUpperCase()}</span>
              <span class="meta-badge status-running">${port.state}</span>
              <span class="meta-badge">${port.process}</span>
            </div>
          </div>
        </div>
      </div>
    `).join('');
  } catch (error) {
    activePortsList.innerHTML = '<div class="loading">Failed to scan ports</div>';
  }
}

document.getElementById('add-port-submit').addEventListener('click', async () => {
  const port = document.getElementById('port-number').value;
  const protocol = document.getElementById('port-protocol').value;
  const action = document.getElementById('port-action').value;
  const description = document.getElementById('port-description').value;
  
  if (!port) {
    alert('Please enter a port number');
    return;
  }
  
  try {
    const response = await fetch(`/${adminPath}/api/ports`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ port: parseInt(port), protocol, action, description })
    });
    
    if (response.ok) {
      portModal.classList.remove('active');
      loadPorts();
      document.getElementById('port-number').value = '';
      document.getElementById('port-description').value = '';
    } else {
      alert('Failed to add port rule');
    }
  } catch (error) {
    alert('Failed to add port rule');
  }
});

async function togglePort(id) {
  try {
    const response = await fetch(`/${adminPath}/api/ports/${id}/toggle`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadPorts();
    }
  } catch (error) {
    alert('Failed to toggle port');
  }
}

async function deletePort(id) {
  if (!confirm('Are you sure you want to delete this port rule?')) return;
  
  try {
    const response = await fetch(`/${adminPath}/api/ports/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (response.ok) {
      loadPorts();
    }
  } catch (error) {
    alert('Failed to delete port rule');
  }
}

document.getElementById('refresh-ports-btn').addEventListener('click', () => {
  loadPorts();
  loadActivePorts();
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    if (tab === 'sites') {
      loadSites();
    } else if (tab === 'security') {
      loadSecurity();
    } else if (tab === 'ports') {
      loadPorts();
      loadActivePorts();
    }
  });
});
