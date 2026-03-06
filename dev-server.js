const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  // CRITICAL HEADERS for SQLite OPFS (SharedArrayBuffer)
  // These MUST be set on the main HTML request to enable cross-origin isolation.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');

  // Handle URL path
  let filePath = '.' + req.url.split('?')[0];
  if (filePath === './') filePath = './index.html';

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        console.log(`\x1b[31m404 - Not Found: ${filePath}\x1b[0m`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      } else {
        console.log(`\x1b[31m500 - Server Error: ${error.code}\x1b[0m`);
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error: ' + error.code);
      }
    } else {
      console.log(`\x1b[32m200 - OK: ${filePath} (${contentType})\x1b[0m`);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\x1b[32m🚀 PomoFlow Dev Server: http://localhost:${PORT}/\x1b[0m`);
  console.log('Isolation headers (COOP/COEP) are ACTIVE.');
  console.log('IMPORTANT: Perform a HARD REFRESH (Cmd+Shift+R) in your browser.');
});
