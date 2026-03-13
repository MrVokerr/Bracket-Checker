/* ============================================================
   MTG Bracket Checker — script.js
   Client-side: decklist parsing, Game Changers check,
   fast mana / stax check, bracket assessment, EDHREC ranking fetch
   ============================================================ */

// ── Game Changers ───────────────────────────────────────────────────────────
// 53 cards verified via Scryfall API (is:gamechanger) on 2026-03-07
const GAME_CHANGERS = new Set([
    "Ad Nauseam",
    "Ancient Tomb",
    "Aura Shards",
    "Biorhythm",
    "Bolas's Citadel",
    "Braids, Cabal Minion",
    "Chrome Mox",
    "Coalition Victory",
    "Consecrated Sphinx",
    "Crop Rotation",
    "Cyclonic Rift",
    "Demonic Tutor",
    "Drannith Magistrate",
    "Enlightened Tutor",
    "Farewell",
    "Field of the Dead",
    "Fierce Guardianship",
    "Force of Will",
    "Gaea's Cradle",
    "Gamble",
    "Gifts Ungiven",
    "Glacial Chasm",
    "Grand Arbiter Augustin IV",
    "Grim Monolith",
    "Humility",
    "Imperial Seal",
    "Intuition",
    "Jeska's Will",
    "Lion's Eye Diamond",
    "Mana Vault",
    "Mishra's Workshop",
    "Mox Diamond",
    "Mystical Tutor",
    "Narset, Parter of Veils",
    "Natural Order",
    "Necropotence",
    "Notion Thief",
    "Opposition Agent",
    "Orcish Bowmasters",
    "Panoptic Mirror",
    "Rhystic Study",
    "Seedborn Muse",
    "Serra's Sanctum",
    "Smothering Tithe",
    "Survival of the Fittest",
    "Teferi's Protection",
    "Tergrid, God of Fright",
    "Thassa's Oracle",
    "The One Ring",
    "The Tabernacle at Pendrell Vale",
    "Underworld Breach",
    "Vampiric Tutor",
    "Worldly Tutor",
]);

// ── Notable Fast Mana (not already on Game Changers list) ───────────────────
const FAST_MANA_NOTABLE = new Set([
    "Mana Crypt",
    "Jeweled Lotus",
    "Lotus Petal",
    "Simian Spirit Guide",
    "Elvish Spirit Guide",
    "Dockside Extortionist",
    "Mox Opal",
    "Pyretic Ritual",
    "Desperate Ritual",
    "Seething Song",
    "Dark Ritual",
    "Cabal Ritual",
    "Rite of Flame",
    "Manamorphose",
]);

// ── Notable Stax Pieces (not already on Game Changers list) ─────────────────
const STAX_NOTABLE = new Set([
    "Winter Orb",
    "Static Orb",
    "Trinisphere",
    "Sphere of Resistance",
    "Rule of Law",
    "Arcane Laboratory",
    "Aven Mindcensor",
    "Esper Sentinel",
    "Collector Ouphe",
    "Null Rod",
    "Grafdigger's Cage",
    "Cursed Totem",
    "Hushbringer",
    "Linvala, Keeper of Silence",
    "Torpor Orb",
    "Thorn of Amethyst",
    "Thalia, Guardian of Thraben",
    "Grand Abolisher",
    "Virulent Plague",
    "Ethersworn Canonist",
    "Sanctum Prelate",
]);

// ── Lookup Maps (lowercase key → original-cased value) ─────────────────────
function buildLookupMap(set) {
    const map = new Map();
    for (const card of set) {
        map.set(card.toLowerCase(), card);
    }
    return map;
}

const GC_MAP         = buildLookupMap(GAME_CHANGERS);
const FAST_MANA_MAP  = buildLookupMap(FAST_MANA_NOTABLE);
const STAX_MAP       = buildLookupMap(STAX_NOTABLE);

// ── Decklist Parsing ────────────────────────────────────────────────────────
// Handles common formats: "1 Card Name", "1x Card Name", "Card Name"
// Strips set codes like "(CMM) 152" and DFC back faces "// Back Face"
function parseDecklist(text) {
    const lines = text.trim().split('\n');
    const cards = [];
    const sectionHeaders = new Set([
        'commander', 'companion', 'sideboard', 'maybeboard',
        'mainboard', 'deck', 'creatures', 'planeswalkers',
        'instants', 'sorceries', 'artifacts', 'enchantments', 'lands',
    ]);

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines, comments, and Moxfield-style section headers
        if (!trimmed) continue;
        if (trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
        if (sectionHeaders.has(trimmed.toLowerCase())) continue;

        // Remove leading quantity: "4 " or "4x " or "4X "
        let cardName = trimmed.replace(/^\d+[xX]?\s+/, '');

        // Strip trailing set code + collector number: "(CMM) 152" or "(SET)"
        cardName = cardName.replace(/\s*\([A-Za-z0-9]{2,6}\)\s*\d*/g, '').trim();

        // Double-faced cards: take only the front face
        // e.g. "Tergrid, God of Fright // Tergrid's Lantern" → "Tergrid, God of Fright"
        if (cardName.includes(' // ')) {
            cardName = cardName.split(' // ')[0].trim();
        }

        if (cardName) cards.push(cardName);
    }

    return cards;
}

// ── Commander Detection ────────────────────────────────────────────────────
// Parses a raw card line into just the card name (strips quantity, set code, DFC back face)
function parseName(raw) {
    let n = raw.replace(/^\d+[xX]?\s+/, '');
    n = n.replace(/\s*\([A-Za-z0-9]{2,6}\)\s*\d*/g, '').trim();
    if (n.includes(' // ')) n = n.split(' // ')[0].trim();
    return n || null;
}

// Tries to identify the commander from a decklist text.
// Handles: Moxfield "Commander" section, Archidekt "// Commander (1)", MTGO *CMDR* marker.
// Returns the commander name string, or null if not found.
function detectCommander(text) {
    const lines = text.trim().split('\n');
    let inCommanderSection = false;
    const found = [];
    const allSections = new Set([
        'commander', 'commanders', 'companion', 'sideboard', 'maybeboard',
        'mainboard', 'deck', 'creatures', 'planeswalkers', 'instants',
        'sorceries', 'artifacts', 'enchantments', 'lands',
    ]);

    for (const line of lines) {
        const raw = line.trim();
        if (!raw) { inCommanderSection = false; continue; }

        // MTGO *CMDR* marker: "1 Atraxa, Praetors' Voice *CMDR*"
        const mtgoMatch = raw.match(/^\d+[xX]?\s+(.+?)\s+\*CMDR\*\s*$/i);
        if (mtgoMatch) { found.push(parseName(mtgoMatch[1])); continue; }

        // Determine if this line is a section header.
        // Both "Commander" (Moxfield) and "// Commander (1)" (Archidekt) are valid.
        const isSlashLine = raw.startsWith('//');
        const isHashLine  = raw.startsWith('#');
        const normalized  = raw.replace(/^\/\/\s*/, '').replace(/\s*\(\d+\)\s*$/, '').trim().toLowerCase();

        if (allSections.has(normalized) && !isHashLine) {
            inCommanderSection = (normalized === 'commander' || normalized === 'commanders');
            continue;
        }

        // Skip other comment/slash lines that aren't recognised section headers
        if (isSlashLine || isHashLine) continue;

        // Card line — if inside the Commander section, collect it
        if (inCommanderSection) {
            const name = parseName(raw);
            if (name) found.push(name);
        }
    }
    return found.length > 0 ? found.join(' & ') : null;
}

// ── Cross-Reference Checks ──────────────────────────────────────────────────
function findMatches(cardNames, lookupMap) {
    const found = new Set();
    for (const name of cardNames) {
        const match = lookupMap.get(name.toLowerCase());
        if (match) found.add(match);
    }
    return Array.from(found).sort();
}

// ── Bracket Assessment ──────────────────────────────────────────────────────
function getBracketAssessment(foundGC, foundFastMana, foundStax) {
    const gcCount      = foundGC.length;
    const fastManaHeavy = foundFastMana.length >= 2;

    let bracket, label, description, badgeClass;

    if (gcCount === 0) {
        bracket     = '1–2';
        badgeClass  = 'bracket12';
        label       = 'No Game Changers Detected';
        description = 'No Game Changers found. This deck may qualify for Bracket 1 or 2, depending on its overall power level, efficiency, and win conditions.';
    } else if (gcCount <= 3) {
        bracket     = '3';
        badgeClass  = 'bracket3';
        label       = 'Bracket 3 Floor';
        description = `${gcCount} Game Changer${gcCount > 1 ? 's' : ''} found. The presence of any Game Changer sets a minimum Bracket of 3 per Commander rules.`;
        if (fastManaHeavy) {
            description += ` The ${foundFastMana.length} additional fast mana pieces may push this toward Bracket 4.`;
        }
    } else {
        bracket     = '4';
        badgeClass  = 'bracket4';
        label       = 'Bracket 4 Likely';
        description = `${gcCount} Game Changers found — a concentration this high strongly indicates a Bracket 4 (high-powered / cEDH-adjacent) build.`;
    }

    // Edge case: 2-3 GCs + heavy fast mana → flag as 3–4
    if (gcCount >= 2 && gcCount <= 3 && fastManaHeavy) {
        bracket    = '3–4';
        badgeClass = 'bracket34';
        label      = 'Bracket 3–4 (High Power)';
        description = `${gcCount} Game Changers plus ${foundFastMana.length} fast mana pieces. This deck sits firmly at the high end of Bracket 3 and may be Bracket 4 in practice.`;
    }

    return { bracket, label, description, badgeClass, gcCount };
}

// ── EDHREC Rankings Fetch ───────────────────────────────────────────────────
async function fetchRankings(commanderName) {
    if (!commanderName.trim()) return null;
    try {
        const res = await fetch(`/api/rankings?commander=${encodeURIComponent(commanderName.trim())}`);
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
        }
        return await res.json();
    } catch (e) {
        return { error: e.message };
    }
}

// ── URL Import ──────────────────────────────────────────────────────────────
async function importDeckFromUrl(deckUrl) {
    const res = await fetch(`/api/fetch-deck?url=${encodeURIComponent(deckUrl)}`);
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
    }
    return await res.json();
}

// ── Rendering ───────────────────────────────────────────────────────────────
function renderBracket(assessment) {
    document.getElementById('bracket-display').innerHTML = `
        <div class="bracket-badge ${assessment.badgeClass}">Bracket ${assessment.bracket}</div>
        <p class="bracket-label">${assessment.label}</p>
        <p class="bracket-desc">${assessment.description}</p>
    `;
}

function renderGameChangers(foundGC) {
    const el = document.getElementById('gc-display');
    if (foundGC.length === 0) {
        el.innerHTML = '<p class="none-found">✓ No Game Changers detected</p>';
        return;
    }
    el.innerHTML = `
        <p class="gc-count">${foundGC.length} of 53 Game Changers found:</p>
        <ul class="card-list">
            ${foundGC.map(c => `<li><a href="https://scryfall.com/search?q=${encodeURIComponent(`!"${c}"`)}" target="_blank" rel="noopener noreferrer">${c}</a></li>`).join('')}
        </ul>
    `;
}

function renderNotable(foundFastMana, foundStax) {
    const el = document.getElementById('notable-display');
    let html = '';

    if (foundFastMana.length > 0) {
        html += `
            <p class="notable-category">Fast Mana (${foundFastMana.length}):</p>
            <ul class="card-list">
                ${foundFastMana.map(c => `<li><a href="https://scryfall.com/search?q=${encodeURIComponent(`!"${c}"`)}" target="_blank" rel="noopener noreferrer">${c}</a></li>`).join('')}
            </ul>
        `;
    }
    if (foundStax.length > 0) {
        html += `
            <p class="notable-category">Stax Pieces (${foundStax.length}):</p>
            <ul class="card-list">
                ${foundStax.map(c => `<li><a href="https://scryfall.com/search?q=${encodeURIComponent(`!"${c}"`)}" target="_blank" rel="noopener noreferrer">${c}</a></li>`).join('')}
            </ul>
        `;
    }
    if (!html) {
        html = '<p class="none-found">✓ No notable fast mana or stax pieces detected</p>';
    }
    el.innerHTML = html;
}

function renderEDHREC(rankings, commanderName) {
    const el = document.getElementById('edhrec-display');

    if (!rankings) {
        el.innerHTML = '<p class="text-muted">Enter a commander name to see rankings.</p>';
        return;
    }
    if (rankings.localDev) {
        el.innerHTML = '<p class="text-muted">EDHREC rankings require a Cloudflare deployment with a configured KV namespace. Run <code>npm run deploy</code> to enable this feature.</p>';
        return;
    }
    if (rankings.error) {
        el.innerHTML = `<p class="text-muted">Rankings unavailable: ${rankings.error}</p>`;
        return;
    }

    const formatRank = (rank) => {
        if (typeof rank === 'number') return `<span class="rank">#${rank}</span>`;
        return `<span class="unranked">not in top 100</span>`;
    };

    const anyUnranked = [rankings.pastweek, rankings.pastmonth, rankings.past2years]
        .some(r => typeof r !== 'number');

    // Build slug for EDHREC link — handles partner commanders joined with ' & '
    // Partners: each name is slugified, then slugs are sorted alphabetically and joined with '-'
    // e.g. "Ardenn, Intrepid Archaeologist & Rograkh, Son of Rohgahh"
    //   → "ardenn-intrepid-archaeologist-rograkh-son-of-rohgahh"
    const slug = commanderName.split(' & ')
        .map(n => n.toLowerCase()
            .replace(/[',]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''))
        .sort()
        .join('-');

    el.innerHTML = `
        <div class="rankings-table">
            <div class="rank-row">
                <span class="rank-label">Past Week</span>
                ${formatRank(rankings.pastweek)}
            </div>
            <div class="rank-row">
                <span class="rank-label">Past Month</span>
                ${formatRank(rankings.pastmonth)}
            </div>
            <div class="rank-row">
                <span class="rank-label">Past 2 Years</span>
                ${formatRank(rankings.past2years)}
            </div>
        </div>
        ${anyUnranked ? '<p class="cache-note">Only the top 100 commanders per timeframe are tracked.</p>' : ''}
        ${rankings.cachedAt ? `<p class="cache-note">Cached: ${new Date(rankings.cachedAt).toLocaleDateString()}</p>` : ''}
        <a class="edhrec-link" href="https://edhrec.com/commanders/${slug}" target="_blank" rel="noopener noreferrer">View full ranking on EDHREC →</a>
    `;
}

// ── Main Analysis ────────────────────────────────────────────────────────────
async function runAnalysis() {
    const deckText      = document.getElementById('deckInput').value.trim();
    const commanderName = document.getElementById('commanderInput').value.trim();
    const analyzeBtn    = document.getElementById('analyzeBtn');

    if (!deckText) {
        alert('Please paste a decklist first.');
        return;
    }

    analyzeBtn.disabled    = true;
    analyzeBtn.textContent = 'Analyzing…';

    try {
        const cardNames  = parseDecklist(deckText);
        const foundGC    = findMatches(cardNames, GC_MAP);
        const foundFast  = findMatches(cardNames, FAST_MANA_MAP);
        const foundStax  = findMatches(cardNames, STAX_MAP);
        const assessment = getBracketAssessment(foundGC, foundFast, foundStax);

        // Show results immediately, then fill EDHREC async
        document.getElementById('results-section').classList.remove('hidden');
        renderBracket(assessment);
        renderGameChangers(foundGC);
        renderNotable(foundFast, foundStax);
        document.getElementById('edhrec-display').innerHTML = '<p class="text-muted">Fetching rankings…</p>';

        document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });

        const rankings = await fetchRankings(commanderName);
        renderEDHREC(rankings, commanderName);

    } finally {
        analyzeBtn.disabled    = false;
        analyzeBtn.textContent = 'Analyze Deck';
    }
}

// ── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById('analyzeBtn').addEventListener('click', runAnalysis);

document.getElementById('deckInput').addEventListener('keydown', (e) => {
    // Ctrl+Enter to analyze
    if (e.ctrlKey && e.key === 'Enter') runAnalysis();
});

// Auto-detect commander when text is pasted or typed into the deck textarea
document.getElementById('deckInput').addEventListener('input', () => {
    const detected = detectCommander(document.getElementById('deckInput').value);
    if (detected) document.getElementById('commanderInput').value = detected;
});

document.getElementById('importUrlBtn').addEventListener('click', async () => {
    const input  = document.getElementById('deckInput').value.trim();
    const status = document.getElementById('importStatus');
    const btn    = document.getElementById('importUrlBtn');

    if (!input.startsWith('http://') && !input.startsWith('https://')) {
        status.textContent = 'Please enter a Moxfield or Archidekt URL in the text box first.';
        status.className   = 'status-msg error';
        return;
    }

    btn.disabled    = true;
    btn.textContent = 'Importing…';
    status.textContent = '';
    status.className   = 'status-msg';

    try {
        const result = await importDeckFromUrl(input);
        document.getElementById('deckInput').value = result.list || '';
        // Prefer the API-supplied commander (from category data), fall back to text detection
        const detected = result.commander || detectCommander(result.list || '');
        if (detected) document.getElementById('commanderInput').value = detected;
        if (result.name) {
            const cmdrNote = detected ? ` — Commander found: ${detected}` : '';
            status.textContent = `✓ Imported: "${result.name}"${cmdrNote}`;
            status.className   = 'status-msg success';
        }
    } catch (e) {
        status.textContent = `Error: ${e.message}`;
        status.className   = 'status-msg error';
    } finally {
        btn.disabled    = false;
        btn.textContent = 'Import from URL';
    }
});
