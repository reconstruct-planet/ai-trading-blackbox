# AI Trading Blackbox

AI Trading Blackbox is a premium dark crypto futures trading journal with a real login flow, server-backed trade storage, dashboard statistics, exchange connection records, and weekly review generation.

## What it does

- Sign up and log in with a real server session
- Create, edit, and delete trades
- Store screenshots as trade attachments
- Track exchange connection records
- Import CSV exports from exchange history files
- Sync Bybit read-only closed PnL records through an encrypted API connection
- Generate weekly review summaries and checklists
- Persist data in a local SQLite database so it survives reloads and restarts

## Run locally

1. Make sure Node.js 24 is available.
2. Start the app:

```bash
npm start
```

3. Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/)

## Data storage

- SQLite database: `data/app.sqlite`
- Uploaded attachments: `data/uploads/`

The `data/` directory is created automatically at runtime and is ignored by git.

## Files

- `index.html` - product shell and app surface
- `styles.css` - premium dark UI and responsive layout
- `app.js` - browser client, API calls, dashboard rendering, and interactions
- `server.mjs` - Node + SQLite backend and static file server
- `crypto-trading-journal-product-plan.md` - original product planning notes
