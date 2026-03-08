// Cloudflare Pages Function: /api/rankings
// Reads cached EDHREC commander rankings from the EDHREC_RANKINGS KV namespace
// and returns the rank for a given commander across three timeframes.
//
// KV keys written by cron_worker/worker.js:
//   "pastweek"    → JSON array of { name: string } (index + 1 = rank)
//   "pastmonth"   → JSON array of { name: string }
//   "past2years"  → JSON array of { name: string }
//   "lastUpdated" → ISO timestamp string
//
// Query param: ?commander=Atraxa%2C+Praetors%27+Voice

export async function onRequest(context) {
    const { request, env } = context;

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
    const commanderName = url.searchParams.get('commander');

    if (!commanderName || !commanderName.trim()) {
        return new Response(JSON.stringify({ error: 'Missing commander parameter' }), {
            status: 400,
            headers: corsHeaders
        });
    }

    // KV not configured (e.g. missing binding in wrangler.toml)
    if (!env.EDHREC_RANKINGS) {
        return new Response(JSON.stringify({
            error: 'EDHREC_RANKINGS KV namespace is not bound. Add it to wrangler.toml and redeploy.'
        }), { status: 503, headers: corsHeaders });
    }

    try {
        const nameLower   = commanderName.trim().toLowerCase();
        const timeframes  = ['pastweek', 'pastmonth', 'past2years'];
        const results     = {};

        for (const tf of timeframes) {
            const raw = await env.EDHREC_RANKINGS.get(tf);
            if (!raw) {
                results[tf] = 'Not cached yet — run cron Worker';
                continue;
            }

            const cardlist = JSON.parse(raw);
            const idx = cardlist.findIndex(c => c.name.toLowerCase() === nameLower);
            results[tf] = idx >= 0 ? idx + 1 : 'Unranked';
        }

        const cachedAt = await env.EDHREC_RANKINGS.get('lastUpdated');

        return new Response(JSON.stringify({
            commander:  commanderName.trim(),
            pastweek:   results.pastweek,
            pastmonth:  results.pastmonth,
            past2years: results.past2years,
            cachedAt:   cachedAt || null
        }), { status: 200, headers: corsHeaders });

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: corsHeaders
        });
    }
}
