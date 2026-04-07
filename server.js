const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const KALSHI_BASE = 'https://trading-api.kalshi.com';
const KEY_ID = process.env.KALSHI_API_KEY_ID || '';
const PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY || '';

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'application/javascript',
};

function signRequest(method, fullPath, timestamp) {
  const pk = PRIVATE_KEY.trim();
  // Kalshi signature format: timestamp + method + path (no body)
  const message = timestamp + method.toUpperCase() + fullPath;

  if (pk.includes('BEGIN') && pk.includes('PRIVATE KEY')) {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    return sign.sign(pk, 'base64');
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

  const timestamp = Math.floor(Date.now() / 1000).toString();
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
