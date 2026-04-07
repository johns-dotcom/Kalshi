const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html',
  '.json': 'application/json',
  '.js': 'application/javascript',
};

const server = http.createServer((req, res) => {
  // API endpoint that returns credentials from env vars
  if (req.url === '/api/creds') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      keyId: process.env.KALSHI_API_KEY_ID || '',
      privateKey: process.env.KALSHI_PRIVATE_KEY || '',
    }));
    return;
  }

  // Serve static files
  let filePath = req.url === '/' ? '/index.html' : req.url;
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
