import { writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  buildSeriesData,
  loadData,
  computeTierThresholds,
} from './archetype-utils.js'
import {
  renderArchetypeSection,
  renderSeriesShell,
  renderArchetypeTableWrap,
  typeOrder,
} from './archetype-renderer.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

function assetHash(p) {
  return createHash('md5').update(readFileSync(p)).digest('hex').slice(0, 8)
}

if (isMain) {
  const { tournaments, egmanRaw, limitlessRaw, cardsRaw } = await loadData(__dirname)

  const allTournaments = [...tournaments, ...egmanRaw, ...limitlessRaw]

  const seriesData = buildSeriesData({
    tournaments: allTournaments,
    cardsRaw,
    typeOrder,
  })

  for (const s of seriesData) {
    s.tierThresholds = computeTierThresholds(s)
  }

  const archData = seriesData.map((s) =>
    s.archetypes.map((a) => ({
      combo: a.combo,
      deckCount: a.deckCount,
    })),
  )
  const costDataBySeries = seriesData.map((s) =>
    s.archetypes.map((a) => a.costData),
  )
  const levelDataBySeries = seriesData.map((s) =>
    s.archetypes.map((a) => a.levelData),
  )

  const dataVersion = assetHash(join(__dirname, 'data', 'tournaments-all.json'))

  const shortLabel = (l) =>
    l.startsWith('ニュータイプチャレンジ 2026 ')
      ? 'NTC ' + l.slice('ニュータイプチャレンジ 2026 '.length)
      : l

  // Generate per-series shell fragments + per-archetype fragments
  let archFragCount = 0
  const deployDir = join(__dirname, 'deploy')
  await mkdir(deployDir, { recursive: true })
  for (const s of seriesData) {
    const shell = renderSeriesShell(s)
    await writeFile(join(deployDir, `archetype-grid-${s.value}.frag.html`), shell)
    for (const [comboIdx, arch] of s.archetypes.entries()) {
      const archFrag = renderArchetypeTableWrap(s.value, arch, comboIdx)
      await writeFile(join(deployDir, `archetype-grid-${s.value}-${comboIdx}.frag.html`), archFrag)
      archFragCount++
    }
  }
  console.log(`Written ${seriesData.length} shell + ${archFragCount} archetype fragments`)

  // Generate the main page shell with empty tab panes
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="initial-scale=1.0">
<title>GCG Deck Archetype Analysis</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.7/dist/chart.umd.min.js"></script>
<link rel="stylesheet" href="css-var.css?v=${assetHash(join(__dirname, 'css-var.css'))}">
<link rel="stylesheet" href="styles.css?v=${assetHash(join(__dirname, 'styles.css'))}">
<link rel="stylesheet" href="dark-mode.css?v=${assetHash(join(__dirname, 'dark-mode.css'))}">
<script>if(localStorage.getItem('dark-mode')==='true')document.documentElement.classList.add('dark-mode')</script>
</head>
<body class="page-archetype">
<div class="container">
<div class="page-nav">
  <a href="index.html">Archetype Rank</a>
  <span class="active">Archetype Analysis</span>
</div>
<button id="dark-toggle"><svg viewBox="0 0 24 24" width="18" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/></svg></button>
<h1>GCG Deck Archetype Analysis</h1>
<p class="subtitle">${allTournaments.reduce((a, s) => a + s.events.length, 0)} events · ${seriesData.reduce((a, s) => a + s.totalEvents, 0)} winning decks · ${seriesData.reduce((a, s) => a + s.totalDecks, 0)} total decks</p>

<div class="mobile-series-dropdown">
    <div class="msd-trigger" onclick="toggleSeriesDropdown(this)">
      <span class="msd-label">${shortLabel(seriesData[0].label)} · ${seriesData[0].totalEvents} events</span>
    </div>
    <div class="msd-options">
      ${(() => {
        const typeVal = (v) => v.startsWith('egman-') ? 2 : v.startsWith('limitless-') ? 3 : 1
        const groups = []
        let curType = 0
        seriesData.forEach((s, i) => {
          const t = typeVal(s.value)
          if (t !== curType) {
            curType = t
            groups.push({ label: ['NTC', 'Egman', 'Limitless'][t - 1], indices: [] })
          }
          groups[groups.length - 1].indices.push(i)
        })
        return groups.map((g) =>
          `<div class="msd-group-label">${g.label}</div>\n` +
          g.indices.map((i) => {
            const s = seriesData[i]
            return `<div class="msd-option${i === 0 ? ' active' : ''}" onclick="selectSeries('${s.value}', this)">${shortLabel(s.label)} · ${s.totalEvents} events</div>`
          }).join('\n')
        ).join('\n')
      })()}
    </div>
  </div>

    ${seriesData.map((s, i) => `<div class="tab-pane${i === 0 ? ' active' : ''}" id="series-${s.value}"></div>`).join('\n')}

<script>
const DATA_VERSION = "${dataVersion}"
const ARCH_DATA = ${JSON.stringify(archData)}
const ARCH_LABELS = ${JSON.stringify(seriesData.map((s) => s.value))}
const ARCH_TOTALS = ${JSON.stringify(seriesData.map((s) => s.totalDecks))}
const ARCH_COST_LABELS = ${JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8'])}
const ARCH_LEVEL_LABELS = ${JSON.stringify(['1', '2', '3', '4', '5', '6', '7', '8', '9'])}
const ARCH_COST_DATA = ${JSON.stringify(costDataBySeries)}
const ARCH_LEVEL_DATA = ${JSON.stringify(levelDataBySeries)}
<\/script>
<script src="dark-mode-client.js?v=${assetHash(join(__dirname, 'dark-mode-client.js'))}"></script>
<script src="archetype-client.js?v=${assetHash(join(__dirname, 'archetype-client.js'))}"></script>
<div id="deck-url-modal" class="modal-overlay" style="display:none" onclick="closeDeckUrlModal()">
  <div class="modal-content" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h2>Deck URLs</h2>
      <span class="modal-close" onclick="closeDeckUrlModal()">&times;</span>
    </div>
    <div id="deck-url-list" class="modal-body"></div>
  </div>
</div>
</div>
</body>
</html>`

  await writeFile(join(deployDir, 'archetype-analysis.html'), html)
  console.log('Written to deploy/archetype-analysis.html')
}
