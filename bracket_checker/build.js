// Build script for MTG Bracket Checker
// Copies static files to dist/ (for Cloudflare Pages Functions deployment)
// AND generates upload_me/ (all-in-one _worker.js for drag-and-drop upload)

const fs   = require('fs');
const path = require('path');

console.log('Building MTG Bracket Checker…\n');

// ── Clean & create dist/ ────────────────────────────────────────────────────
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir);

// ── Copy static files to dist/ ──────────────────────────────────────────────
const staticFiles = ['index.html', 'style.css', 'script.js', '_routes.json'];

console.log('Copying static files to dist/…');
staticFiles.forEach(file => {
    const src = path.join(__dirname, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(distDir, file));
        console.log(`  ✓ ${file}`);
    } else {
        console.warn(`  ⚠️  Missing: ${file}`);
    }
});

// ── Read fetch-deck logic for embedding in _worker.js ──────────────────────
// Build the Moxfield + Archidekt handler as a string to embed in the worker.
const fetchDeckLogic = `
    async function handleFetchDeck(request, url) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        };
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        const deckUrl = url.searchParams.get('url');
        if (!deckUrl) {
            return new Response(JSON.stringify({ error: "Missing URL parameter" }), { status: 400, headers: corsHeaders });
        }
        try {
            let deckListText = "", deckName = "";
            if (deckUrl.includes("moxfield.com")) {
                const match = deckUrl.match(/moxfield\\.com\\/decks\\/([a-zA-Z0-9\\-_]+)/);
                if (!match) throw new Error("Invalid Moxfield URL format");
                const apiUrl = \`https://api.moxfield.com/v2/decks/all/\${match[1]}\`;
                const response = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://www.moxfield.com/', 'Accept': 'application/json'
                    }
                });
                if (!response.ok) throw new Error(\`Moxfield API error: \${response.status}\`);
                const data = await response.json();
                deckName = data.name;
                const moxCmdrs = data.commanders ? Object.keys(data.commanders) : [];
                if (moxCmdrs.length > 0) {
                    deckListText += "Commander\\n";
                    Object.entries(data.commanders).forEach(([k, v]) => { deckListText += \`\${v.quantity} \${k}\\n\`; });
                    deckListText += "\\n";
                }
                if (data.mainboard) Object.entries(data.mainboard).forEach(([k, v]) => { deckListText += \`\${v.quantity} \${k}\\n\`; });
            } else if (deckUrl.includes("archidekt.com")) {
                const match = deckUrl.match(/archidekt\\.com\\/decks\\/(\\d+)/);
                if (!match) throw new Error("Invalid Archidekt URL format");
                const apiUrl = \`https://archidekt.com/api/decks/\${match[1]}/\`;
                const response = await fetch(apiUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Referer': 'https://archidekt.com/', 'Accept': 'application/json'
                    }
                });
                if (!response.ok) throw new Error(\`Archidekt API error: \${response.status}\`);
                const data = await response.json();
                deckName = data.name;
                if (data.cards) {
                    const cmdrs  = data.cards.filter(c => c.categories?.includes('Commander'));
                    const others = data.cards.filter(c => !c.categories?.includes('Commander') && !["Sideboard","Maybeboard"].includes(c.categories?.[0]));
                    if (cmdrs.length > 0) {
                        deckListText += "Commander\\n";
                        cmdrs.forEach(c => { deckListText += \`\${c.quantity} \${c.card.oracleCard.name}\\n\`; });
                        deckListText += "\\n";
                    }
                    others.forEach(c => { deckListText += \`\${c.quantity} \${c.card.oracleCard.name}\\n\`; });
                }
            } else {
                return new Response(JSON.stringify({ error: "Unsupported site. Currently supports Moxfield and Archidekt." }), { status: 400, headers: corsHeaders });
            }
            const cmdrMatch = deckListText.match(/^Commander\\n\\d+[xX]?\\s+(.+)$/m);
            const commander = cmdrMatch ? cmdrMatch[1].replace(/\\s*\\([A-Za-z0-9]{2,6}\\)\\s*\\d*/g,'').split(' // ')[0].trim() : null;
            return new Response(JSON.stringify({ name: deckName, list: deckListText, commander }), { status: 200, headers: corsHeaders });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
    }
`;

const rankingsLogic = `
    async function handleRankings(request, url, env) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json'
        };
        if (request.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: corsHeaders });
        }
        const commanderName = url.searchParams.get('commander');
        if (!commanderName || !commanderName.trim()) {
            return new Response(JSON.stringify({ error: 'Missing commander parameter' }), { status: 400, headers: corsHeaders });
        }
        if (!env.EDHREC_RANKINGS) {
            return new Response(JSON.stringify({ error: 'EDHREC_RANKINGS KV namespace is not bound.' }), { status: 503, headers: corsHeaders });
        }
        try {
            const nameLower = commanderName.trim().toLowerCase();
            const tfs = ['pastweek', 'pastmonth', 'past2years'];
            const results = {};
            for (const tf of tfs) {
                const raw = await env.EDHREC_RANKINGS.get(tf);
                if (!raw) { results[tf] = 'Not cached yet'; continue; }
                const list = JSON.parse(raw);
                const idx  = list.findIndex(c => c.name.toLowerCase() === nameLower);
                results[tf] = idx >= 0 ? idx + 1 : 'Unranked';
            }
            const cachedAt = await env.EDHREC_RANKINGS.get('lastUpdated');
            return new Response(JSON.stringify({
                commander: commanderName.trim(),
                pastweek: results.pastweek, pastmonth: results.pastmonth, past2years: results.past2years,
                cachedAt: cachedAt || null
            }), { status: 200, headers: corsHeaders });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
        }
    }
`;

// ── Generate dist/_worker.js ────────────────────────────────────────────────
const workerContent = `
// Auto-generated by build.js — do not edit directly.
// All-in-one Cloudflare Worker for drag-and-drop upload to Cloudflare Pages.
// For the structured Pages Functions deployment, use functions/api/ instead.

${fetchDeckLogic}

${rankingsLogic}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/fetch-deck') return handleFetchDeck(request, url);
    if (url.pathname === '/api/rankings')   return handleRankings(request, url, env);

    // Serve static assets via Cloudflare Pages ASSETS binding
    return env.ASSETS.fetch(request);
  }
};
`;

fs.writeFileSync(path.join(distDir, '_worker.js'), workerContent.trimStart());
console.log('\n  ✓ _worker.js created');

// ── Generate upload_me/ ─────────────────────────────────────────────────────
console.log('\nBuilding upload_me/ (drag-and-drop bundle)…');

const uploadDir = path.join(__dirname, 'upload_me');
if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
}
fs.mkdirSync(uploadDir);

// Copy statics
['index.html', 'style.css', 'script.js', '_routes.json'].forEach(file => {
    const src = path.join(__dirname, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(uploadDir, file));
        console.log(`  ✓ ${file}`);
    }
});

// Copy _worker.js
fs.copyFileSync(path.join(distDir, '_worker.js'), path.join(uploadDir, '_worker.js'));
console.log('  ✓ _worker.js');

// READ_ME
const readMe = `MTG Bracket Checker — Cloudflare Drag-and-Drop Upload
======================================================

You can drag this entire "upload_me" folder directly into the
Cloudflare Pages dashboard to deploy without the command line.

What's inside
-------------
  index.html    — the single-page frontend
  style.css     — dark theme styles
  script.js     — Game Changers logic (runs in the browser, no server needed)
  _routes.json  — routes /api/* to the Worker
  _worker.js    — bundled Worker handling /api/fetch-deck and /api/rankings

IMPORTANT — KV Namespace
------------------------
Before deploying, you MUST create a Cloudflare KV namespace and bind it:

  1. In the Cloudflare dashboard, go to Workers & Pages > KV.
  2. Create a namespace named "EDHREC_RANKINGS".
  3. In your Pages project settings > Functions > KV namespace bindings,
     add:  Variable name = EDHREC_RANKINGS  →  select your new namespace.

Without the KV namespace the site will still work for Game Changers
analysis; only the EDHREC Rankings card will show an error.

Cron Worker (for live EDHREC rankings)
---------------------------------------
The upload_me bundle alone doesn't schedule the EDHREC fetch.
To enable live rankings, deploy the cron_worker/ separately:

  cd cron_worker
  npm install
  npx wrangler deploy

The cron Worker runs at 3:00 AM UTC daily and populates the same
KV namespace with fresh EDHREC commander standings.

Deployment via CLI (recommended)
---------------------------------
From the bracket_checker/ directory:
  npm install
  npm run deploy

This builds dist/ and runs:
  npx wrangler pages deploy dist --project-name=bracket-checker
`;

fs.writeFileSync(path.join(uploadDir, 'READ_ME.txt'), readMe);
console.log('  ✓ READ_ME.txt');

console.log('\n✅ Build complete!');
console.log('   • dist/      → wrangler pages deploy dist');
console.log('   • upload_me/ → drag into Cloudflare Pages dashboard');
