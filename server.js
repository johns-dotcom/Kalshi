const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const KALSHI_API = 'https://trading-api.kalshi.com/trade-api/v2';
const KEY_ID = process.env.KALSHI_API_KEY_ID || '';
const PRIVATE_KEY = process.env.KALSHI_PRIVATE_KEY || '';

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'application/javascript',
};

function signRequest(method, path, timestamp) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const message = timestamp + nonce + method.toUpperCase() + path;
  const pk = PRIVATE_KEY.trim();

  if (pk.includes('BEGIN') && pk.includes('PRIVATE KEY')) {
    // RSA signing
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    return { signature: sign.sign(pk, 'base64'), nonce };
  } else {
    // HMAC signing
    const keyBytes = Buffer.from(pk, 'base64');
    const hmac = crypto.createHmac('sha256', keyBytes);
    hmac.update(message);
    return { signature: hmac.digest('base64'), nonce };
  }
}

function proxyToKalshi(req, res, apiPath, method) {
  const timestamp = Date.now().toString();
  const { signature, nonce } = signRequest(method, apiPath, timestamp);

  const url = new URL(KALSHI_API + apiPath);

  const options = {
    hostname: url.hostname,
    port: 443,
    path: url.pathname + url.search,
    method: method,
    headers: {
      'Content-Type': 'application/json',
      'KALSHI-ACCESS-KEY': KEY_ID,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'KALSHI-ACCESS-SIGNATURE': signature,
    },
  };

  const proxy = https.request(options, (proxyRes) => {
    let body = '';
    proxyRes.on('data', chunk => body += chunk);
    proxyRes.on('end', () => {
      res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(body);
    });
  });

  proxy.on('error', (e) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy error: ' + e.message }));
  });

  // Forward request body for POST/PUT/DELETE
  if (method !== 'GET') {
    let reqBody = '';
    req.on('data', chunk => reqBody += chunk);
    req.on('end', () => {
      if (reqBody) proxy.write(reqBody);
      proxy.end();
    });
  } else {
    proxy.end();
  }
}

const server = http.createServer((req, res) => {
  // Parse URL
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);

  // Proxy Kalshi API requests: /kalshi/... -> trading-api.kalshi.com/trade-api/v2/...
  if (parsedUrl.pathname.startsWith('/kalshi/')) {
    const apiPath = parsedUrl.pathname.replace('/kalshi', '') + parsedUrl.search;
    proxyToKalshi(req, res, apiPath, req.method);
    return;
  }

  // Serve static files
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
});
