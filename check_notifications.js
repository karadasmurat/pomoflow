const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8099;

function startServer() {
    const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
                   '.wasm':'application/wasm', '.json':'application/json' };
    const server = http.createServer((req, res) => {
        res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
        res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
        res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
        let filePath = '.' + req.url.split('?')[0];
        if (filePath === './') filePath = './app.html';
        const ext = path.extname(filePath).toLowerCase();
        fs.readFile(filePath, (err, content) => {
            if (err) { res.writeHead(404); res.end('Not found'); return; }
            res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
            res.end(content);
        });
    });
    return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

(async () => {
    const server = await startServer();
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const logs = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));

    await page.goto(`http://localhost:${PORT}/app.html`);
    await page.waitForTimeout(3000); // Wait for init

    console.log('Checking for notification panel elements...');
    const panelExists = await page.$('#notificationPanel') !== null;
    const btnExists = await page.$('#sidenavNotificationsBtn') !== null;
    console.log(`Panel exists: ${panelExists}, Button exists: ${btnExists}`);

    if (panelExists && btnExists) {
        console.log('Clicking notification button...');
        await page.click('#sidenavNotificationsBtn');
        await page.waitForTimeout(500);

        const isOpen = await page.evaluate(() => {
            const p = document.getElementById('notificationPanel');
            return p.classList.contains('open');
        });
        console.log(`Panel has class 'open': ${isOpen}`);
        
        const transform = await page.evaluate(() => {
             const p = document.getElementById('notificationPanel');
             return window.getComputedStyle(p).transform;
        });
        console.log(`Panel transform: ${transform}`);
    }

    console.log('\n=== Console logs ===');
    logs.forEach(m => console.log(m));

    await browser.close();
    server.close();
})();
