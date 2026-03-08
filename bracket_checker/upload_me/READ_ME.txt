MTG Bracket Checker — Cloudflare Drag-and-Drop Upload
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
