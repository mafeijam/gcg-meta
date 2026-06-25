# GCG Deck Archetype Rank

- **Node requirements**: Scripts (`tier-table.js`, `archetype-grid.js`) are ESM with top-level `await`; use Node ≥ 20 (`source ~/.nvm/nvm.sh && nvm use 20` before builds). `html/` and `deploy/` are generated assets and must stay in sync.
- **Styling conventions**: repo uses ESM, single quotes only, no semicolons, and manual HTML verification instead of automated tests/CI.

## High signal commands
| Command | Notes |
|---|---|
| `npm run build` | Calls `node tier-table.js && node archetype-grid.js` to regenerate `html/` and `deploy/` from `data/` (see pipeline below). Always run from repo root with Node ≥ 20. |
| `npm run serve` | `python3 -m http.server 9090 -d deploy` to inspect generated site locally. |
| `npm run deploy` | `netlify deploy --prod` (already configured for deploy/ output). |
| `npx eslint .` | Lints JS (expect the longstanding “Unexpected token '.'” due to parser limits; lint failure is already known). |
| `node tournament-*.js` | (Re-)scrape tournament CSV sources into `data/`. |
| `node card.js` | Pulls new card DB into `data/cards.json`. |
| `node download-images.js` | Fetches card `.webp` assets under `data/images/`. |

## Pipeline overview
- Scrapers populate `data/*.json`; `tier-table.js` + `archetype-grid.js` consume that data via shared helpers in `archetype-utils.js`/`archetype-renderer.js` to emit HTML/JS under `html/`/`deploy/`.
- `deploy/` is the served artifact; `html/` is the source-of-truth build. Treat both as derived—don’t edit manual changes directly inside them.
- `archetype-client.js` powers the analysis page (Chart.js charts, tabs, cards); `dark-mode-client.js` manages the toggle, exposing `window.onDarkModeToggle` for chart redraw hooks.
- Chart.js 4.4.7 is loaded via CDN, not bundled.

## Workflow reminders
- Always regenerate the build after changing data, templates, or styles before verifying — `npm run build` + manual inspection of `deploy/index.html` (desktop/mobile widths) is the acceptance step.
- New CSS must rely on defined palette variables and semantic tokens: `css-var.css` exports the palette and is toggled by `html.dark-mode`. Changes here impact both `styles.css` and `dark-mode.css` (dark-mode only holds overrides for genuinely unique colors).
- `tier-table.js` handles desktop table + mobile cards; score/tier order and mobile grid placement are sensitive—adjust both the `<td>` order and mobile CSS when adding/removing columns.
