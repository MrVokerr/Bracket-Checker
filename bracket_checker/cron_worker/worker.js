// Cloudflare Worker — Scheduled Cron Trigger
// Fetches EDHREC top-commander lists daily and writes them into KV.
//
// EDHREC no longer serves JSON endpoints. Rankings are now parsed from the
// embedded __NEXT_DATA__ JSON in each page's HTML.
//
// Deploy separately from the Pages site:
//   cd cron_worker && npx wrangler deploy
//
// Cron schedule (wrangler.toml): "0 3 * * *"  →  3:00 AM UTC every day
//
// KV writes:
//   "pastweek"    → JSON array of { name: string } objects (order = rank)
//   "pastmonth"   → JSON array of { name: string } objects
//   "past2years"  → JSON array of { name: string } objects
//   "lastUpdated" → ISO 8601 timestamp of last successful run

// Parse the __NEXT_DATA__ script tag and extract the top-100 cardviews array.
function parseEdhrecPage(html) {
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/s);
    if (!match) return null;
    try {
        const data = JSON.parse(match[1]);
        const cardviews = data?.props?.pageProps?.data?.container?.json_dict?.cardlists?.[0]?.cardviews;
        return Array.isArray(cardviews) && cardviews.length > 0 ? cardviews : null;
    } catch {
        return null;
    }
}

export default {
    // ── Scheduled Handler ─────────────────────────────────────────────────
    async scheduled(event, env, ctx) {
        console.log('EDHREC rankings cache update starting…');

        // EDHREC URL → KV key mapping (HTML pages with embedded __NEXT_DATA__)
        const timeframes = [
            { key: 'pastweek',   url: 'https://edhrec.com/commanders/week'  },
            { key: 'pastmonth',  url: 'https://edhrec.com/commanders/month' },
            { key: 'past2years', url: 'https://edhrec.com/commanders/year'  },
        ];
        let anySuccess = false;

        for (const { key: tf, url } of timeframes) {
            try {
                const response = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; MTG-Bracket-Checker/1.0)',
                        'Accept':     'text/html,application/xhtml+xml',
                    }
                });

                if (!response.ok) {
                    console.error(`EDHREC ${tf}: HTTP ${response.status} — keeping existing KV value`);
                    continue;
                }

                const html      = await response.text();
                const cardviews = parseEdhrecPage(html);

                if (!cardviews) {
                    console.warn(`EDHREC ${tf}: could not parse __NEXT_DATA__ — not overwriting KV`);
                    continue;
                }

                // Store only the name field; array position (0-based) = rank - 1
                const simplified = cardviews.map(c => ({ name: c.name }));
                await env.EDHREC_RANKINGS.put(tf, JSON.stringify(simplified));

                console.log(`EDHREC ${tf}: cached ${simplified.length} commanders`);
                anySuccess = true;

            } catch (error) {
                console.error(`EDHREC ${tf}: fetch error — ${error.message}`);
                // Keep existing KV value intact; don't overwrite with empty/bad data
            }
        }

        if (anySuccess) {
            await env.EDHREC_RANKINGS.put('lastUpdated', new Date().toISOString());
        }

        console.log('EDHREC rankings cache update complete');
    },

    // ── Fetch Handler (HTTP access to the Worker is blocked) ─────────────
    async fetch(request, env, ctx) {
        return new Response(
            'This Worker runs on a cron schedule only. No HTTP endpoint is exposed.',
            { status: 403 }
        );
    }
};
