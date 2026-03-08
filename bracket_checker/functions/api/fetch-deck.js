// Cloudflare Pages Function: /api/fetch-deck
// Proxies deck imports from Moxfield and Archidekt.
// Copied from MTGBoardState with no modifications so they stay in sync.

export async function onRequest(context) {
    const { request } = context;

    const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
    };

    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const deckUrl = url.searchParams.get('url');

    if (!deckUrl) {
        return new Response(JSON.stringify({ error: "Missing URL parameter" }), {
            status: 400,
            headers: corsHeaders
        });
    }

    try {
        let deckListText = "";
        let deckName = "";

        // ── Moxfield ────────────────────────────────────────────────────────
        if (deckUrl.includes("moxfield.com")) {
            const match = deckUrl.match(/moxfield\.com\/decks\/([a-zA-Z0-9\-_]+)/);
            if (!match) throw new Error("Invalid Moxfield URL format");

            const deckId = match[1];
            const apiUrl = `https://api.moxfield.com/v2/decks/all/${deckId}`;

            const response = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://www.moxfield.com/',
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw new Error(`Moxfield API error: ${response.status}`);

            const data = await response.json();
            deckName = data.name;

            const moxCommanders = data.commanders ? Object.keys(data.commanders) : [];
            if (moxCommanders.length > 0) {
                deckListText += `Commander\n`;
                Object.entries(data.commanders).forEach(([cardName, details]) => {
                    deckListText += `${details.quantity} ${cardName}\n`;
                });
                deckListText += `\n`;
            }
            if (data.mainboard) {
                Object.entries(data.mainboard).forEach(([cardName, details]) => {
                    deckListText += `${details.quantity} ${cardName}\n`;
                });
            }
        }

        // ── Archidekt ───────────────────────────────────────────────────────
        else if (deckUrl.includes("archidekt.com")) {
            const match = deckUrl.match(/archidekt\.com\/decks\/(\d+)/);
            if (!match) throw new Error("Invalid Archidekt URL format");

            const deckId = match[1];
            const apiUrl = `https://archidekt.com/api/decks/${deckId}/`;

            const response = await fetch(apiUrl, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://archidekt.com/',
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) throw new Error(`Archidekt API error: ${response.status}`);

            const data = await response.json();
            deckName = data.name;

            if (data.cards) {
                const commanders = data.cards.filter(c => c.categories?.includes('Commander'));
                const others     = data.cards.filter(c => !c.categories?.includes('Commander') && !["Sideboard", "Maybeboard"].includes(c.categories?.[0]));
                if (commanders.length > 0) {
                    deckListText += `Commander\n`;
                    commanders.forEach(c => {
                        deckListText += `${c.quantity} ${c.card.oracleCard.name}\n`;
                    });
                    deckListText += `\n`;
                }
                others.forEach(c => {
                    deckListText += `${c.quantity} ${c.card.oracleCard.name}\n`;
                });
            }
        }

        // ── Unsupported ─────────────────────────────────────────────────────
        else {
            return new Response(JSON.stringify({ error: "Unsupported site. Currently supports Moxfield and Archidekt." }), {
                status: 400,
                headers: corsHeaders
            });
        }

        // Detect commander from the structured list we just built
        const cmdrMatch = deckListText.match(/^Commander\n\d+[xX]?\s+(.+)$/m);
        const commander = cmdrMatch ? cmdrMatch[1].replace(/\s*\([A-Za-z0-9]{2,6}\)\s*\d*/g, '').split(' // ')[0].trim() : null;

        return new Response(JSON.stringify({ name: deckName, list: deckListText, commander }), {
            status: 200,
            headers: corsHeaders
        });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: corsHeaders
        });
    }
}
