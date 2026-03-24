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
const { exec, spawn } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

const app = express();
const PORT = 1337;

const config = JSON.parse(fsSync.readFileSync('config.json', 'utf8'));
const JWT_SECRET = config.jwtSecret;
const ADMIN_PATH = config.adminPath;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const SITES_DIR = path.join(__dirname, 'sites');

// Track running site processes and servers
const runningProcesses = {};
const runningSiteServers = {};

// Ensure directories exist
[UPLOAD_DIR, SITES_DIR].forEach(dir => {
  if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
});

// Ensure JSON files exist
const jsonDefaults = {
  'files.json': '{}',
  'api.json': '{}',
  'sites.json': '{}',
  'ports.json': '{}',
  'settings.json': JSON.stringify({
    theme: 'light', autoRefresh: true, refreshInterval: 5,
    maxUploadSize: 100, showHiddenFiles: false, dateFormat: 'locale',
    notifications: true, soundEffects: false, compactMode: false, language: 'en'
  }, null, 2),
  'security.json': JSON.stringify({
    twoFactor: false, sessionTimeout: 60, maxAttempts: 5,
    forceHttps: false, hsts: false, firewall: true,
    blockSuspicious: true, ipWhitelist: []
  }, null, 2)
};

for (const [file, content] of Object.entries(jsonDefaults)) {
  if (!fsSync.existsSync(file)) fsSync.writeFileSync(file, content);
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, message: 'Too many login attempts'
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// ============ HELPERS ============

function readJSON(file) {
  try { return JSON.parse(fsSync.readFileSync(file, 'utf8')); }
  catch (e) { return {}; }
}

function writeJSON(file, data) {
  fsSync.writeFileSync(file, JSON.stringify(data, null, 2));
}

function isPathAllowed(targetPath) {
  const resolved = path.resolve(targetPath);
  return resolved.startsWith(path.resolve(UPLOAD_DIR)) ||
         resolved.startsWith(path.resolve(SITES_DIR));
}

function getFileIcon(filename) {
  const ext = path.extname(filename).toLowerCase();
  const icons = {
    '.html': '🌐', '.htm': '🌐', '.css': '🎨', '.js': '📜',
    '.jsx': '⚛️', '.tsx': '⚛️', '.ts': '📘', '.json': '📋',
    '.md': '📝', '.txt': '📄', '.py': '🐍', '.php': '🐘',
    '.rb': '💎', '.go': '🔵', '.rs': '🦀', '.java': '☕',
    '.vue': '💚', '.svelte': '🧡', '.yaml': '⚙️', '.yml': '⚙️',
    '.xml': '📰', '.svg': '🖼️', '.png': '🖼️', '.jpg': '🖼️',
    '.jpeg': '🖼️', '.gif': '🖼️', '.webp': '🖼️', '.ico': '🖼️',
    '.mp4': '🎬', '.mp3': '🎵', '.pdf': '📕', '.zip': '📦',
    '.tar': '📦', '.gz': '📦', '.env': '🔐', '.gitignore': '🚫',
    '.dockerfile': '🐳', '.sh': '💻', '.bat': '💻',
  };
  return icons[ext] || '📄';
}

// ============ MULTER ============

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    cb(null, crypto.randomBytes(8).toString('hex') + path.extname(file.originalname));
  }
});

const siteStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const targetDir = decodeURIComponent(req.body.targetPath || SITES_DIR);
    if (!fsSync.existsSync(targetDir)) fsSync.mkdirSync(targetDir, { recursive: true });
    cb(null, targetDir);
  },
  filename: (req, file, cb) => cb(null, file.originalname)
});

const upload = multer({ storage });
const siteUpload = multer({ storage: siteStorage });

// ============ AUTH ============

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

// ============ LOGIN ============

app.post(`/${ADMIN_PATH}/api/login`, loginLimiter, async (req, res) => {
  const { username, password } = req.body;
  const user = config.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, adminPath: ADMIN_PATH });
});

// ============ SETTINGS ============

app.get(`/${ADMIN_PATH}/api/settings`, authenticateToken, (req, res) => {
  res.json(readJSON('settings.json'));
});

app.post(`/${ADMIN_PATH}/api/settings`, authenticateToken, (req, res) => {
  try { writeJSON('settings.json', req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: 'Failed to save settings' }); }
});

// ============ SYSTEM INFO ============

app.get(`/${ADMIN_PATH}/api/system`, authenticateToken, async (req, res) => {
  try {
    const [cpu, mem, disk, osInfo, currentLoad, processes] = await Promise.all([
      si.cpu(), si.mem(), si.fsSize(), si.osInfo(), si.currentLoad(), si.processes()
    ]);
    res.json({
      cpu: { model: cpu.brand, cores: cpu.cores, speed: cpu.speed, usage: currentLoad.currentLoad.toFixed(2) },
      memory: {
        total: (mem.total / 1073741824).toFixed(2),
        used: (mem.used / 1073741824).toFixed(2),
        free: (mem.free / 1073741824).toFixed(2),
        percentage: ((mem.used / mem.total) * 100).toFixed(2)
      },
      disk: disk.map(d => ({
        fs: d.fs, type: d.type,
        size: (d.size / 1073741824).toFixed(2),
        used: (d.used / 1073741824).toFixed(2),
        available: (d.available / 1073741824).toFixed(2),
        percentage: d.use.toFixed(2)
      })),
      os: {
        platform: osInfo.platform, distro: osInfo.distro,
        release: osInfo.release, hostname: osInfo.hostname,
        uptime: Math.floor(osInfo.uptime / 3600)
      },
      processes: { all: processes.all, running: processes.running, blocked: processes.blocked }
    });
  } catch (e) { res.status(500).json({ error: 'Failed to fetch system info' }); }
});

// ============ FILE MANAGEMENT ============

app.get(`/${ADMIN_PATH}/api/files`, authenticateToken, async (req, res) => {
  try {
    let dirPath = decodeURIComponent(req.query.path || UPLOAD_DIR);
    const safePath = path.resolve(dirPath);

    if (!isPathAllowed(safePath)) {
      return res.status(403).json({ error: 'Access denied', requested: safePath });
    }
    if (!fsSync.existsSync(safePath)) {
      return res.status(404).json({ error: 'Directory not found' });
    }

    const stat = await fs.stat(safePath);
    if (!stat.isDirectory()) return res.status(400).json({ error: 'Not a directory' });

    const items = await fs.readdir(safePath, { withFileTypes: true });
    const files = await Promise.all(items.map(async item => {
      try {
        const fullPath = path.join(safePath, item.name);
        const stats = await fs.stat(fullPath);
        return {
          name: item.name, isDirectory: item.isDirectory(),
          size: stats.size, modified: stats.mtime, path: fullPath
        };
      } catch (e) { return null; }
    }));

    res.json({
      files: files.filter(f => f !== null),
      currentPath: safePath,
      parentPath: isPathAllowed(path.dirname(safePath)) ? path.dirname(safePath) : null
    });
  } catch (e) {
    console.error('File list error:', e);
    res.status(500).json({ error: 'Failed to read directory: ' + e.message });
  }
});

app.post(`/${ADMIN_PATH}/api/files/create-folder`, authenticateToken, async (req, res) => {
  try {
    const targetDir = decodeURIComponent(req.body.currentPath || UPLOAD_DIR);
    const folderPath = path.resolve(path.join(targetDir, req.body.name));
    if (!isPathAllowed(folderPath)) return res.status(403).json({ error: 'Access denied' });
    await fs.mkdir(folderPath, { recursive: true });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to create folder' }); }
});

app.post(`/${ADMIN_PATH}/api/files/create-file`, authenticateToken, async (req, res) => {
  try {
    const targetDir = decodeURIComponent(req.body.currentPath || UPLOAD_DIR);
    const filePath = path.resolve(path.join(targetDir, req.body.name));
    if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
    await fs.writeFile(filePath, req.body.content || '', 'utf8');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to create file' }); }
});

app.post(`/${ADMIN_PATH}/api/files/rename`, authenticateToken, async (req, res) => {
  try {
    const oldPath = path.resolve(decodeURIComponent(req.body.oldPath));
    const newPath = path.join(path.dirname(oldPath), req.body.newName);
    if (!isPathAllowed(oldPath) || !isPathAllowed(newPath)) return res.status(403).json({ error: 'Access denied' });
    await fs.rename(oldPath, newPath);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to rename' }); }
});

app.delete(`/${ADMIN_PATH}/api/files`, authenticateToken, async (req, res) => {
  try {
    const filePath = path.resolve(decodeURIComponent(req.body.path));
    if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) await fs.rm(filePath, { recursive: true, force: true });
    else {
      await fs.unlink(filePath);
      const filesDb = readJSON('files.json');
      for (const [key, val] of Object.entries(filesDb)) {
        if (val.filename && filePath.endsWith(val.filename)) {
          delete filesDb[key]; writeJSON('files.json', filesDb); break;
        }
      }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete: ' + e.message }); }
});

// ============ FILE CONTENT (Read/Write) ============

app.get(`/${ADMIN_PATH}/api/files/content`, authenticateToken, async (req, res) => {
  try {
    const filePath = path.resolve(decodeURIComponent(req.query.path));
    if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) return res.status(400).json({ error: 'Cannot read directory' });
    if (stats.size > 10 * 1024 * 1024) return res.status(413).json({ error: 'File too large' });
    const content = await fs.readFile(filePath, 'utf8');
    res.json({ content, path: filePath, size: stats.size });
  } catch (e) { res.status(500).json({ error: 'Failed to read file: ' + e.message }); }
});

app.post(`/${ADMIN_PATH}/api/files/content`, authenticateToken, async (req, res) => {
  try {
    const filePath = path.resolve(decodeURIComponent(req.body.path));
    if (!isPathAllowed(filePath)) return res.status(403).json({ error: 'Access denied' });
    await fs.writeFile(filePath, req.body.content, 'utf8');
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to write file: ' + e.message }); }
});

// ============ FILE UPLOAD ============

app.post(`/${ADMIN_PATH}/api/upload`, authenticateToken, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const randomPath = crypto.randomBytes(5).toString('hex');
    const password = req.body.password || '';
    const fileData = {
      id: randomPath, originalName: req.file.originalname,
      filename: req.file.filename, size: req.file.size,
      uploadDate: new Date().toISOString(),
      password: password ? await bcrypt.hash(password, 10) : null
    };
    const filesDb = readJSON('files.json');
    filesDb[randomPath] = fileData;
    writeJSON('files.json', filesDb);
    res.json({
      success: true,
      downloadUrl: `${req.protocol}://${req.get('host')}/dl/${randomPath}/${encodeURIComponent(req.file.originalname)}`,
      fileInfo: fileData
    });
  } catch (e) { res.status(500).json({ error: 'Upload failed' }); }
});

app.post(`/${ADMIN_PATH}/api/sites/upload`, authenticateToken, siteUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, path: req.file.path });
  } catch (e) { res.status(500).json({ error: 'Upload failed: ' + e.message }); }
});

// ============ API VARIABLES ============

app.get(`/${ADMIN_PATH}/api/variables`, authenticateToken, (req, res) => {
  res.json(readJSON('api.json'));
});

app.post(`/${ADMIN_PATH}/api/variables`, authenticateToken, async (req, res) => {
  try {
    const { name, value, version, password, redirectDelay } = req.body;
    const apiDb = readJSON('api.json');
    const varId = crypto.randomBytes(8).toString('hex');
    apiDb[varId] = {
      name, value, version,
      password: password ? await bcrypt.hash(password, 10) : null,
      redirectDelay: redirectDelay || 0,
      createdAt: new Date().toISOString(),
      commits: [{ version, value, timestamp: new Date().toISOString() }]
    };
    writeJSON('api.json', apiDb);
    res.json({ success: true, id: varId, url: `${req.protocol}://${req.get('host')}/api/v/${varId}` });
  } catch (e) { res.status(500).json({ error: 'Failed to create variable' }); }
});

app.post(`/${ADMIN_PATH}/api/variables/:id/commit`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { value, version } = req.body;
    const apiDb = readJSON('api.json');
    if (!apiDb[id]) return res.status(404).json({ error: 'Variable not found' });
    apiDb[id].commits.push({ version, value, timestamp: new Date().toISOString() });
    apiDb[id].previousVersion = apiDb[id].version;
    apiDb[id].value = value;
    apiDb[id].version = version;
    writeJSON('api.json', apiDb);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to commit' }); }
});

app.delete(`/${ADMIN_PATH}/api/variables/:id`, authenticateToken, (req, res) => {
  try {
    const apiDb = readJSON('api.json');
    if (!apiDb[req.params.id]) return res.status(404).json({ error: 'Not found' });
    delete apiDb[req.params.id];
    writeJSON('api.json', apiDb);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});

// ============ SITES MANAGEMENT ============

app.get(`/${ADMIN_PATH}/api/sites`, authenticateToken, (req, res) => {
  const sitesDb = readJSON('sites.json');
  // Update status based on actually running processes
  for (const [id, site] of Object.entries(sitesDb)) {
    if (runningProcesses[id] || runningSiteServers[id]) {
      sitesDb[id].status = 'running';
    } else {
      sitesDb[id].status = 'stopped';
    }
  }
  res.json(sitesDb);
});

app.post(`/${ADMIN_PATH}/api/sites`, authenticateToken, async (req, res) => {
  try {
    const { name, type, port, domain } = req.body;
    const sitesDb = readJSON('sites.json');
    const siteId = crypto.randomBytes(8).toString('hex');
    const sitePath = path.join(SITES_DIR, name);

    await fs.mkdir(sitePath, { recursive: true });

    // Create default files based on type
    if (type === 'static') {
      await fs.writeFile(path.join(sitePath, 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #667eea, #764ba2); color: white; }
    .container { text-align: center; }
    h1 { font-size: 3rem; margin-bottom: 0.5rem; }
    p { opacity: 0.8; font-size: 1.2rem; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${name}</h1>
    <p>Your site is running! Edit files to customize.</p>
  </div>
</body>
</html>`);
      await fs.writeFile(path.join(sitePath, 'style.css'), `/* Add your styles here */\n`);
    } else if (type === 'nodejs') {
      await fs.writeFile(path.join(sitePath, 'package.json'), JSON.stringify({
        name, version: '1.0.0', main: 'index.js',
        scripts: { start: 'node index.js', dev: 'node index.js' },
        dependencies: { express: '^4.18.2' }
      }, null, 2));
      await fs.writeFile(path.join(sitePath, 'index.js'), `const express = require('express');
const app = express();
const PORT = ${port};

app.get('/', (req, res) => {
  res.send('<h1>${name} is running!</h1>');
});

app.listen(PORT, () => {
  console.log(\`${name} running on port \${PORT}\`);
});\n`);
    }

    sitesDb[siteId] = {
      id: siteId, name, type, port: parseInt(port), domain,
      path: sitePath, status: 'stopped', createdAt: new Date().toISOString()
    };
    writeJSON('sites.json', sitesDb);
    res.json({ success: true, site: sitesDb[siteId] });
  } catch (e) { res.status(500).json({ error: 'Failed to create site: ' + e.message }); }
});

// START SITE - Actually serves files or runs node process
app.post(`/${ADMIN_PATH}/api/sites/:id/start`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = readJSON('sites.json');
    if (!sitesDb[id]) return res.status(404).json({ error: 'Site not found' });

    const site = sitesDb[id];

    // Stop if already running
    if (runningSiteServers[id]) {
      runningSiteServers[id].close();
      delete runningSiteServers[id];
    }
    if (runningProcesses[id]) {
      runningProcesses[id].kill('SIGTERM');
      delete runningProcesses[id];
    }

    if (site.type === 'static') {
      // Serve static files with Express
      const siteApp = express();
      siteApp.use(express.static(site.path));
      siteApp.get('*', (req2, res2) => {
        const indexPath = path.join(site.path, 'index.html');
        if (fsSync.existsSync(indexPath)) res2.sendFile(indexPath);
        else res2.status(404).send('Not found');
      });

      const server = http.createServer(siteApp);
      server.listen(site.port, '0.0.0.0', () => {
        console.log(`[Sites] ${site.name} (static) started on port ${site.port}`);
        runningSiteServers[id] = server;
        sitesDb[id].status = 'running';
        writeJSON('sites.json', sitesDb);
        res.json({ success: true, message: `Static site running on port ${site.port}` });
      });

      server.on('error', (err) => {
        console.error(`[Sites] Failed to start ${site.name}:`, err.message);
        delete runningSiteServers[id];
        res.status(500).json({ error: `Port ${site.port} already in use or permission denied` });
      });
    } else {
      // Node.js / Vite / React / etc - run as child process
      let command = 'npm start';
      if (site.type === 'vite' || site.type === 'react' || site.type === 'vue') {
        command = 'npm run dev';
      } else if (site.type === 'nextjs') {
        command = 'npm run dev';
      }

      const child = spawn('sh', ['-c', command], {
        cwd: site.path,
        env: { ...process.env, PORT: site.port.toString() },
        stdio: ['pipe', 'pipe', 'pipe']
      });

      runningProcesses[id] = child;
      sitesDb[id].status = 'running';
      sitesDb[id].pid = child.pid;
      writeJSON('sites.json', sitesDb);

      let output = '';
      child.stdout.on('data', (data) => { output += data.toString(); });
      child.stderr.on('data', (data) => { output += data.toString(); });

      child.on('exit', (code) => {
        console.log(`[Sites] ${site.name} process exited with code ${code}`);
        delete runningProcesses[id];
        const db = readJSON('sites.json');
        if (db[id]) { db[id].status = 'stopped'; delete db[id].pid; writeJSON('sites.json', db); }
      });

      // Wait a bit then respond
      setTimeout(() => {
        res.json({ success: true, message: `Process started (PID: ${child.pid})`, output: output.substring(0, 500) });
      }, 1000);
    }
  } catch (e) {
    console.error('Start site error:', e);
    res.status(500).json({ error: 'Failed to start site: ' + e.message });
  }
});

// STOP SITE
app.post(`/${ADMIN_PATH}/api/sites/:id/stop`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = readJSON('sites.json');
    if (!sitesDb[id]) return res.status(404).json({ error: 'Site not found' });

    if (runningSiteServers[id]) {
      runningSiteServers[id].close();
      delete runningSiteServers[id];
    }

    if (runningProcesses[id]) {
      runningProcesses[id].kill('SIGTERM');
      // Force kill after 5 seconds
      setTimeout(() => {
        if (runningProcesses[id]) {
          try { runningProcesses[id].kill('SIGKILL'); } catch (e) {}
          delete runningProcesses[id];
        }
      }, 5000);
    }

    sitesDb[id].status = 'stopped';
    delete sitesDb[id].pid;
    writeJSON('sites.json', sitesDb);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to stop site' }); }
});

// EXECUTE COMMAND IN SITE DIRECTORY
app.post(`/${ADMIN_PATH}/api/sites/:id/exec`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { command } = req.body;
    const sitesDb = readJSON('sites.json');
    if (!sitesDb[id]) return res.status(404).json({ error: 'Site not found' });

    // Security: block dangerous commands
    const blocked = ['rm -rf /', 'mkfs', 'dd if=', ':(){', 'fork bomb', '> /dev/sd'];
    if (blocked.some(b => command.toLowerCase().includes(b))) {
      return res.status(403).json({ error: 'Command blocked for security reasons' });
    }

    const { stdout, stderr } = await execPromise(command, {
      cwd: sitesDb[id].path,
      timeout: 120000, // 2 min timeout
      maxBuffer: 1024 * 1024 * 10, // 10MB
      env: { ...process.env, PORT: sitesDb[id].port.toString() }
    });

    res.json({ stdout, stderr, success: true });
  } catch (e) {
    res.json({
      stdout: e.stdout || '',
      stderr: e.stderr || e.message,
      success: false,
      exitCode: e.code
    });
  }
});

// GET SITE LOGS
app.get(`/${ADMIN_PATH}/api/sites/:id/logs`, authenticateToken, (req, res) => {
  const { id } = req.params;
  res.json({
    running: !!(runningProcesses[id] || runningSiteServers[id]),
    pid: runningProcesses[id] ? runningProcesses[id].pid : null
  });
});

app.delete(`/${ADMIN_PATH}/api/sites/:id`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = readJSON('sites.json');
    if (!sitesDb[id]) return res.status(404).json({ error: 'Site not found' });

    // Stop if running
    if (runningSiteServers[id]) { runningSiteServers[id].close(); delete runningSiteServers[id]; }
    if (runningProcesses[id]) { runningProcesses[id].kill('SIGTERM'); delete runningProcesses[id]; }

    if (sitesDb[id].path && fsSync.existsSync(sitesDb[id].path)) {
      await fs.rm(sitesDb[id].path, { recursive: true, force: true });
    }
    delete sitesDb[id];
    writeJSON('sites.json', sitesDb);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete site' }); }
});

// ============ SECURITY ============

app.get(`/${ADMIN_PATH}/api/security`, authenticateToken, (req, res) => {
  res.json(readJSON('security.json'));
});

app.post(`/${ADMIN_PATH}/api/security`, authenticateToken, (req, res) => {
  try { writeJSON('security.json', req.body); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: 'Failed to save' }); }
});

// ============ PORT MANAGEMENT (REAL) ============

app.get(`/${ADMIN_PATH}/api/ports`, authenticateToken, (req, res) => {
  res.json(readJSON('ports.json'));
});

app.get(`/${ADMIN_PATH}/api/ports/active`, authenticateToken, async (req, res) => {
  try {
    const { stdout } = await execPromise('ss -tulnp 2>/dev/null || netstat -tulnp 2>/dev/null || echo ""');
    const lines = stdout.split('\n').filter(l => l.includes('LISTEN') || l.includes('UNCONN'));
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
      let proc = 'unknown';
      const procMatch = line.match(/users:\(\("([^"]+)"/);
      if (procMatch) proc = procMatch[1];
      if (!activePorts.find(p => p.port === port && p.protocol === protocol)) {
        activePorts.push({ port, protocol, process: proc, state: protocol === 'tcp' ? 'LISTEN' : 'UNCONN' });
      }
    }
    activePorts.sort((a, b) => a.port - b.port);
    res.json(activePorts);
  } catch (e) { res.json([]); }
});

app.post(`/${ADMIN_PATH}/api/ports`, authenticateToken, async (req, res) => {
  try {
    const { port, protocol, action, description } = req.body;
    const portsDb = readJSON('ports.json');
    const portId = crypto.randomBytes(8).toString('hex');

    portsDb[portId] = {
      id: portId, port, protocol, action, description,
      enabled: true, applied: false, createdAt: new Date().toISOString()
    };

    writeJSON('ports.json', portsDb);
    res.json({ success: true, rule: portsDb[portId] });
  } catch (e) { res.status(500).json({ error: 'Failed to add port rule' }); }
});

// APPLY PORT RULE (actually use iptables/ufw)
app.post(`/${ADMIN_PATH}/api/ports/:id/apply`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const portsDb = readJSON('ports.json');
    if (!portsDb[id]) return res.status(404).json({ error: 'Port rule not found' });

    const rule = portsDb[id];
    let cmd = '';

    // Try ufw first, then iptables
    try {
      await execPromise('which ufw');
      if (rule.action === 'allow') {
        cmd = `ufw allow ${rule.port}/${rule.protocol === 'both' ? 'tcp' : rule.protocol}`;
        if (rule.protocol === 'both') {
          await execPromise(`ufw allow ${rule.port}/tcp`);
          cmd = `ufw allow ${rule.port}/udp`;
        }
      } else {
        cmd = `ufw deny ${rule.port}/${rule.protocol === 'both' ? 'tcp' : rule.protocol}`;
        if (rule.protocol === 'both') {
          await execPromise(`ufw deny ${rule.port}/tcp`);
          cmd = `ufw deny ${rule.port}/udp`;
        }
      }
      const { stdout, stderr } = await execPromise(cmd);
      portsDb[id].applied = true;
      portsDb[id].method = 'ufw';
      writeJSON('ports.json', portsDb);
      res.json({ success: true, output: stdout || stderr, method: 'ufw' });
    } catch (ufwErr) {
      // Fallback to iptables
      try {
        const target = rule.action === 'allow' ? 'ACCEPT' : 'DROP';
        const proto = rule.protocol === 'both' ? 'tcp' : rule.protocol;
        cmd = `iptables -A INPUT -p ${proto} --dport ${rule.port} -j ${target}`;
        if (rule.protocol === 'both') {
          await execPromise(`iptables -A INPUT -p tcp --dport ${rule.port} -j ${target}`);
          cmd = `iptables -A INPUT -p udp --dport ${rule.port} -j ${target}`;
        }
        const { stdout, stderr } = await execPromise(cmd);
        portsDb[id].applied = true;
        portsDb[id].method = 'iptables';
        writeJSON('ports.json', portsDb);
        res.json({ success: true, output: stdout || stderr, method: 'iptables' });
      } catch (iptErr) {
        portsDb[id].applied = false;
        writeJSON('ports.json', portsDb);
        res.json({
          success: false,
          error: 'Need root privileges. Run server with sudo or configure firewall manually.',
          details: iptErr.message
        });
      }
    }
  } catch (e) { res.status(500).json({ error: 'Failed to apply rule: ' + e.message }); }
});

// REMOVE PORT RULE
app.post(`/${ADMIN_PATH}/api/ports/:id/remove-rule`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const portsDb = readJSON('ports.json');
    if (!portsDb[id]) return res.status(404).json({ error: 'Port rule not found' });

    const rule = portsDb[id];

    try {
      if (rule.method === 'ufw') {
        const action = rule.action === 'allow' ? 'allow' : 'deny';
        await execPromise(`ufw delete ${action} ${rule.port}/${rule.protocol === 'both' ? 'tcp' : rule.protocol}`);
        if (rule.protocol === 'both') {
          await execPromise(`ufw delete ${action} ${rule.port}/udp`);
        }
      } else {
        const target = rule.action === 'allow' ? 'ACCEPT' : 'DROP';
        await execPromise(`iptables -D INPUT -p ${rule.protocol === 'both' ? 'tcp' : rule.protocol} --dport ${rule.port} -j ${target}`);
        if (rule.protocol === 'both') {
          await execPromise(`iptables -D INPUT -p udp --dport ${rule.port} -j ${target}`);
        }
      }
    } catch (e) { /* May not exist, that's ok */ }

    portsDb[id].applied = false;
    writeJSON('ports.json', portsDb);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to remove rule' }); }
});

app.post(`/${ADMIN_PATH}/api/ports/:id/toggle`, authenticateToken, (req, res) => {
  try {
    const portsDb = readJSON('ports.json');
    if (!portsDb[req.params.id]) return res.status(404).json({ error: 'Not found' });
    portsDb[req.params.id].enabled = !portsDb[req.params.id].enabled;
    writeJSON('ports.json', portsDb);
    res.json({ success: true, enabled: portsDb[req.params.id].enabled });
  } catch (e) { res.status(500).json({ error: 'Failed to toggle' }); }
});

app.delete(`/${ADMIN_PATH}/api/ports/:id`, authenticateToken, async (req, res) => {
  try {
    const portsDb = readJSON('ports.json');
    if (!portsDb[req.params.id]) return res.status(404).json({ error: 'Not found' });

    // Remove firewall rule if applied
    const rule = portsDb[req.params.id];
    if (rule.applied) {
      try {
        if (rule.method === 'ufw') {
          await execPromise(`ufw delete ${rule.action} ${rule.port}/${rule.protocol === 'both' ? 'tcp' : rule.protocol}`);
        } else {
          const target = rule.action === 'allow' ? 'ACCEPT' : 'DROP';
          await execPromise(`iptables -D INPUT -p ${rule.protocol === 'both' ? 'tcp' : rule.protocol} --dport ${rule.port} -j ${target}`);
        }
      } catch (e) {}
    }

    delete portsDb[req.params.id];
    writeJSON('ports.json', portsDb);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Failed to delete' }); }
});

// ============ ADMIN PAGE ============

app.get(`/${ADMIN_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============ PUBLIC API ROUTES ============

app.get('/api/v/:id', async (req, res) => {
  try {
    const apiDb = readJSON('api.json');
    const variable = apiDb[req.params.id];
    if (!variable) return res.status(404).json({ error: 'Variable not found' });
    if (variable.password) {
      const valid = await bcrypt.compare(req.query.password || '', variable.password);
      if (!valid) return res.status(403).json({ error: 'Invalid password' });
    }
    res.json({ name: variable.name, value: variable.value, version: variable.version, createdAt: variable.createdAt });
  } catch (e) { res.status(500).json({ error: 'Failed to retrieve variable' }); }
});

app.get('/api/v/:id/version/:version', async (req, res) => {
  try {
    const { id, version } = req.params;
    const apiDb = readJSON('api.json');
    const variable = apiDb[id];
    if (!variable) return res.status(404).json({ error: 'Variable not found' });
    if (variable.password) {
      const valid = await bcrypt.compare(req.query.password || '', variable.password);
      if (!valid) return res.status(403).json({ error: 'Invalid password' });
    }
    if (version !== variable.version) {
      const newUrl = `${req.protocol}://${req.get('host')}/api/v/${id}${req.query.password ? '?password=' + req.query.password : ''}`;
      const delay = variable.redirectDelay || 0;
      if (delay > 0) {
        return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Version Outdated</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2)}.c{background:#fff;padding:3rem;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center;max-width:500px}h1{color:#f59e0b}.v{font-family:monospace;background:#f8fafc;padding:.5rem 1rem;border-radius:8px;display:inline-block;margin:.5rem}.cd{font-size:2rem;font-weight:700;color:#3b82f6;margin:1rem 0}a{display:inline-block;padding:.875rem 2rem;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600}</style></head>
<body><div class="c"><h1>⚠️ Version Outdated</h1><p>Old version requested.</p><span class="v">v${version}</span> → <span class="v">v${variable.version}</span><div class="cd" id="cd">${delay}</div><a href="${newUrl}">Go Now</a></div>
<script>let s=${delay};const c=document.getElementById('cd');setInterval(()=>{s--;c.textContent=s;if(s<=0)location.href='${newUrl}'},1000)</script></body></html>`);
      }
      return res.redirect(newUrl);
    }
    const commit = variable.commits.find(c => c.version === version);
    if (commit) res.json({ name: variable.name, value: commit.value, version: commit.version, timestamp: commit.timestamp });
    else res.status(404).json({ error: 'Version not found' });
  } catch (e) { res.status(500).json({ error: 'Failed to retrieve' }); }
});

// ============ FILE DOWNLOAD ============

app.get('/dl/:randomPath/:filename', async (req, res) => {
  try {
    const filesDb = readJSON('files.json');
    const fileData = filesDb[req.params.randomPath];
    if (!fileData) return res.status(404).send('File not found');
    if (fileData.password) {
      const valid = await bcrypt.compare(req.query.password || '', fileData.password);
      if (!valid) return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Password Required</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff}.c{background:#1e293b;padding:2rem;border-radius:16px;width:400px;text-align:center}input{width:100%;padding:.75rem;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#fff;font-size:1rem;margin:.5rem 0;box-sizing:border-box}button{width:100%;padding:.75rem;border:none;border-radius:8px;background:#3b82f6;color:#fff;font-size:1rem;cursor:pointer;margin-top:.5rem}</style></head>
<body><div class="c"><h2>🔒 Password Required</h2><form method="GET"><input type="password" name="password" placeholder="Enter password" required><button>Download</button></form></div></body></html>`);
    }
    const filePath = path.join(UPLOAD_DIR, fileData.filename);
    if (!fsSync.existsSync(filePath)) return res.status(404).send('File not found on disk');
    res.download(filePath, fileData.originalName);
  } catch (e) { res.status(500).send('Download failed'); }
});

// ============ START SERVER ============

if (config.ssl && config.ssl.enabled) {
  try {
    if (!fsSync.existsSync(config.ssl.certPath) || !fsSync.existsSync(config.ssl.keyPath)) throw new Error('SSL certs not found');
    const sslOpts = { cert: fsSync.readFileSync(config.ssl.certPath), key: fsSync.readFileSync(config.ssl.keyPath) };
    https.createServer(sslOpts, app).listen(443, '0.0.0.0', () => {
      console.log(`Welizium running on HTTPS:443`);
      console.log(`Admin: https://${config.ssl.domain}/${ADMIN_PATH}`);
    });
    const httpApp = express();
    httpApp.use((req, res) => res.redirect(`https://${req.headers.host}${req.url}`));
    http.createServer(httpApp).listen(PORT, '0.0.0.0', () => console.log(`HTTP redirect on :${PORT}`));
  } catch (e) {
    console.error('SSL Error:', e.message);
    app.listen(PORT, '0.0.0.0', () => console.log(`Welizium on HTTP:${PORT} — /${ADMIN_PATH}`));
  }
} else {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Welizium Admin Panel on HTTP:${PORT}`);
    console.log(`Admin: http://your-server:${PORT}/${ADMIN_PATH}`);
  });
}
