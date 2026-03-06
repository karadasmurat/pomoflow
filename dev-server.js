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
  // Remove query strings for path resolution
  let filePath = '.' + req.url.split('?')[0];
  if (filePath === './') filePath = './index.html';

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        console.log(`\x1b[31m404 - Not Found: ${filePath}\x1b[0m`);
        res.writeHead(404);
        res.end('File not found');
      } else {
        console.log(`\x1b[31m500 - Server Error: ${error.code} for ${filePath}\x1b[0m`);
        res.writeHead(500);
        res.end('Server error: ' + error.code);
      }
    } else {
      console.log(`\x1b[32m200 - OK: ${filePath} (${contentType})\x1b[0m`);
      // CRITICAL: These headers are required for SQLite WASM to use SharedArrayBuffer and OPFS
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\x1b[32m🚀 PomoFlow Dev Server running at http://localhost:${PORT}/\x1b[0m`);
  console.log('Security headers (COOP/COEP) are active for SQLite OPFS support.');
  console.log('Press Ctrl+C to stop.');
});
