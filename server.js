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

if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  originAgentCluster: false
}));

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

app.post(`/${ADMIN_PATH}/api/login`, loginLimiter, async (req, res) => {
  const { username, password } = req.body;

  const user = config.users.find(u => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, adminPath: ADMIN_PATH });
});

app.get(`/${ADMIN_PATH}/api/settings`, authenticateToken, async (req, res) => {
  try {
    const settings = JSON.parse(fsSync.readFileSync('settings.json', 'utf8'));
    res.json(settings);
  } catch (error) {
    res.json({
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
    });
  }
});

app.post(`/${ADMIN_PATH}/api/settings`, authenticateToken, async (req, res) => {
  try {
    fsSync.writeFileSync('settings.json', JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

app.post(`/${ADMIN_PATH}/api/files/create-folder`, authenticateToken, async (req, res) => {
  try {
    const folderPath = path.join(UPLOAD_DIR, req.body.name);
    await fs.mkdir(folderPath, { recursive: true });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

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

app.get(`/${ADMIN_PATH}/api/files`, authenticateToken, async (req, res) => {
  try {
    const dirPath = req.query.path || UPLOAD_DIR;
    const safePath = path.resolve(dirPath);
    
    const uploadsPath = path.resolve(UPLOAD_DIR);
    const sitesPath = path.resolve(path.join(__dirname, 'sites'));
    
    // Allow access to uploads directory or sites directory
    if (!safePath.startsWith(uploadsPath) && !safePath.startsWith(sitesPath)) {
      return res.status(403).json({ error: 'Access denied: Path outside allowed directories' });
    }

    if (!fsSync.existsSync(safePath)) {
      return res.status(404).json({ error: 'Directory not found' });
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

    res.json({ files: files.filter(f => f !== null), currentPath: safePath });
  } catch (error) {
    console.error('File list error:', error);
    res.status(500).json({ error: 'Failed to read directory: ' + error.message });
  }
});

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

    const filesDb = JSON.parse(fsSync.readFileSync('files.json', 'utf8'));
    filesDb[randomPath] = fileData;
    fsSync.writeFileSync('files.json', JSON.stringify(filesDb, null, 2));

    const downloadUrl = `${req.protocol}://${req.get('host')}/${randomPath}/${req.file.originalname}`;
    
    res.json({
      success: true,
      downloadUrl,
      fileInfo: fileData
    });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.delete(`/${ADMIN_PATH}/api/files`, authenticateToken, async (req, res) => {
  try {
    const filePath = req.body.path;
    const safePath = path.resolve(filePath);
    
    const uploadsPath = path.resolve(UPLOAD_DIR);
    const sitesPath = path.resolve(path.join(__dirname, 'sites'));
    
    // Allow deletion in uploads or sites directories
    if (!safePath.startsWith(uploadsPath) && !safePath.startsWith(sitesPath)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = await fs.stat(safePath);
    if (stats.isDirectory()) {
      await fs.rmdir(safePath, { recursive: true });
    } else {
      await fs.unlink(safePath);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

app.get('/:randomPath/:filename', async (req, res) => {
  try {
    const { randomPath, filename } = req.params;
    const password = req.query.password || '';

    const filesDb = JSON.parse(fsSync.readFileSync('files.json', 'utf8'));
    const fileData = filesDb[randomPath];

    if (!fileData) return res.status(404).send('File not found');

    if (fileData.password) {
      const validPassword = await bcrypt.compare(password, fileData.password);
      if (!validPassword) return res.status(403).send('Invalid password');
    }

    const filePath = path.join(UPLOAD_DIR, fileData.filename);
    res.download(filePath, fileData.originalName);
  } catch (error) {
    res.status(500).send('Download failed');
  }
});

app.get(`/${ADMIN_PATH}/api/variables`, authenticateToken, async (req, res) => {
  try {
    const apiDb = JSON.parse(fsSync.readFileSync('api.json', 'utf8'));
    res.json(apiDb);
  } catch (error) {
    res.json({});
  }
});

app.post(`/${ADMIN_PATH}/api/variables`, authenticateToken, async (req, res) => {
  try {
    const { name, value, version, password, redirectDelay } = req.body;
    
    const apiDb = JSON.parse(fsSync.readFileSync('api.json', 'utf8'));
    
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
    
    fsSync.writeFileSync('api.json', JSON.stringify(apiDb, null, 2));
    
    res.json({
      success: true,
      id: varId,
      url: `${req.protocol}://${req.get('host')}/api/${varId}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create variable' });
  }
});

app.post(`/${ADMIN_PATH}/api/variables/:id/commit`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { value, version } = req.body;
    
    const apiDb = JSON.parse(fsSync.readFileSync('api.json', 'utf8'));
    
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
    
    fsSync.writeFileSync('api.json', JSON.stringify(apiDb, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to commit version' });
  }
});

app.delete(`/${ADMIN_PATH}/api/variables/:id`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    const apiDb = JSON.parse(fsSync.readFileSync('api.json', 'utf8'));
    
    if (!apiDb[id]) {
      return res.status(404).json({ error: 'Variable not found' });
    }
    
    delete apiDb[id];
    
    fsSync.writeFileSync('api.json', JSON.stringify(apiDb, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete variable' });
  }
});

app.get('/api/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const password = req.query.password || '';
    
    const apiDb = JSON.parse(fsSync.readFileSync('api.json', 'utf8'));
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

app.get('/api/:id/v/:version', async (req, res) => {
  try {
    const { id, version } = req.params;
    const password = req.query.password || '';
    
    const apiDb = JSON.parse(fsSync.readFileSync('api.json', 'utf8'));
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
      const newUrl = `${req.protocol}://${req.get('host')}/api/${id}${password ? `?password=${password}` : ''}`;
      
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
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                margin: 0;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              }
              .container {
                background: white;
                padding: 3rem;
                border-radius: 16px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                text-align: center;
                max-width: 500px;
              }
              h1 {
                color: #f59e0b;
                margin-bottom: 1rem;
              }
              p {
                color: #64748b;
                margin-bottom: 1.5rem;
              }
              .version {
                font-family: monospace;
                background: #f8fafc;
                padding: 0.5rem 1rem;
                border-radius: 8px;
                display: inline-block;
                margin: 0.5rem;
              }
              .countdown {
                font-size: 2rem;
                font-weight: bold;
                color: #3b82f6;
                margin: 1rem 0;
              }
              a {
                display: inline-block;
                padding: 0.875rem 2rem;
                background: #3b82f6;
                color: white;
                text-decoration: none;
                border-radius: 8px;
                font-weight: 600;
                transition: all 0.2s;
              }
              a:hover {
                background: #2563eb;
                transform: translateY(-2px);
              }
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

app.get(`/${ADMIN_PATH}/api/sites`, authenticateToken, async (req, res) => {
  try {
    const sitesDb = JSON.parse(fsSync.readFileSync('sites.json', 'utf8'));
    res.json(sitesDb);
  } catch (error) {
    res.json({});
  }
});

app.post(`/${ADMIN_PATH}/api/sites`, authenticateToken, async (req, res) => {
  try {
    const { name, type, port, domain } = req.body;
    
    const sitesDb = JSON.parse(fsSync.readFileSync('sites.json', 'utf8'));
    const siteId = crypto.randomBytes(8).toString('hex');
    const sitePath = path.join(__dirname, 'sites', name);
    
    await fs.mkdir(sitePath, { recursive: true });
    
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
    
    fsSync.writeFileSync('sites.json', JSON.stringify(sitesDb, null, 2));
    
    res.json({ success: true, site: sitesDb[siteId] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create site' });
  }
});

app.post(`/${ADMIN_PATH}/api/sites/:id/start`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = JSON.parse(fsSync.readFileSync('sites.json', 'utf8'));
    
    if (!sitesDb[id]) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    sitesDb[id].status = 'running';
    fsSync.writeFileSync('sites.json', JSON.stringify(sitesDb, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start site' });
  }
});

app.post(`/${ADMIN_PATH}/api/sites/:id/stop`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = JSON.parse(fsSync.readFileSync('sites.json', 'utf8'));
    
    if (!sitesDb[id]) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    sitesDb[id].status = 'stopped';
    fsSync.writeFileSync('sites.json', JSON.stringify(sitesDb, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to stop site' });
  }
});

app.delete(`/${ADMIN_PATH}/api/sites/:id`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const sitesDb = JSON.parse(fsSync.readFileSync('sites.json', 'utf8'));
    
    if (!sitesDb[id]) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    delete sitesDb[id];
    fsSync.writeFileSync('sites.json', JSON.stringify(sitesDb, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete site' });
  }
});

app.get(`/${ADMIN_PATH}/api/security`, authenticateToken, async (req, res) => {
  try {
    const securityDb = JSON.parse(fsSync.readFileSync('security.json', 'utf8'));
    res.json(securityDb);
  } catch (error) {
    res.json({
      twoFactor: false,
      sessionTimeout: 60,
      maxAttempts: 5,
      forceHttps: false,
      hsts: false,
      firewall: true,
      blockSuspicious: true,
      ipWhitelist: []
    });
  }
});

app.post(`/${ADMIN_PATH}/api/security`, authenticateToken, async (req, res) => {
  try {
    fsSync.writeFileSync('security.json', JSON.stringify(req.body, null, 2));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save security settings' });
  }
});

app.get(`/${ADMIN_PATH}/api/ports`, authenticateToken, async (req, res) => {
  try {
    const portsDb = JSON.parse(fsSync.readFileSync('ports.json', 'utf8'));
    res.json(portsDb);
  } catch (error) {
    res.json({});
  }
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
        activePorts.push({
          port,
          protocol,
          process,
          state: protocol === 'tcp' ? 'LISTEN' : 'UNCONN'
        });
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
    
    const portsDb = JSON.parse(fsSync.readFileSync('ports.json', 'utf8'));
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
    
    fsSync.writeFileSync('ports.json', JSON.stringify(portsDb, null, 2));
    
    res.json({ success: true, rule: portsDb[portId] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add port rule' });
  }
});

app.delete(`/${ADMIN_PATH}/api/ports/:id`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const portsDb = JSON.parse(fsSync.readFileSync('ports.json', 'utf8'));
    
    if (!portsDb[id]) {
      return res.status(404).json({ error: 'Port rule not found' });
    }
    
    delete portsDb[id];
    fsSync.writeFileSync('ports.json', JSON.stringify(portsDb, null, 2));
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete port rule' });
  }
});

app.post(`/${ADMIN_PATH}/api/ports/:id/toggle`, authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const portsDb = JSON.parse(fsSync.readFileSync('ports.json', 'utf8'));
    
    if (!portsDb[id]) {
      return res.status(404).json({ error: 'Port rule not found' });
    }
    
    portsDb[id].enabled = !portsDb[id].enabled;
    fsSync.writeFileSync('ports.json', JSON.stringify(portsDb, null, 2));
    
    res.json({ success: true, enabled: portsDb[id].enabled });
  } catch (error) {
    res.status(500).json({ error: 'Failed to toggle port rule' });
  }
});

app.get(`/${ADMIN_PATH}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (config.ssl && config.ssl.enabled) {
  try {
    if (!fsSync.existsSync(config.ssl.certPath) || !fsSync.existsSync(config.ssl.keyPath)) {
      console.error('SSL certificates not found. Falling back to HTTP...');
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
    console.log('Falling back to HTTP on port 1337...');
    
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
