// Sort order for card types in archetype tables.
const typeOrder = {
  unit: 0,
  pilot: 1,
  command: 2,
  base: 3,
}
// Hex color values for each card color.
const colorHex = {
  Blue: '#2b6cb0',
  White: '#cbd5e0',
  Purple: '#805ad5',
  Red: '#e53e3e',
  Green: '#38a169',
  Black: '#1a202c',
  Yellow: '#d69e2e',
}

// Abbreviated labels for each card type.
const typeAbbrev = {
  UNIT: 'U',
  PILOT: 'P',
  COMMAND: 'C',
  BASE: 'B',
  RESOURCE: 'R',
  'UNIT TOKEN': 'UT',
  'UNIT・TOKEN': 'UT',
  'EX BASE': 'EB',
  'EX RESOURCE': 'ER',
}
const typeClass = (type) =>
  (type || '').replace(/[・\s]+/g, '-').toLowerCase() || 'unknown'

import {
  archetypeScore,
  archetypeScoreV2,
  getSeriesCeiling,
  getSeriesAvgTop4Rate,
  computeTierThresholds,
  getDeckTier,
} from './archetype-utils.js'

// Thresholds for card inclusion rate tier badges (80/60/40/20/0).
const ARCHETYPE_TIERS = [
  {
    min: 80,
    id: '1',
  },
  {
    min: 60,
    id: '2',
  },
  {
    min: 40,
    id: '3',
  },
  {
    min: 20,
    id: '4',
  },
  {
    min: 0,
    id: '5',
  },
]

// Returns tier ID for a given inclusion rate percentage.
function getTierId(rate) {
  return ARCHETYPE_TIERS.find((t) => parseFloat(rate) >= t.min).id
}

// Renders a tier badge span (e.g. "T1") or "--" if null.
function deckTierBadge(tier) {
  if (tier)
    return `<span class="deck-tier deck-tier-${tier.id}">${tier.label}</span> `
  return '<span class="deck-tier deck-tier-none">--</span> '
}

// Renders a small type badge span for a card type.
function typePill(type) {
  const abbr = typeAbbrev[type] || type
  const cls = typeClass(type)
  return `<span class="type-pill type-${cls}">${abbr}</span>`
}

// Renders a small colored dot span for a card color.
function colorDotSm(color) {
  const hex = colorHex[color] || '#718096'
  return `<span class="color-dot" style="background:${hex}"></span>`
}

// Renders the combo name with optional signature card names.
function renderCombo(comboStr, sigCards, aggSigCards) {
  const base = comboStr.split(' (')[0]
  const names = []
  if (sigCards) {
    for (const sig of sigCards) {
      if (!names.some((n) => n.name === sig.name))
        names.push({
          name: sig.name,
          color: sig.color,
        })
    }
  }
  if (names.length > 0) {
    const sigPart = names
      .map((sig) => `<span class="sig-${sig.color}">${sig.name}</span>`)
      .join(' <span class="sig-sep">/</span> ')
    return `<span class="as-combo">${base}</span><span class="as-sigs"> ${names.length > 2 ? '≈' : ''}(${sigPart})</span>`
  }
  if (aggSigCards && aggSigCards.length > 0) {
    const sigPart = aggSigCards
      .map((sig) => `<span class="sig-${sig.color}">${sig.name}</span>`)
      .join(' <span class="sig-sep">/</span> ')
    return `<span class="as-combo">${base}</span><span class="as-sigs"> ${aggSigCards.length > 2 ? '≈' : ''}(${sigPart})</span>`
  }
  return `<span class="as-combo">${base}</span>`
}

// Returns the local webp image path for a card ID.
function imgPath(cardId) {
  return `https://jw-assets.imgix.net/gcg-img/${cardId}.webp`
}

// Renders the card image HTML with wrapper and enlarge overlay.
function imgHtml(cardId, name) {
  return `<div class="card-img-wrapper"><img class="card-img" src="${imgPath(cardId)}" alt="${name}" loading="lazy"><div class="card-img-enlarge"><img src="${imgPath(cardId)}" alt="${name}"></div></div>`
}

// Returns an emoji for a given color name (e.g. "Blue" → "🔵").
function archetypeColorEmoji(color) {
  return (
    {
      Red: '🔴',
      Green: '🟢',
      Blue: '🔵',
      Purple: '🟣',
      Yellow: '🟡',
      Black: '⚫',
      White: '⚪',
    }[color] || ''
  )
}

// Renders a single card row: ID, stats, image, name, rate, avg dots, bar.
function renderItem(card, extraClass = '') {
  const rate = (card.inclusionRate * 100).toFixed(1)
  const tierId = getTierId(rate)
  const dots = [1, 2, 3, 4]
    .map(
      (i) =>
        `<div class="avg-dot ${i <= card.avgQty ? 'filled tier-' + i : ''}"></div>`,
    )
    .join('')

  const gameStats = (() => {
    const mainStats = []
    const secondaryStats = []
    const addStat = (bucket, label, value, description) => {
      if (value && value !== '-') {
        bucket.push(`<span class="item-stat" aria-label="${description}">${label}${value}</span>`)
      }
    }
    addStat(mainStats, 'L', card.level, `Level ${card.level}`)
    addStat(mainStats, 'C', card.cost, `Cost ${card.cost}`)
    addStat(secondaryStats, 'AP', card.ap, `Attack Power ${card.ap}`)
    addStat(secondaryStats, 'HP', card.hp, `Hit Points ${card.hp}`)
    if (!mainStats.length && !secondaryStats.length) return ''
    const mainHtml = mainStats.length ? `<div class="item-stats-main">${mainStats.join('')}</div>` : ''
    const secondaryHtml = secondaryStats.length ? `<div class="item-stats-secondary">${secondaryStats.join('')}</div>` : ''
    return `<div class="item-game-stats">${mainHtml}${secondaryHtml}</div>`
  })()

  return `<div class="archetype-item ${extraClass}${card.inWinner ? ' winner' : ''}${card.rarity?.startsWith('LR') ? ' is-lr' : ''}">
    <div class="item-header">
      <div class="item-id-group">
        ${colorDotSm(card.color)}${card.cardId}
        <span class="card-rarity">${(card.rarity || '').replace(/\+{1,2}$/, '')}</span>
      </div>
      <div class="archetype-avg">${dots}</div>
    </div>
    ${gameStats}
    ${imgHtml(card.cardId, card.name)}
    <div class="archetype-name">${card.name}</div>
    <div class="item-footer">
      <div class="item-rate" data-tier="${tierId}">${rate}%</div>
    <div class="item-icons">
      <span class="item-icon" role="img" aria-label="Decks included: ${card.decksIncluded}" title="Decks included: ${card.decksIncluded}">${card.decksIncluded}</span>
      ${card.winnerDeckCount ? `
        <span class="item-icon icon-wins" role="img" aria-label="Wins: ${card.winnerDeckCount}" title="Wins: ${card.winnerDeckCount}">${card.winnerDeckCount}</span>
      ` : ''}
    </div>
  </div>
  <div class="archetype-item-bar" data-tier="${tierId}"></div>
</div>`
}

// Renders type count badges (e.g. "UNIT: 12") for non-zero types.
function renderTypeCounts(unitCards, pilotCards, commandCards, baseCards) {
  return [
    ['UNIT', unitCards.length],
    ['PILOT', pilotCards.length],
    ['COMMAND', commandCards.length],
    ['BASE', baseCards.length],
  ]
    .filter(([_, count]) => count > 0)
    .map(
      ([type, count]) =>
        `<span class="type-badge type-badge-${type.toLowerCase()}">${type}: <span class="feature-count">${count}</span></span>`,
    )
    .join('')
}

// Renders the Core and Other unit columns for an archetype.
function renderCoreAndOtherUnits(coreUnits, otherUnits) {
  return `
    <div class="archetype-col-units">
      <div class="archetype-type-group"><h4 class="archetype-type-heading">Unit: Core</h4>${coreUnits.length ? coreUnits.map((card) => renderItem(card)).join('\n') : '<div class="other-empty-msg">No cards</div>'}</div>
      <div class="archetype-type-group"><h4 class="archetype-type-heading">Unit: Other</h4>${otherUnits.length ? otherUnits.map((card) => renderItem(card)).join('\n') : '<div class="other-empty-msg">No cards</div>'}</div>
    </div>`
}

// Renders Pilot, Command, and Base card columns (up to 4 each).
function renderPilotCommandBase(pilotCards, commandCards, baseCards) {
  const groups = [
    {
      label: 'Pilots',
      cards: pilotCards,
    },
    {
      label: 'Commands',
      cards: commandCards,
    },
    {
      label: 'Bases',
      cards: baseCards,
    },
  ].filter((group) => group.cards.length > 0)
  if (groups.length === 0) return ''
  return `
    <div class="archetype-col-others">
      ${groups
        .map(
          (group) => `
        <div class="archetype-type-group">
          <h4 class="archetype-type-heading">${group.label}</h4>
          ${group.cards
            .slice(0, 4)
            .map((card) => renderItem(card))
            .join('\n')}
        </div>
      `,
        )
        .join('\n')}
    </div>`
}

// Renders collapsible "Other Cards" section with type-grouped rows.
function renderOtherCards(filteredCards, seriesValue, comboIdx) {
  if (!filteredCards.length) return ''
  const byType = {}
  for (const card of filteredCards) {
    if (!byType[card.type]) byType[card.type] = []
    byType[card.type].push(card)
  }
  const typeLabel = {
    UNIT: 'Unit',
    PILOT: 'Pilot',
    COMMAND: 'Command',
    BASE: 'Base',
  }
  return `
  <div class="archetype-other-toggle" data-count="${filteredCards.length}" data-key="${seriesValue}-${comboIdx}">Other Cards (${filteredCards.length})</div>
  <div class="archetype-other-cards" id="archetype-other-${seriesValue}-${comboIdx}" style="display:none">
    <div class="archetype-col-units">
      <div class="archetype-type-group"><h4 class="archetype-type-heading">Other Unit</h4>${byType['UNIT'] && byType['UNIT'].length ? byType['UNIT'].map((card) => renderItem(card)).join('\n') : '<div class="other-empty-msg">No cards</div>'}</div>
    </div>
    <div class="archetype-col-others">
      ${['PILOT', 'COMMAND', 'BASE']
        .filter((type) => byType[type] && byType[type].length)
        .map(
          (type) => `
        <div class="archetype-type-group">
          <h4 class="archetype-type-heading">Other ${typeLabel[type]}</h4>
          ${byType[type].map((card) => renderItem(card)).join('\n')}
        </div>
      `,
        )
        .join('\n')}
    </div>
  </div>`
}

// Renders hidden deck URL links for winner and other decks.
function renderDeckUrlsSection(
  deckUrls,
  deckWinnerFlags,
  deckCardIds,
  seriesValue,
  comboIdx,
) {
  if (!deckUrls.length) return ''
  const winnerItems = deckUrls.filter((_, i) => deckWinnerFlags[i])
  const otherItems = deckUrls.filter((_, i) => !deckWinnerFlags[i])
  const winnerIds = deckCardIds.filter((_, i) => deckWinnerFlags[i])
  const otherIds = deckCardIds.filter((_, i) => !deckWinnerFlags[i])
  let out = ''
  if (winnerItems.length) {
    out += '<div class="deck-url-header">Winner Decks</div>'
    out += winnerItems
      .map(
        (url, i) =>
          `<a href="${url}" target="_blank" rel="noopener" class="deck-url-item deck-url-winner" data-cards="${winnerIds[i] || ''}">Deck ${i + 1}</a>`,
      )
      .join(' ')
  }
  if (otherItems.length) {
    out += '<div class="deck-url-header">Other Decks</div>'
    out += otherItems
      .map(
        (url, i) =>
          `<a href="${url}" target="_blank" rel="noopener" class="deck-url-item" data-cards="${otherIds[i] || ''}">Deck ${i + 1}</a>`,
      )
      .join(' ')
  }
  return `<div id="deck-urls-${seriesValue}-${comboIdx}" style="display:none">${out}</div>`
}

// Renders full archetype table: meta badges, units, pilots, commands, bases, other cards, deck URLs.
function renderArchetypeTableWrap(seriesValue, archetype, comboIdx) {
  const { cards, featureBadges = [], filteredCards = [] } = archetype
  const unitCards = cards.filter((card) => card.type === 'UNIT')
  const coreUnits = unitCards.filter((card) => card.inclusionRate >= 0.6)
  const otherUnits = unitCards.filter((card) => card.inclusionRate < 0.6)
  const pilotCards = cards.filter((card) => card.type === 'PILOT')
  const commandCards = cards.filter((card) => card.type === 'COMMAND')
  const baseCards = cards.filter((card) => card.type === 'BASE')

  const metaBadges = featureBadges
    .map(
      ([feat, count]) =>
        `<span class="feature-badge">${feat.replace(/[〔〕]/g, '')}: <span class="feature-count">${count}</span></span>`,
    )
    .join('')

  return `
<div class="archetype-table-wrap" id="archetype-table-${seriesValue}-${comboIdx}" ${comboIdx > 0 ? 'style="display:none"' : ''}>
  <div class="archetype-meta">
    <div class="archetype-meta-row">${metaBadges}</div>
    <div class="archetype-meta-row">${renderTypeCounts(unitCards, pilotCards, commandCards, baseCards)}</div>
  </div>
  <div class="archetype-2col-wrapper">
    ${renderCoreAndOtherUnits(coreUnits, otherUnits)}
    ${renderPilotCommandBase(pilotCards, commandCards, baseCards)}
  </div>
  ${renderOtherCards(filteredCards, seriesValue, comboIdx)}
  ${renderDeckUrlsSection(archetype.deckUrls, archetype.deckWinnerFlags, archetype.deckCardIds, seriesValue, comboIdx)}
</div>`
}

// Renders the full archetype section: selector, combo grid, charts, and per-archetype tables.
function renderArchetypeSection(series) {
  return renderSeriesShell(series,
    '\n    ' + series.archetypes
      .map((arch, comboIdx) => renderArchetypeTableWrap(series.value, arch, comboIdx))
      .join('\n    ') + '\n  '
  )
}

// Renders the series shell: selector, combo grid, charts, empty layout. No per-archetype tables.
function renderSeriesShell(series, innerTablesHtml = '') {
  const totalDecks = series.totalDecks
  const ceiling = getSeriesCeiling(series)
  const th = series.tierThresholds
  const first = series.archetypes[0]
  const firstColors = first.combo.split(' (')[0].split('+')
  const firstDots = firstColors.map(archetypeColorEmoji).join('')
  const firstScore = archetypeScoreV2(
    first.winnerDeckCount,
    first.deckCount,
    totalDecks,
    series.totalEvents,
    first.top4 ?? 0,
    undefined,
    ceiling,
    getSeriesAvgTop4Rate(series),
  )
  const firstTier =
    first.winnerDeckCount > 0 ? getDeckTier(firstScore, th) : null

  const selectTrigger = `
<div class="as-trigger" onclick="toggleArchetypeSelect('${series.value}')">
  <div class="as-trigger-label"><span class="as-dots">${firstDots}</span>${deckTierBadge(firstTier)}${renderCombo(first.combo, first.sigCards, first.aggregatedSigCards)}</div>
  <div class="as-trigger-right">
    <div class="as-trigger-stats">${first.cardCount} cards · ${first.winnerDeckCount} wins · ${first.deckCount} decks (${first.percent}%)</div>
  </div>
</div>`

  const selectOptions = series.archetypes
    .map((arch, comboIdx) => {
      const colors = arch.combo.split(' (')[0].split('+')
      const dots = colors.map(archetypeColorEmoji).join('')
      const score = archetypeScoreV2(
        arch.winnerDeckCount,
        arch.deckCount,
        totalDecks,
        series.totalEvents,
        arch.top4 ?? 0,
        undefined,
        ceiling,
        getSeriesAvgTop4Rate(series),
      )
      const tier = arch.winnerDeckCount > 0 ? getDeckTier(score, th) : null
      return `
<div class="as-option ${comboIdx === 0 ? 'active' : ''}" onclick="switchArchetype('${series.value}', ${comboIdx})" data-value="${comboIdx}">
  <div class="as-opt-label"><span class="as-dots">${dots}</span>${deckTierBadge(tier)}${renderCombo(arch.combo, arch.sigCards, arch.aggregatedSigCards)}</div>
  <div class="as-opt-stats">${arch.cardCount} cards · ${arch.winnerDeckCount} wins · ${arch.deckCount} decks (${arch.percent}%)</div>
</div>`
    })
    .join('\n')

  return `
<div data-section="archetype">
  <div class="card-grid-section">${renderCardGridByCombo(series)}</div>
  <div class="archetype-select-custom" id="as-custom-${series.value}">
    ${selectTrigger}
    <div class="as-options">
      ${selectOptions}
    </div>
  </div>
  <h3 id="archetype-${series.value}" class="archetype-section-heading"><span>Archetype Breakdown by Color Combo ． All ${series.totalDecks} Decks</span><button class="deck-url-btn" onclick="openDeckUrlModal('${series.value}')" title="Show deck URLs">📋</button></h3>
  <div class="archetype-charts-row">
    <div class="archetype-chart-box">
      <h4>Color Combo ． ${series.labelShort}</h4>
      <div class="archetype-pie"><canvas id="archetype-pie-${series.value}"></canvas></div>
    </div>
    <div class="archetype-chart-box">
      <h4>Level</h4>
      <canvas id="overview-level-chart-${series.value}"></canvas>
    </div>
    <div class="archetype-chart-box">
      <h4>Cost</h4>
      <canvas id="overview-cost-chart-${series.value}"></canvas>
    </div>
  </div>
  <div class="archetype-layout" id="archetype-layout-${series.value}">${innerTablesHtml}</div>
</div>`
}

// Selects up to 8 LR UNIT cards for a combo, distributing slots across colors evenly.
function selectCardsForCombo(cardMap) {
  const allCards = [...cardMap.values()]
  const byColor = {}
  for (const card of allCards) {
    if (!byColor[card.color]) byColor[card.color] = []
    byColor[card.color].push(card)
  }
  for (const color of Object.keys(byColor)) {
    byColor[color].sort((a, b) => b.inclusionRate - a.inclusionRate)
  }

  const colorOrder = ['Blue', 'Green', 'Purple', 'Red', 'White']
  const colors = Object.keys(byColor).sort(
    (a, b) => colorOrder.indexOf(a) - colorOrder.indexOf(b),
  )
  const selected = []
  const bothHaveTwo = colors.every((color) => byColor[color].length >= 2)
  for (const color of colors) {
    const remainingSlots = 8 - selected.length
    const otherColorCount = colors.length - 1 - colors.indexOf(color)
    const maxPerColor = bothHaveTwo ? Math.ceil(8 / colors.length) : 8
    const canTake = Math.min(
      byColor[color].length,
      maxPerColor,
      remainingSlots - otherColorCount,
    )
    if (canTake <= 0) continue
    for (let i = 0; i < canTake; i++) selected.push(byColor[color][i])
  }
  return {
    selected,
    comboColors: colors,
  }
}

// Renders the combo card grid: groups all archetypes by base combo, selects top LR UNITs per combo.
function renderCardGridByCombo(series) {
  const comboData = {}
  for (const arch of series.archetypes) {
    const combo = arch.combo.split(' (')[0]
    if (!comboData[combo]) {
      comboData[combo] = {
        cardMap: new Map(),
        deckCount: 0,
      }
    }
    comboData[combo].deckCount += arch.deckCount
    const comboColors = combo.split('+').map((c) => c.trim())
    for (const card of [...arch.cards, ...(arch.filteredCards || [])]) {
      if (card.type !== 'UNIT' || !card.rarity?.startsWith('LR')) continue
      if (!comboColors.includes(card.color)) continue
      if (!comboData[combo].cardMap.has(card.cardId)) {
        comboData[combo].cardMap.set(card.cardId, card)
      }
    }
  }
  const totalDecks = series.totalDecks
  return Object.entries(comboData)
    .sort(([, a], [, b]) => b.deckCount - a.deckCount)
    .map(([combo, { cardMap, deckCount }]) => {
      const { selected } = selectCardsForCombo(cardMap)
      const useRate = ((deckCount / totalDecks) * 100).toFixed(1)
      const hasWhite = combo.split('+').some((part) => part.trim() === 'White')
      const comboColors = combo
        .split('+')
        .map((part) => colorHex[part.trim()] || '#718096')
      const accentColor = comboColors.find(
        (_, i) => combo.split('+')[i].trim() !== 'White',
      )
      let gradClass, colorVars
      if (hasWhite) {
        gradClass = 'cg-has-white'
        colorVars = `--cg-a:${accentColor}`
      } else if (comboColors.length > 1) {
        gradClass = 'cg-has-two'
        colorVars = `--cg-a:${comboColors[0]};--cg-b:${comboColors[comboColors.length - 1]}`
      } else {
        gradClass = 'cg-has-one'
        colorVars = `--cg-a:${comboColors[0]}`
      }
      return `
    <div class="cg-combo">
      <h4 class="cg-combo-heading ${gradClass}" style="${colorVars}">${combo} (${useRate}%)</h4>
      <div class="cg-card-grid">
        ${selected
          .map(
            (card) => `
          <div class="cg-card${card.rarity?.startsWith('LR') ? ' is-lr' : ''}">
            <div class="cg-card-img">${imgHtml(card.cardId, '')}</div>
            <div class="cg-card-id">${colorDotSm(card.color)}${card.cardId}</div>
          </div>
        `,
          )
          .join('\n')}
      </div>
    </div>`
    })
    .join('\n')
}

export {
  typeOrder,
  colorHex,
  typePill,
  colorDotSm,
  imgPath,
  imgHtml,
  renderArchetypeSection,
  renderSeriesShell,
  renderArchetypeTableWrap,
  renderCardGridByCombo,
  deckTierBadge,
}
