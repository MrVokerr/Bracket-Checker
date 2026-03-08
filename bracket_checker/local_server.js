// Local development server for MTG Bracket Checker
// Handles /api/fetch-deck (live) and /api/rankings (mock; KV not available locally)
// Usage: node local_server.js   (then open http://localhost:8080)

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = 8080;

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
};

const CORS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResp(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { ...CORS, 'Content-Type': 'application/json' });
    res.end(body);
}

// ── /api/fetch-deck ──────────────────────────────────────────────────────────
async function handleFetchDeck(parsed, res) {
    const deckUrl = parsed.query.url;
    if (!deckUrl) return jsonResp(res, 400, { error: 'Missing url parameter' });

    try {
        let deckListText = '', deckName = '';

        if (deckUrl.includes('moxfield.com')) {
            const match = deckUrl.match(/moxfield\.com\/decks\/([a-zA-Z0-9\-_]+)/);
            if (!match) throw new Error('Invalid Moxfield URL format');

            const apiUrl = `https://api.moxfield.com/v2/decks/all/${match[1]}`;
            const resp = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://www.moxfield.com/',
                    'Accept': 'application/json',
                }
            });
            if (!resp.ok) throw new Error(`Moxfield API error: ${resp.status}`);

            const data = await resp.json();
            deckName = data.name || '';
            if (data.mainboard)  Object.entries(data.mainboard).forEach(([k, v])  => { deckListText += `${v.quantity} ${k}\n`; });
            if (data.commanders) Object.entries(data.commanders).forEach(([k, v]) => { deckListText += `${v.quantity} ${k}\n`; });

        } else if (deckUrl.includes('archidekt.com')) {
            const match = deckUrl.match(/archidekt\.com\/decks\/(\d+)/);
            if (!match) throw new Error('Invalid Archidekt URL format');

            const apiUrl = `https://archidekt.com/api/decks/${match[1]}/`;
            const resp = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                    'Referer': 'https://archidekt.com/',
                    'Accept': 'application/json',
                }
            });
            if (!resp.ok) throw new Error(`Archidekt API error: ${resp.status}`);

            const data = await resp.json();
            deckName = data.name || '';
            if (data.cards) {
                data.cards.forEach(c => {
                    const cat = c.categories?.[0] || '';
                    if (!['Sideboard', 'Maybeboard'].includes(cat)) {
                        deckListText += `${c.quantity} ${c.card.oracleCard.name}\n`;
                    }
                });
            }
        } else {
            return jsonResp(res, 400, { error: 'Unsupported site. Supports Moxfield and Archidekt.' });
        }

        jsonResp(res, 200, { name: deckName, list: deckListText });
    } catch (err) {
        jsonResp(res, 500, { error: err.message });
    }
}

// ── /api/rankings ────────────────────────────────────────────────────────────
function handleRankings(parsed, res) {
    // KV is not available locally — return a friendly mock response.
    const commander = parsed.query.commander || '';
    jsonResp(res, 200, {
        localDev:   true,
        commander,
        pastweek:   'Unranked',
        pastmonth:  'Unranked',
        past2years: 'Unranked',
        cachedAt:   null,
    });
}

// ── Static file server ───────────────────────────────────────────────────────
function serveStatic(pathname, res) {
    // Serve index.html for root
    if (pathname === '/' || pathname === '') pathname = '/index.html';

    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(__dirname, safePath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found');
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;

    if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        res.end();
        return;
    }

    if (pathname === '/api/fetch-deck') {
        await handleFetchDeck(parsed, res);
    } else if (pathname === '/api/rankings') {
        handleRankings(parsed, res);
    } else {
        serveStatic(pathname, res);
    }
});

server.listen(PORT, () => {
    console.log(`\n🃏 MTG Bracket Checker — local server running`);
    console.log(`   Open: http://localhost:${PORT}\n`);
    console.log('   Note: EDHREC rankings are mocked locally (requires Cloudflare deployment).');
    console.log('   Press Ctrl+C to stop.\n');
});
