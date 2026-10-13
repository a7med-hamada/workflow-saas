const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const config = require('./config');
const { initDatabase } = require('./db');
const { authenticateRequest } = require('./auth');
const { processCompanyReminders } = require('./notifications');
const { seedDemoWorkspace } = require('./seed');

const { handleAuthRoutes } = require('./routes/authRoutes');
const { handleCompanyRoutes } = require('./routes/companyRoutes');
const { handleEmployeeRoutes } = require('./routes/employeeRoutes');
const { handleDepartmentRoutes } = require('./routes/departmentRoutes');
const { handleProjectRoutes } = require('./routes/projectRoutes');
const { handleTaskRoutes } = require('./routes/taskRoutes');
const { handleReportRoutes } = require('./routes/reportRoutes');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, payload) {
  const bodyStr = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': 'no-store'
  });
  res.end(bodyStr);
  return true;
}

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1'
  );
}

function parseJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      return resolve({});
    }
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        return resolve(req.body);
      }
      if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
        const str = req.body.toString('utf8').trim();
        if (!str) return resolve({});
        try {
          return resolve(JSON.parse(str));
        } catch (_) {
          return reject(Object.assign(new Error('Invalid JSON request body.'), { statusCode: 400 }));
        }
      }
    }
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(Object.assign(new Error('Request payload too large.'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_) {
        reject(Object.assign(new Error('Invalid JSON request body.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

let serverlessInitialized = false;
function ensureServerlessInit() {
  if (serverlessInitialized) return;
  serverlessInitialized = true;
  initDatabase();
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NOW_REGION) {
    try {
      seedDemoWorkspace({ reset: false });
    } catch (_) {}
  }
}

async function handleAppRequest(req, res) {
  try {
    ensureServerlessInit();
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const query = parsedUrl.searchParams;
    if (req.query && typeof req.query === 'object') {
      for (const [k, v] of Object.entries(req.query)) {
        if (!query.has(k) && typeof v === 'string') {
          query.set(k, v);
        }
      }
    }
    let pathname = query.get('__wf_path') || (req.query && req.query.__wf_path) || parsedUrl.pathname;
    if ((pathname === '/api/index.js' || pathname === '/api/[...path].js') && req.query && req.query.path) {
      const p = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path);
      pathname = `/api/${p.replace(/^\/+/, '')}`;
    }
    if (!pathname.startsWith('/')) pathname = `/${pathname}`;
    query.delete('__wf_path');

    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJson(res, 200, { status: 'ok', service: 'WorkFlow SaaS API', timestamp: new Date().toISOString() });
    }

    if (pathname.startsWith('/api/')) {
      const body = await parseJsonBody(req);

      // Optional Development-Only Demo Seed Endpoint
      if (pathname === '/api/demo/seed' && req.method === 'POST') {
        if (!config.isDev) {
          return sendJson(res, 403, { error: 'Demo seeding is disabled in production.' });
        }
        const info = seedDemoWorkspace({ reset: body.reset !== false });
        return sendJson(res, 200, { ok: true, demo: info });
      }

      const auth = authenticateRequest(req);
      const ctx = { pathname, query, body, auth, sendJson, getClientIp };

      // Auth routes (some public, some authenticated)
      if (handleAuthRoutes(req, res, ctx) !== false) return;

      // All remaining /api/* routes require authentication
      if (!auth) {
        return sendJson(res, 401, { error: 'Authentication required. Please log in.' });
      }

      if (handleCompanyRoutes(req, res, ctx) !== false) return;
      if (handleEmployeeRoutes(req, res, ctx) !== false) return;
      if (handleDepartmentRoutes(req, res, ctx) !== false) return;
      if (handleProjectRoutes(req, res, ctx) !== false) return;
      if (handleTaskRoutes(req, res, ctx) !== false) return;
      if (handleReportRoutes(req, res, ctx) !== false) return;

      return sendJson(res, 404, { error: `API endpoint not found: ${req.method} ${pathname}` });
    }

    // Static frontend serving from /public
    let relPath = pathname === '/' ? '/index.html' : pathname;
    const safePath = path.normalize(relPath).replace(/^(\.\.(\/|\\|$))+/, '');
    let fullPath = path.join(PUBLIC_DIR, safePath);

    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      fullPath = path.join(PUBLIC_DIR, 'index.html');
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const content = fs.readFileSync(fullPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(content);
  } catch (err) {
    const code = err.statusCode || 500;
    const safeMessage = code < 500 ? err.message : 'An unexpected server error occurred.';
    if (code >= 500 && config.isDev) {
      console.error('[Server Error]', err);
    }
    sendJson(res, code, { error: safeMessage });
  }
}

function createAppServer() {
  serverlessInitialized = true;
  return http.createServer(handleAppRequest);
}

if (require.main === module) {
  initDatabase();
  try {
    seedDemoWorkspace({ reset: false });
  } catch (_) {}
  const server = createAppServer();

  // Start background reminder & deadline check job
  const reminderTimer = setInterval(() => {
    try {
      processCompanyReminders();
    } catch (err) {
      console.error('[Reminder Job Error]', err.message);
    }
  }, config.reminderIntervalMs);
  reminderTimer.unref();

  server.listen(config.port, config.host, () => {
    console.log(`WorkFlow SaaS Server running at http://${config.host}:${config.port}`);
  });
}

function vercelServerlessHandler(req, res) {
  return handleAppRequest(req, res);
}
vercelServerlessHandler.createAppServer = createAppServer;
vercelServerlessHandler.handleAppRequest = handleAppRequest;

module.exports = vercelServerlessHandler;

