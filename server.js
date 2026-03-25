const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const si = require('systeminformation');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = 1337;

const config = JSON.parse(fsSync.readFileSync('config.json', 'utf8'));
const JWT_SECRET = config.jwtSecret;
const ADMIN_PATH = config.adminPath;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const SITES_DIR = path.join(__dirname, 'sites');

// Ensure directories exist
if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
}
if (!fsSync.existsSync(SITES_DIR)) {
  fsSync.mkdirSync(SITES_DIR, { recursive: true });
}

// Ensure JSON files exist
const jsonFiles = {
  'files.json': '{}',
  'api.json': '{}',
  'sites.json': '{}',
  'ports.json': '{}',
  'settings.json': JSON.stringify({
    theme: 'light',
    autoRefresh: true,
    refreshInterval: 5000,
    maxUploadSize: 100,
    showHiddenFiles: false,
    dateFormat: 'locale',
    notifications: true,
    soundEffects: false,
    compactMode: false,
    language: 'en'
  }, null, 2),
  'security.json': JSON.stringify({
    twoFactor: false,
    sessionTimeout: 60,
    maxAttempts: 5,
    forceHttps: false,
    hsts: false,
    firewall: true,
    blockSuspicious: true,
    ipWhitelist: []
  }, null, 2)
};

for (const [file, defaultContent] of Object.entries(jsonFiles)) {
  if (!fsSync.existsSync(file)) {
    fsSync.writeFileSync(file, defaultContent);
  }
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false
}));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts'
});

app.use(express.json());
app.use(express.static('public'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueName = crypto.randomBytes(8).toString('hex') + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ storage });

// ============ HELPERS ============

function readJSON(file) {
  try {
    return JSON.parse(fsSync.readFileSync(file, 'utf8'));
  } catch (e) {
    return {};
  }
}

function writeJSON(file, data) {
  fsSync.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ============ AUTH MIDDLEWARE ============

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

// ============ SAFE PATH CHECK ============

function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  const uploadsResolved = path.resolve(UPLOAD_DIR);
  const sitesResolved = path.resolve(SITES_DIR);

  return resolved.startsWith(uploadsResolved) || resolved.startsWith(sitesResolved);
}

// ============ ADMIN AUTH ============

app.post(`/${ADMIN_PATH}/api/login`, loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  const user = config.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, adminPath: ADMIN_PATH });
});

// ============ SETTINGS ============

app.get(`/${ADMIN_PATH}/api/settings`, authenticateToken, async (req, res) => {
  res.json(readJSON('settings.json'));
});

app.post(`/${ADMIN_PATH}/api/settings`, authenticateToken, async (req, res) => {
  try {
    writeJSON('settings.json', req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ============ SYSTEM INFO ============

app.get(`/${ADMIN_PATH}/api/system`, authenticateToken, async (req, res) => {
  try {
    const [cpu, mem, disk, osInfo, currentLoad, processes] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.osInfo(),
      si.currentLoad(),
      si.processes()
    ]);

    res.json({
      cpu: {
        model: cpu.brand,
        cores: cpu.cores,
        speed: cpu.speed,
        usage: currentLoad.currentLoad.toFixed(2)
      },
      memory: {
        total: (mem.total / 1024 / 1024 / 1024).toFixed(2),
        used: (mem.used / 1024 / 1024 / 1024).toFixed(2),
        free: (mem.free / 1024 / 1024 / 1024).toFixed(2),
        percentage: ((mem.used / mem.total) * 100).toFixed(2)
      },
      disk: disk.map(d => ({
        fs: d.fs,
        type: d.type,
        size: (d.size / 1024 / 1024 / 1024).toFixed(2),
        used: (d.used / 1024 / 1024 / 1024).toFixed(2),
        available: (d.available / 1024 / 1024 / 1024).toFixed(2),
        percentage: d.use.toFixed(2)
      })),
      os: {
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        hostname: osInfo.hostname,
        uptime: Math.floor(osInfo.uptime / 3600)
      },
      processes: {
        all: processes.all,
        running: processes.running,
        blocked: processes.blocked
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch system info' });
  }
});

// ============ FILE MANAGEMENT ============

app.get(`/${ADMIN_PATH}/api/files`, authenticateToken, async (req, res) => {
  try {
    // CRITICAL FIX: Decode the path properly
    let dirPath = req.query.path || UPLOAD_DIR;

    // Decode URI component in case it's encoded
    dirPath = decodeURIComponent(dirPath);

    const safePath = path.resolve(dirPath);

    // Check allowed directories
    if (!isPathAllowed(safePath)) {
      console.error(`Access denied: ${safePath} is outside allowed directories`);
      return res.status(403).json({
        error: 'Access denied: Path outside allowed directories',
        requested: safePath,
        allowed: [path.resolve(UPLOAD_DIR), path.resolve(SITES_DIR)]
      });
    }

    if (!fsSync.existsSync(safePath)) {
      return res.status(404).json({ error: 'Directory not found', path: safePath });
    }

    const stat = await fs.stat(safePath);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' });
    }

    const items = await fs.readdir(safePath, { withFileTypes: true });
    const files = await Promise.all(
      items.map(async item => {
        const fullPath = path.join(safePath, item.name);
        try {
          const stats = await fs.stat(fullPath);
          return {
            name: item.name,
            isDirectory: item.isDirectory(),
            size: stats.size,
            modified: stats.mtime,
            path: fullPath
          };
        } catch (err) {
          return null;
        }
      })
    );

    res.json({
      files: files.filter(f => f !== null),
      currentPath: safePath,
      parentPath: isPathAllowed(path.dirname(safePath)) ? path.dirname(safePath) : null
    });
  } catch (error) {
    console.error('File list error:', error);
    res.status(500).json({ error: 'Failed to read directory: ' + error.message });
  }
});

app.post(`/${ADMIN_PATH}/api/files/create-folder`, authenticateToken, async (req, res) => {
  try {
    let targetDir = req.body.currentPath || UPLOAD_DIR;
    targetDir = decodeURIComponent(targetDir);
    const folderPath = path.join(targetDir, req.body.name);
    const safePath = path.resolve(folderPath);

    if (!isPathAllowed(safePath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.mkdir(safePath, { recursive: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

app.post(`/${ADMIN_PATH}/api/files/rename`, authenticateToken, async (req, res) => {
  try {
    let { oldPath, newName } = req.body;
    oldPath = decodeURIComponent(oldPath);
    const safeOldPath = path.resolve(oldPath);
    const newPath = path.join(path.dirname(safeOldPath), newName);

    if (!isPathAllowed(safeOldPath) || !isPathAllowed(newPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.rename(safeOldPath, newPath);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to rename' });
  }
});

app.delete(`/${ADMIN_PATH}/api/files`, authenticateToken, async (req, res) => {
  try {
    let filePath = req.body.path;
    filePath = decodeURIComponent(filePath);
    const safePath = path.resolve(filePath);

    if (!isPathAllowed(safePath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = await fs.stat(safePath);
    if (stats.isDirectory()) {
      await fs.rm(safePath, { recursive: true, force: true });
    } else {
      await fs.unlink(safePath);

      // Also remove from files.json if it exists there
      const filesDb = readJSON('files.json');
      for (const [key, value] of Object.entries(filesDb)) {
        if (value.filename && safePath.endsWith(value.filename)) {
          delete filesDb[key];
          writeJSON('files.json', filesDb);
          break;
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: 'Failed to delete: ' + error.message });
  }
});

// ============ FILE UPLOAD ============

app.post(`/${ADMIN_PATH}/api/upload`, authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const randomPath = crypto.randomBytes(5).toString('hex');
    const password = req.body.password || '';

    const fileData = {
      id: randomPath,
      originalName: req.file.originalname,
      filename: req.file.filename,
      size: req.file.size,
      uploadDate: new Date().toISOString(),
      password: password ? await bcrypt.hash(password, 10) : null
    };

    const filesDb = readJSON('files.json');
    filesDb[randomPath] = fileData;
    writeJSON('files.json', filesDb);

    const downloadUrl = `${req.protocol}://${req.get('host')}/dl/${randomPath}/${encodeURIComponent(req.file.originalname)}`;

    res.json({
      success: true,
      downloadUrl,
      fileInfo: fileData
    });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

// ============ SITE FILE UPLOAD (for site file managers) ============

app.post(`/${ADMIN_PATH}/api/sites/upload`, authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let targetDir = req.body.path || '';
    targetDir = decodeURIComponent(targetDir);
    const safePath = path.resolve(targetDir);

    if (!isPathAllowed(safePath)) {
      // Clean up uploaded file
      await fs.unlink(req.file.path);
      return res.status(403).json({ error: 'Access denied' });
    }

    // Move file from uploads to target directory
    const destPath = path.join(safePath, req.file.originalname);
    await fs.rename(req.file.path, destPath);

    res.json({ success: true, path: destPath });
  } catch (error) {
    console.error('Site upload error:', error);
    res.status(500).json({ error: 'Upload failed: ' + error.message });
  }
});

// ============ API VARIABLES (admin routes MUST come before public /api/:id) ============

app.get(`/${ADMIN_PATH}/api/variables`, authenticateToken, async (req, res) => {
  res.json(readJSON('api.json'));
});

app.post(`/${ADMIN_PATH}/api/variables`, authenticateToken, async (req, res) => {
  try {
    const { name, value, version, password, redirectDelay } = req.body;

    const apiDb = readJSON('api.json');
    const varId = crypto.randomBytes(8).toString('hex');
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    apiDb[varId] = {
      name,
      value,
      version,
      password: hashedPassword,
      redirectDelay: redirectDelay || 0,
      createdAt: new Date().toISOString(),
      commits: [{
        version,
        value,
        timestamp: new Date().toISOString()
      }]
    };

    writeJSON('api.json', apiDb);

    res.json({
      success: true,
      id: varId,
      url: `${req.protocol}://${req.get('host')}/api/v/${varId}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create variable' });
  }
});

app.post(`/${ADMIN_PATH}/api/variables/:id/commit`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { value, version } = req.body;

    const apiDb = readJSON('api.json');

    if (!apiDb[id]) {
      return res.status(404).json({ error: 'Variable not found' });
    }

    const oldVersion = apiDb[id].version;

    apiDb[id].commits.push({
      version,
      value,
      timestamp: new Date().toISOString()
    });

    apiDb[id].value = value;
    apiDb[id].version = version;
    apiDb[id].previousVersion = oldVersion;

    writeJSON('api.json', apiDb);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to commit version' });
  }
});

app.delete(`/${ADMIN_PATH}/api/variables/:id`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const apiDb = readJSON('api.json');

    if (!apiDb[id]) {
      return res.status(404).json({ error: 'Variable not found' });
    }

    delete apiDb[id];
    writeJSON('api.json', apiDb);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete variable' });
  }
});

// ============ SITES ============

app.get(`/${ADMIN_PATH}/api/sites`, authenticateToken, async (req, res) => {
  res.json(readJSON('sites.json'));
});

app.post(`/${ADMIN_PATH}/api/sites`, authenticateToken, async (req, res) => {
  try {
    const { name, type, port, domain } = req.body;

    const sitesDb = readJSON('sites.json');
    const siteId = crypto.randomBytes(8).toString('hex');
    const sitePath = path.join(SITES_DIR, name);

    await fs.mkdir(sitePath, { recursive: true });

    // Create default index.html for new sites
    const defaultHtml = `<!DOCTYPE html>
<html>
<head>
  <title>${name}</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #1a1a2e; color: white; }
    .container { text-align: center; }
    h1 { font-size: 3rem; }
    p { color: #888; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${name}</h1>
    <p>Site created successfully. Edit files to customize.</p>
  </div>
</body>
</html>`;

    await fs.writeFile(path.join(sitePath, 'index.html'), defaultHtml);

    sitesDb[siteId] = {
      id: siteId,
      name,
      type,
      port,
      domain,
      path: sitePath,
      status: 'stopped',
      createdAt: new Date().toISOString()
    };

    writeJSON('sites.json', sitesDb);

    res.json({ success: true, site: sitesDb[siteId] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create site' });
  }
});

app.post(`/${ADMIN_PATH}/api/sites/:id/start`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = readJSON('sites.json');

    if (!sitesDb[id]) {
      return res.status(404).json({ error: 'Site not found' });
    }

    sitesDb[id].status = 'running';
    writeJSON('sites.json', sitesDb);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start site' });
  }
});

app.post(`/${ADMIN_PATH}/api/sites/:id/stop`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = readJSON('sites.json');

    if (!sitesDb[id]) {
      return res.status(404).json({ error: 'Site not found' });
    }

    sitesDb[id].status = 'stopped';
    writeJSON('sites.json', sitesDb);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop site' });
  }
});

app.delete(`/${ADMIN_PATH}/api/sites/:id`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = readJSON('sites.json');

    if (!sitesDb[id]) {
      return res.status(404).json({ error: 'Site not found' });
    }

    // Also delete site folder
    const sitePath = sitesDb[id].path;
    if (sitePath && fsSync.existsSync(sitePath)) {
      await fs.rm(sitePath, { recursive: true, force: true });
    }

    delete sitesDb[id];
    writeJSON('sites.json', sitesDb);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete site' });
  }
});

// ============ SECURITY ============

app.get(`/${ADMIN_PATH}/api/security`, authenticateToken, async (req, res) => {
  res.json(readJSON('security.json'));
});

app.post(`/${ADMIN_PATH}/api/security`, authenticateToken, async (req, res) => {
  try {
    writeJSON('security.json', req.body);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save security settings' });
  }
});

// ============ PORTS ============

app.get(`/${ADMIN_PATH}/api/ports`, authenticateToken, async (req, res) => {
  res.json(readJSON('ports.json'));
});

app.get(`/${ADMIN_PATH}/api/ports/active`, authenticateToken, async (req, res) => {
  try {
    const { stdout } = await execPromise('ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || echo ""');

    const lines = stdout.split('\n').filter(line => line.includes('LISTEN') || line.includes('UNCONN'));
    const activePorts = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const protocol = parts[0].toLowerCase().includes('tcp') ? 'tcp' : 'udp';
      const addressPort = parts[4] || parts[3];

      if (!addressPort || !addressPort.includes(':')) continue;

      const portMatch = addressPort.match(/:(\d+)$/);
      if (!portMatch) continue;

      const port = parseInt(portMatch[1]);
      if (port < 1 || port > 65535) continue;

      let process = 'unknown';
      const processMatch = line.match(/users:\(\("([^"]+)"/);
      if (processMatch) {
        process = processMatch[1];
      }

      if (!activePorts.find(p => p.port === port && p.protocol === protocol)) {
        activePorts.push({ port, protocol, process, state: protocol === 'tcp' ? 'LISTEN' : 'UNCONN' });
      }
    }

    activePorts.sort((a, b) => a.port - b.port);
    res.json(activePorts);
  } catch (error) {
    console.error('Failed to get active ports:', error);
    res.json([]);
  }
});

app.post(`/${ADMIN_PATH}/api/ports`, authenticateToken, async (req, res) => {
  try {
    const { port, protocol, action, description } = req.body;
    const portsDb = readJSON('ports.json');
    const portId = crypto.randomBytes(8).toString('hex');

    portsDb[portId] = {
      id: portId,
      port,
      protocol,
      action,
      description,
      enabled: true,
      createdAt: new Date().toISOString()
    };

    writeJSON('ports.json', portsDb);
    res.json({ success: true, rule: portsDb[portId] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add port rule' });
  }
});

app.delete(`/${ADMIN_PATH}/api/ports/:id`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const portsDb = readJSON('ports.json');

    if (!portsDb[id]) {
      return res.status(404).json({ error: 'Port rule not found' });
    }

    delete portsDb[id];
    writeJSON('ports.json', portsDb);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete port rule' });
  }
});

app.post(`/${ADMIN_PATH}/api/ports/:id/toggle`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const portsDb = readJSON('ports.json');

    if (!portsDb[id]) {
      return res.status(404).json({ error: 'Port rule not found' });
    }

    portsDb[id].enabled = !portsDb[id].enabled;
    writeJSON('ports.json', portsDb);
    res.json({ success: true, enabled: portsDb[id].enabled });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle port rule' });
  }
});

// ============ READ/WRITE FILE CONTENT (for site editor) ============

app.get(`/${ADMIN_PATH}/api/files/content`, authenticateToken, async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'No path specified' });

    filePath = decodeURIComponent(filePath);
    const safePath = path.resolve(filePath);

    if (!isPathAllowed(safePath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = await fs.stat(safePath);
    if (stats.isDirectory()) {
      return res.status(400).json({ error: 'Cannot read directory as file' });
    }

    // Limit file size for reading (10MB)
    if (stats.size > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'File too large to read' });
    }

    const content = await fs.readFile(safePath, 'utf8');
    res.json({ content, path: safePath, size: stats.size });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read file: ' + error.message });
  }
});

app.post(`/${ADMIN_PATH}/api/files/content`, authenticateToken, async (req, res) => {
  try {
    let { path: filePath, content } = req.body;
    if (!filePath) return res.status(400).json({ error: 'No path specified' });

    filePath = decodeURIComponent(filePath);
    const safePath = path.resolve(filePath);

    if (!isPathAllowed(safePath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await fs.writeFile(safePath, content, 'utf8');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to write file: ' + error.message });
  }
});

// ============ ADMIN PAGE ============

app.get(`/${ADMIN_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ PUBLIC API ROUTES (MUST be after admin routes) ============
// CRITICAL: Use /api/v/:id instead of /api/:id to avoid route conflicts

app.get('/api/v/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const password = req.query.password || '';

    const apiDb = readJSON('api.json');
    const variable = apiDb[id];

    if (!variable) {
      return res.status(404).json({ error: 'Variable not found' });
    }

    if (variable.password) {
      const validPassword = await bcrypt.compare(password, variable.password);
      if (!validPassword) {
        return res.status(403).json({ error: 'Invalid password' });
      }
    }

    res.json({
      name: variable.name,
      value: variable.value,
      version: variable.version,
      createdAt: variable.createdAt
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({ error: 'Failed to retrieve variable' });
  }
});

app.get('/api/v/:id/version/:version', async (req, res) => {
  try {
    const { id, version } = req.params;
    const password = req.query.password || '';

    const apiDb = readJSON('api.json');
    const variable = apiDb[id];

    if (!variable) {
      return res.status(404).json({ error: 'Variable not found' });
    }

    if (variable.password) {
      const validPassword = await bcrypt.compare(password, variable.password);
      if (!validPassword) {
        return res.status(403).json({ error: 'Invalid password' });
      }
    }

    if (version !== variable.version) {
      const redirectDelay = variable.redirectDelay || 0;
      const newUrl = `${req.protocol}://${req.get('host')}/api/v/${id}${password ? `?password=${password}` : ''}`;

      if (redirectDelay > 0) {
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Version Outdated</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex; align-items: center; justify-content: center;
                min-height: 100vh; margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .container {
                background: white; padding: 3rem; border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                text-align: center; max-width: 500px;
              }
              h1 { color: #f59e0b; margin-bottom: 1rem; }
              p { color: #64748b; margin-bottom: 1.5rem; }
              .version {
                font-family: monospace; background: #f8fafc;
                padding: 0.5rem 1rem; border-radius: 8px;
                display: inline-block; margin: 0.5rem;
              }
              .countdown { font-size: 2rem; font-weight: bold; color: #3b82f6; margin: 1rem 0; }
              a {
                display: inline-block; padding: 0.875rem 2rem;
                background: #3b82f6; color: white; text-decoration: none;
                border-radius: 8px; font-weight: 600; transition: all 0.2s;
              }
              a:hover { background: #2563eb; transform: translateY(-2px); }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>⚠️ Version Outdated</h1>
              <p>You are accessing an old version of this variable.</p>
              <div>
                <span class="version">Old: v${version}</span>
                <span class="version">Current: v${variable.version}</span>
              </div>
              <div class="countdown" id="countdown">${redirectDelay}</div>
              <p>Redirecting to the latest version...</p>
              <a href="${newUrl}">Go Now</a>
            </div>
            <script>
              let seconds = ${redirectDelay};
              const countdown = document.getElementById('countdown');
              const interval = setInterval(() => {
                seconds--;
                countdown.textContent = seconds;
                if (seconds <= 0) {
                  clearInterval(interval);
                  window.location.href = '${newUrl}';
                }
              }, 1000);
            </script>
          </body>
          </html>
        `);
      } else {
        return res.redirect(newUrl);
      }
    }

    const commit = variable.commits.find(c => c.version === version);

    if (commit) {
      res.json({
        name: variable.name,
        value: commit.value,
        version: commit.version,
        timestamp: commit.timestamp
      });
    } else {
      res.status(404).json({ error: 'Version not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve variable' });
  }
});

// ============ FILE DOWNLOAD (MUST be after /api/v routes) ============
// Changed from /:randomPath/:filename to /dl/:randomPath/:filename to avoid conflicts

app.get('/dl/:randomPath/:filename', async (req, res) => {
  try {
    const { randomPath, filename } = req.params;
    const password = req.query.password || '';

    const filesDb = readJSON('files.json');
    const fileData = filesDb[randomPath];

    if (!fileData) return res.status(404).send('File not found');

    if (fileData.password) {
      const validPassword = await bcrypt.compare(password, fileData.password);
      if (!validPassword) {
        // Show password form
        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Password Required</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                display: flex; align-items: center; justify-content: center;
                min-height: 100vh; margin: 0; background: #0f172a; color: white;
              }
              .container {
                background: #1e293b; padding: 2rem; border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5); text-align: center; width: 400px;
              }
              h2 { margin-bottom: 1rem; }
              input {
                width: 100%; padding: 0.75rem; border: 1px solid #334155;
                border-radius: 8px; background: #0f172a; color: white;
                font-size: 1rem; margin: 0.5rem 0; box-sizing: border-box;
              }
              button {
                width: 100%; padding: 0.75rem; border: none; border-radius: 8px;
                background: #3b82f6; color: white; font-size: 1rem;
                cursor: pointer; margin-top: 0.5rem;
              }
              button:hover { background: #2563eb; }
            </style>
          </head>
          <body>
            <div class="container">
              <h2>🔒 Password Required</h2>
              <p>This file is password protected.</p>
              <form method="GET">
                <input type="password" name="password" placeholder="Enter password" required>
                <button type="submit">Download</button>
              </form>
            </div>
          </body>
          </html>
        `);
      }
    }

    const filePath = path.join(UPLOAD_DIR, fileData.filename);
    
    if (!fsSync.existsSync(filePath)) {
      return res.status(404).send('File not found on disk');
    }
    
    res.download(filePath, fileData.originalName);
  } catch (error) {
    res.status(500).send('Download failed');
  }
});

// Also support old format for backwards compatibility
app.get('/f/:randomPath', async (req, res) => {
  try {
    const { randomPath } = req.params;
    const filesDb = readJSON('files.json');
    const fileData = filesDb[randomPath];

    if (!fileData) return res.status(404).send('File not found');

    res.redirect(`/dl/${randomPath}/${encodeURIComponent(fileData.originalName)}`);
  } catch (error) {
    res.status(500).send('Error');
  }
});

// ============ START SERVER ============

if (config.ssl && config.ssl.enabled) {
  try {
    if (!fsSync.existsSync(config.ssl.certPath) || !fsSync.existsSync(config.ssl.keyPath)) {
      throw new Error('SSL certificates not found');
    }

    const sslOptions = {
      cert: fsSync.readFileSync(config.ssl.certPath),
      key: fsSync.readFileSync(config.ssl.keyPath)
    };

    const httpsServer = https.createServer(sslOptions, app);
    httpsServer.listen(443, '0.0.0.0', () => {
      console.log(`Welizium Admin Panel running on HTTPS port 443`);
      console.log(`Admin URL: https://${config.ssl.domain}/${ADMIN_PATH}`);
    });

    const httpApp = express();
    httpApp.use((req, res) => {
      res.redirect(`https://${req.headers.host}${req.url}`);
    });

    http.createServer(httpApp).listen(PORT, '0.0.0.0', () => {
      console.log(`HTTP redirect server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('SSL Error:', error.message);
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Welizium Admin Panel running on HTTP port ${PORT}`);
      console.log(`Admin URL: http://your-server:${PORT}/${ADMIN_PATH}`);
    });
  }
} else {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Welizium Admin Panel running on HTTP port ${PORT}`);
    console.log(`Admin URL: http://your-server:${PORT}/${ADMIN_PATH}`);
  });
}
