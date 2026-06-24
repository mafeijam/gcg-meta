import { writeFile, copyFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  buildSeriesData,
  loadData,
  getDeckTier,
  computeTierThresholds,
  archetypeScore,
  archetypeScoreV2,
  getSeriesCeiling,
  getSeriesAvgTop4Rate,
} from './archetype-utils.js'
import {
  deckTierBadge,
  typeOrder,
  colorDotSm,
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

  const typeVal = (v) => v.startsWith('egman-') ? 2 : v.startsWith('limitless-') ? 3 : 1
  const seriesOrder = (v) => {
    const m = v.match(/gd(\d{2})/i)
    if (m) return 100 - parseInt(m[1])
    if (v.includes('msa')) return 98.5
    if (v.includes('other')) return 99
    return 0
  }
  seriesData.sort((a, b) => typeVal(a.value) - typeVal(b.value) || seriesOrder(a.value) - seriesOrder(b.value))

  for (const s of seriesData) {
    s.tierThresholds = computeTierThresholds(s)
  }
  const eventCounts = Object.fromEntries(
    allTournaments.map((s) => [s.value, s.events.length]),
  )

  const tierOrderMap = {
    1: 1,
    '1-5': 1.5,
    2: 2,
    '2-5': 2.5,
    3: 3,
    4: 4,
  }

  const shortLabel = (label) =>
    label.startsWith('ニュータイプチャレンジ 2026 ')
      ? 'NTC ' + label.slice('ニュータイプチャレンジ 2026 '.length)
      : label

  const seriesTables = seriesData
    .map((s, i) => {
      const rows = s.archetypes
        .map((a, origIdx) => ({
 a, origIdx 
}))
        .filter(({ a }) => a.deckCount > 0)
        .map(({ a, origIdx }) => {
          const useRate = (a.deckCount / s.totalDecks) * 100
          const winRateEvent = (a.winnerDeckCount / s.totalEvents) * 100
          const winRateDeck = (a.winnerDeckCount / a.deckCount) * 100
          const colors = a.combo.split(' (')[0].split('+')
          const score = archetypeScoreV2(
            a.winnerDeckCount,
            a.deckCount,
            s.totalDecks,
            s.totalEvents,
            a.top4 ?? 0,
            undefined,
            getSeriesCeiling(s),
            getSeriesAvgTop4Rate(s),
          )
          const tier =
            a.winnerDeckCount > 0 ? getDeckTier(score, s.tierThresholds) : null
          const tierOrder = tier ? (tierOrderMap[tier.id] ?? 99) : 99
          const sigs = (a.aggregatedSigCards && a.aggregatedSigCards.length > 0)
            ? a.aggregatedSigCards
            : a.sigCards
          const sigCount = sigs ? sigs.length : 0
          const sigCards = sigCount > 0
            ? sigs.map((s) => s.name).join(' / ')
            : ''
            return {
              combo: a.combo.split(' (')[0],
              sigCards,
              sigCount,
              origIdx,
              colors,
              deckCount: a.deckCount,
              winnerDeckCount: a.winnerDeckCount,
              top4: a.top4 ?? 0,
              top4PerDeck: a.deckCount > 0 ? (a.top4 ?? 0) / a.deckCount : 0,
              useRate,
            winRateEvent,
            winRateDeck,
            score,
            tier,
            tierOrder,
          }
        })
        .sort((a, b) => a.tierOrder - b.tierOrder || b.score - a.score)

      const rowsHtml = rows
        .map((r) => {
          const tierHtml =
            r.tier === null
              ? '<span class="deck-tier deck-tier-none">--</span>'
              : deckTierBadge(r.tier)
          return `<tr>
        <td class="combo-td">
          <a href="archetype-analysis.html?series=${s.value}&archetype=${r.origIdx}" class="arch-link">
            <span class="combo-name-wrapper">
              ${r.colors.map((c) => colorDotSm(c, '0 3px 0 0')).join('')}
              <span class="combo-base">${r.combo}</span>
            </span>
            ${r.sigCards ? `<span class="sig-cards"> ${r.sigCount > 2 ? '≈' : ''}(${r.sigCards})</span>` : ''}
          </a>
        </td>
        <td class="num" data-label="Decks">${r.deckCount}</td>
        <td class="num" data-label="Wins">${r.winnerDeckCount}</td>
        <td class="num" data-label="Top4">${r.top4}</td>
        <td class="num" data-label="Use%">${r.useRate.toFixed(1)}%</td>
        <td class="num" data-label="Win/Ev">${r.winRateEvent.toFixed(1)}%</td>
        <td class="num" data-label="Win/Dk">${r.winRateDeck.toFixed(1)}%</td>
        <td class="num" data-label="T4/Dk">${(r.top4PerDeck * 100).toFixed(1)}%</td>
        <td class="num" data-label="Score">${r.score}</td>
        <td class="num" data-label="Tier">${tierHtml}</td>
        <td class="num analysis-td" data-label="Analysis"><a href="archetype-analysis.html?series=${s.value}&archetype=${r.origIdx}" class="analysis-cta">Analysis →</a></td>
      </tr>`
        })
        .join('\n')

      const th = s.tierThresholds
      return `<section id="series-${i}" class="series-pane${i === 0 ? ' active' : ''}">
<h2>${shortLabel(s.label)}</h2>
<p class="subtitle">${eventCounts[s.value]} events · ${s.totalEvents} winning decks · ${s.totalDecks} total decks</p>
<div class="tier-meta">
  <strong>Tier thresholds:</strong>
  ${th.filter((t) => t.min > 0).map((t) => `${t.label} ≥ ${t.min}`).join(' · ')}
</div>
<div class="table-wrap">
<table>
<colgroup>
  <col>
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:80px">
  <col style="width:100px" class="analysis-col">
</colgroup>
<thead>
  <tr>
    <th>Archetype</th>
    <th class="num">Decks</th>
    <th class="num">Wins</th>
    <th class="num">Top4</th>
    <th class="num">Use%</th>
    <th class="num">Win/Ev</th>
    <th class="num">Win/Dk</th>
    <th class="num">T4/Dk</th>
    <th class="num">Score</th>
    <th class="num">Tier</th>
    <th class="num analysis-hdr">Analysis</th>
  </tr>
</thead>
<tbody>
${rowsHtml}
</tbody>
</table>
</div>
</section>`
    })
    .join('\n')

  const groups = []
  let curType = 0
  seriesData.forEach((s, i) => {
    const t = typeVal(s.value)
    if (t !== curType) {
      curType = t
      groups.push({
        label: ['NTC', 'Egman', 'Limitless'][t - 1], indices: [],
      })
    }
    groups[groups.length - 1].indices.push(i)
  })

  const dropdownHtml = groups.map((g) =>
    `<div class="msd-group-label">${g.label}</div>
${g.indices.map((i) => `<div class="msd-option${i === 0 ? ' active' : ''}" onclick="switchSeries(${i})">${shortLabel(seriesData[i].label)} · ${eventCounts[seriesData[i].value]} events</div>`).join('\n')}`
  ).join('\n')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="initial-scale=1.0">
<title>GCG Deck Archetype Rank</title>
<link rel="stylesheet" href="tier-table.css?v=${assetHash(join(__dirname, 'tier-table.css'))}">
<link rel="stylesheet" href="dark-mode.css?v=${assetHash(join(__dirname, 'dark-mode.css'))}">
<script>if(localStorage.getItem('dark-mode')==='true')document.documentElement.classList.add('dark-mode')</script>
</head>
<body>
<div class="container">
<div class="page-nav">
  <span class="active">Archetype Rank</span>
  <a href="archetype-analysis.html">Archetype Analysis</a>
</div>
<button id="dark-toggle"><svg viewBox="0 0 24 24" width="18" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9Z"/></svg></button>
<h1>GCG Deck Archetype Rank</h1>
<p class="subtitle">${allTournaments.reduce((a, s) => a + s.events.length, 0)} events · ${seriesData.reduce((a, s) => a + s.totalEvents, 0)} winning decks · ${seriesData.reduce((a, s) => a + s.totalDecks, 0)} total decks</p>

<div class="mobile-series-dropdown">
  <div class="msd-trigger" onclick="this.nextElementSibling.classList.toggle('open')">
    <span class="msd-label">${shortLabel(seriesData[0].label)} · ${eventCounts[seriesData[0].value]} events</span>
  </div>
  <div class="msd-options">
    ${dropdownHtml}
  </div>
</div>

    ${seriesTables}
</div>

<script>
var SERIES_VALUES = ${JSON.stringify(seriesData.map((s) => s.value))}
function switchSeries(idx) {
  document.querySelectorAll('.series-pane').forEach(function(el, i) {
    el.classList.toggle('active', i === idx)
  })
  document.querySelectorAll('.msd-option').forEach(function(el, i) {
    el.classList.toggle('active', i === idx)
  })
  var activeLabel = document.querySelector('.msd-option.active')
  if (activeLabel) {
    document.querySelector('.msd-label').textContent = activeLabel.textContent
  }
  var dd = document.querySelector('.msd-options')
  if (dd) dd.classList.remove('open')
  var params = new URLSearchParams()
  params.set('series', SERIES_VALUES[idx])
  history.replaceState(null, '', window.location.pathname + '?' + params.toString())
}
var urlParams = new URLSearchParams(window.location.search)
var seriesVal = urlParams.get('series')
if (seriesVal) {
  var seriesIdx = SERIES_VALUES.indexOf(seriesVal)
  if (seriesIdx !== -1) switchSeries(seriesIdx)
}
document.addEventListener('click', function(e) {
  var dd = document.querySelector('.mobile-series-dropdown')
  if (dd && !dd.contains(e.target)) {
    var opts = dd.querySelector('.msd-options')
    if (opts) opts.classList.remove('open')
  }
})
</script>
<script src="dark-mode-client.js?v=${assetHash(join(__dirname, 'dark-mode-client.js'))}"></script>
</body>
</html>`

  const htmlDir = join(__dirname, 'html')
  await mkdir(join(__dirname, 'html'), { recursive: true })
  await writeFile(join(htmlDir, 'tier-table.html'), html)
  await copyFile(join(htmlDir, 'tier-table.html'), join(__dirname, 'deploy', 'index.html'))
  await copyFile(join(__dirname, 'tier-table.css'), join(__dirname, 'deploy', 'tier-table.css'))
  await copyFile(join(__dirname, 'dark-mode-client.js'), join(__dirname, 'deploy', 'dark-mode-client.js'))
  await copyFile(join(__dirname, 'dark-mode.css'), join(__dirname, 'deploy', 'dark-mode.css'))
  console.log('Written to html/tier-table.html (and deploy/)')
}
