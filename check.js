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
    const browser = await chromium.launch({ headless: false });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();

    const logs = [];
    page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));

    await page.goto(`http://localhost:${PORT}/app.html`);
    await page.waitForTimeout(3000);

    // Open planner
    await page.evaluate(() => {
        document.getElementById('focusPlannerOverlay').style.display = 'block';
    });
    await page.waitForTimeout(500);

    // Inject a fake draggable card into sidebar-areas
    const cardPos = await page.evaluate(() => {
        const container = document.getElementById('sidebar-areas');
        if (!container) return null;

        const card = document.createElement('div');
        card.className = 'area-card green';
        card.draggable = true;
        card.style.cursor = 'grab';
        card.innerHTML = `
            <div class="area-card-header">
                <div class="area-card-name">Test Task</div>
            </div>
            <div class="area-card-stats"><div class="area-drag-hint">Drag to plan</div></div>
        `;
        card.ondragstart = (e) => {
            window.startNewBlockDrag?.(e);  // uses startDrag internally
        };
        container.appendChild(card);

        const r = card.getBoundingClientRect();
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    });

    console.log('Injected card at:', cardPos);
    await page.screenshot({ path: 'check-before-drag.png' });

    if (cardPos) {
        // Perform drag using Playwright mouse API
        await page.mouse.move(cardPos.x, cardPos.y);
        await page.waitForTimeout(50);
        await page.mouse.down();
        await page.waitForTimeout(100);

        // Move slowly to trigger dragstart
        for (let i = 1; i <= 10; i++) {
            await page.mouse.move(
                cardPos.x + i * 50,
                cardPos.y + i * 5,
                { steps: 3 }
            );
            await page.waitForTimeout(80);
        }

        const ghostMidDrag = await page.evaluate(() => {
            const g = document.getElementById('drag-ghost');
            return {
                classes: g?.className,
                display: g ? getComputedStyle(g).display : null,
                left: g?.style.left,
                top: g?.style.top,
            };
        });
        console.log('Ghost mid-drag:', JSON.stringify(ghostMidDrag));
        await page.screenshot({ path: 'check-mid-drag.png' });

        await page.mouse.up();
        await page.waitForTimeout(200);
        await page.screenshot({ path: 'check-after-drag.png' });
    }

    console.log('\n=== Console logs ===');
    logs.forEach(m => console.log(m));

    await browser.close();
    server.close();
})();
