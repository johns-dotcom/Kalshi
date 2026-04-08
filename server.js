const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const KALSHI_BASE = 'https://api.elections.kalshi.com';
const KEY_ID = process.env.KALSHI_API_KEY_ID || '';
const PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY || '';

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'application/javascript',
};

function signRequest(method, fullPath, timestamp) {
  const pk = PRIVATE_KEY.trim();
  // Strip query params for signing — Kalshi signs path only
  const pathOnly = fullPath.split('?')[0];
  // Kalshi signature format: timestamp (ms) + method + path
  const message = timestamp + method.toUpperCase() + pathOnly;

  if (pk.includes('BEGIN') && pk.includes('PRIVATE KEY')) {
    // RSA-PSS with SHA-256 (required by Kalshi)
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    return sign.sign({
      key: pk,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, 'base64');
  } else {
    const keyBytes = Buffer.from(pk, 'base64');
    const hmac = crypto.createHmac('sha256', keyBytes);
    hmac.update(message);
    return hmac.digest('base64');
  }
}

function proxyToKalshi(req, res, apiPath, method) {
  if (!KEY_ID || !PRIVATE_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'API credentials not configured. Set KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY env vars.' }));
    return;
  }

  const timestamp = Date.now().toString();
  const signature = signRequest(method, apiPath, timestamp);

  const url = new URL(KALSHI_BASE + apiPath);

  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'KALSHI-ACCESS-KEY': KEY_ID,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'KALSHI-ACCESS-SIGNATURE': signature,
    },
  };

  console.log(`[proxy] ${method} ${apiPath} -> ${url.href}`);

  const proxy = https.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      console.log(`[proxy] ${proxyRes.statusCode} ${apiPath} -> ${body.substring(0, 200)}`);

      // If response isn't JSON, wrap it
      let isJson = false;
      try { JSON.parse(body); isJson = true; } catch (e) {}

      if (isJson) {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(body);
      } else {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: body.trim() || `HTTP ${proxyRes.statusCode}` }));
      }
    });
  });

  proxy.on('error', (e) => {
    console.error(`[proxy] Error: ${e.message}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
  });

  if (method !== 'GET') {
    let reqBody = '';
    req.on('data', chunk => reqBody += chunk);
    req.on('end', () => {
      if (reqBody) {
        options.headers['Content-Length'] = Buffer.byteLength(reqBody);
        proxy.write(reqBody);
      }
      proxy.end();
    });
  } else {
    proxy.end();
  }
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (parsedUrl.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Debug endpoint to check config
  if (parsedUrl.pathname === '/api/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      hasKeyId: !!KEY_ID,
      keyIdPrefix: KEY_ID ? KEY_ID.substring(0, 8) + '...' : 'NOT SET',
      hasPrivateKey: !!PRIVATE_KEY,
      privateKeyType: PRIVATE_KEY.includes('BEGIN') ? 'RSA PEM' : PRIVATE_KEY ? 'HMAC' : 'NOT SET',
    }));
    return;
  }

  // Debug: raw API response for specific endpoints
  if (parsedUrl.pathname.startsWith('/api/debug/')) {
    const routes = {
      'balance': '/portfolio/balance',
      'positions': '/portfolio/positions?settlement_status=unsettled&limit=5',
      'orders': '/portfolio/orders?status=resting&limit=5',
      'fills': '/portfolio/fills?limit=5',
    };
    const key = parsedUrl.pathname.replace('/api/debug/', '');
    const target = routes[key];
    if (!target) { res.writeHead(404); res.end('Use: /api/debug/balance, /api/debug/positions, /api/debug/orders, /api/debug/fills'); return; }
    const apiPath = '/trade-api/v2' + target;
    const timestamp = Date.now().toString();
    const pathOnly = apiPath.split('?')[0];
    const message = timestamp + 'GET' + pathOnly;
    const pk = PRIVATE_KEY.trim();
    let signature;
    if (pk.includes('BEGIN')) {
      const sign = crypto.createSign('RSA-SHA256');
      sign.update(message);
      signature = sign.sign({ key: pk, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST }, 'base64');
    }
    const url = new URL(KALSHI_BASE + apiPath);
    const opts = {
      hostname: url.hostname, port: 443, path: url.pathname + url.search, method: 'GET',
      headers: { 'Content-Type': 'application/json', 'KALSHI-ACCESS-KEY': KEY_ID, 'KALSHI-ACCESS-TIMESTAMP': timestamp, 'KALSHI-ACCESS-SIGNATURE': signature }
    };
    const proxy = https.request(opts, (pr) => {
      let body = '';
      pr.on('data', c => body += c);
      pr.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body); });
    });
    proxy.on('error', e => { res.writeHead(500); res.end(e.message); });
    proxy.end();
    return;
  }

  // Proxy Kalshi API: /kalshi/... -> trading-api.kalshi.com/trade-api/v2/...
  if (parsedUrl.pathname.startsWith('/kalshi/')) {
    const apiPath = '/trade-api/v2' + parsedUrl.pathname.replace('/kalshi', '') + parsedUrl.search;
    proxyToKalshi(req, res, apiPath, req.method);
    return;
  }

  // Static files
  let filePath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const ext = path.extname(filePath);
  const fullPath = path.join(__dirname, filePath);

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Kalshi app running on port ${PORT}`);
  console.log(`API Key configured: ${!!KEY_ID}`);
  console.log(`Private Key configured: ${!!PRIVATE_KEY}`);
});
