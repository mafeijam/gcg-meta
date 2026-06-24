# GCG Deck Archetype Rank

Static site generator for Gundam Card Game tournament analysis. Two pages: tier-table ranking (`index.html`) and per-archetype analysis (`archetype-analysis.html`).

## Commands

| Command | Action |
|---------|--------|
| `npm run build` | Full build: `node tier-table.js && node archetype-grid.js` |
| `npm run serve` | `python3 -m http.server 9090 -d deploy` |
| `npm run deploy` | `netlify deploy --prod` |
| `npx eslint .` | Lint all JS (no semicolons, single quotes) |
| `node tournament-*.js` | Scrape/re-scrape tournament data |
| `node card.js` | Fetch card DB to `data/cards.json` |
| `node download-images.js` | Download card .webp to `data/images/` |

## Pipeline

Scrapers (`tournament-all.js`, `tournament-egman.js`, `tournament-limitless.js`) → JSON in `data/` → `tier-table.js` + `archetype-grid.js` → `html/` + `deploy/`.

Build scripts use ESM with top-level `await` (Node >= 20).

## Architecture

- `archetype-utils.js` / `archetype-renderer.js` — shared data processing and HTML rendering (imported by both build scripts)
- `archetype-client.js` — client-side JS for analysis page (Chart.js, tab switching, card preview modals, sticky tabs)
- `dark-mode-client.js` — client-side dark toggle with `localStorage` + `window.onDarkModeToggle` callback pattern
- `html/` — build output (source of truth), `deploy/` — served copy (both must stay in sync)
- Analysis page pre-renders per-archetype HTML fragments at build time (lazy-loaded at runtime)
- Chart.js 4.4.7 loaded from CDN (not bundled)

## Dark mode

`dark-mode-client.js` owns toggle + visibility. Archetype charts update via `window.onDarkModeToggle` callback (set in `archetype-client.js`). Both files are loaded together.

## Conventions

- ESM (`"type": "module"`), no semicolons, single quotes, `async`/`await`
- No test framework — manual verification of generated HTML output
- No CI, no `.gitignore`, no README (until now)
- `playwright` in deps but unused
