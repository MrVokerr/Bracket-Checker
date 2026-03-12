# MTG Bracket Checker

A web tool for analyzing Commander decks against the official Magic: The Gathering bracket system. Paste a decklist or import directly from Moxfield or Archidekt to instantly see your deck's Game Changers, fast mana, stax pieces, and EDHREC popularity rankings.

**Live site:** <https://bracket-checker.pages.dev>

---

## Features

- **Game Changers detection** — checks all 53 official Game Changer cards (sourced from Scryfall `is:gamechanger`)
- **Bracket assessment** — estimates Bracket 1–2, 3, 3–4, or 4 based on Game Changer count and fast mana density
- **Notable fast mana & stax** — flags commonly powerful pieces outside the Game Changers list
- **EDHREC rankings** — shows your commander's past week / past month / past 2 year popularity rank (top 100 per timeframe, cached daily)
- **Deck import** — paste a Moxfield or Archidekt URL and the deck loads automatically
- **Commander auto-detection** — identifies the commander from the imported decklist and pre-fills the EDHREC ranking field

---

## How It Works

### Frontend

A single-page app (`index.html` + `script.js`) with no framework dependencies. All card-checking logic runs client-side.

### Backend (Cloudflare Pages Functions)

Two serverless API routes in `functions/api/`:

| Route | Purpose |
|---|---|
| `/api/fetch-deck` | Proxies Moxfield and Archidekt deck imports (avoids CORS issues) |
| `/api/rankings` | Reads commander rankings from a Cloudflare KV namespace |

### Cron Worker (`cron_worker/`)

A separate Cloudflare Worker that runs at **3 AM UTC daily**. It scrapes EDHREC's top 100 commanders per timeframe (past week, past month, past 2 years) and writes them to KV. The Pages Functions then serve this cached data to users.

```
EDHREC (HTML scrape) → Cron Worker → KV Namespace → /api/rankings → Frontend
```

---

## Project Structure

```
bracket_checker/
├── index.html              # Main page
├── style.css               # Styles
├── script.js               # All client-side logic
├── build.js                # Build script (generates dist/ and upload_me/)
├── build.bat               # Windows shortcut: node build.js
├── deploy.bat              # Windows shortcut: build + wrangler deploy
├── local_server.js         # Simple local dev server (node local_server.js)
├── wrangler.toml           # Pages config + KV binding (gitignored)
├── _routes.json            # Cloudflare routing rules
├── functions/
│   └── api/
│       ├── fetch-deck.js   # Deck import proxy
│       └── rankings.js     # KV rankings reader
├── cron_worker/
│   ├── worker.js           # Daily EDHREC scraper
│   ├── wrangler.toml       # Worker config (gitignored)
│   └── package.json
├── dist/                   # Build output (gitignored, deploy this)
└── upload_me/              # Drag-and-drop bundle for Cloudflare dashboard (gitignored)
```

---

## Local Development

```bash
npm install
node local_server.js
```

Then open <http://localhost:8080>. Note: EDHREC rankings require a deployed KV namespace and won't work locally without additional setup.

---

## Deployment

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- A [Cloudflare account](https://cloudflare.com) (free tier is sufficient)
- Wrangler CLI: `npm install -g wrangler`

### First-time setup

**1. Log in to Cloudflare:**

```bash
npx wrangler login
```

**2. Create the KV namespace:**

```bash
npx wrangler kv namespace create EDHREC_RANKINGS
```

Copy the returned `id` and paste it into both `wrangler.toml` files:

- `bracket_checker/wrangler.toml`
- `bracket_checker/cron_worker/wrangler.toml`

**3. Build and deploy the Pages site:**

```bash
node build.js
npx wrangler pages deploy dist --project-name=bracket-checker --branch=production
```

**4. Deploy the cron Worker:**

```bash
cd cron_worker
npm install
npx wrangler deploy
```

**5. Seed the KV with initial data** (the cron runs at 3 AM UTC, so seed manually first):

```bash
# Trigger the worker's scheduled handler
npx wrangler dev --remote --test-scheduled
# In another terminal:
curl "http://localhost:8787/__scheduled"
```

### Subsequent deploys

```bash
# From bracket_checker/
deploy.bat          # Windows
# or
node build.js && npx wrangler pages deploy dist --project-name=bracket-checker --branch=production
```

---

## Bracket Calculation Logic

| Condition | Result |
|---|---|
| 0 Game Changers | Bracket 1–2 |
| 1–3 Game Changers | Bracket 3 |
| 2–3 Game Changers + 2+ fast mana | Bracket 3–4 |
| 4+ Game Changers | Bracket 4 |

This follows the official Commander bracket guidelines. The tool is a starting point — final bracket determination should always involve a conversation with your pod.

---

## Data Sources

- **Game Changers list**: [Scryfall](https://scryfall.com/search?q=is%3Agamechanger) (`is:gamechanger`) — last verified 2026-03-07
- **EDHREC rankings**: Scraped from [edhrec.com](https://edhrec.com/commanders) daily (top 100 per timeframe only)
- **Deck import**: [Moxfield API](https://moxfield.com) and [Archidekt API](https://archidekt.com)

---

## Notes

- The Game Changers list is hardcoded in `script.js`. When Wizards updates the official list, update the `GAME_CHANGERS` set and redeploy.
- EDHREC rankings only cover the top 100 commanders per timeframe. Commanders outside the top 100 will show "not in top 100".
- `wrangler.toml` files are gitignored because they contain your KV namespace ID. Keep a private copy or re-create from the setup steps above.
