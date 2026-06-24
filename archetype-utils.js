import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import * as ss from 'simple-statistics'

/**
 * Calculate the competitive score of an archetype used for tier determination.
 */
export function archetypeScore(wins, archDecks, totalDecks, totalEvents) {
  const winRate = (wins / totalEvents) * 100 * 6
  const useRate = (archDecks / totalDecks) * 100 * 3
  const winRateArchetype = (wins / archDecks) * 100 * 2

  return Math.round((winRate + useRate + winRateArchetype) * 10) / 10
}

/**
 * Compute a dynamic penalty ceiling per series: 2× the average archetype win rate.
 * This adapts the penalty aggressiveness to each meta's baseline performance.
 */
export function getSeriesCeiling(series) {
  const rates = series.archetypes
    .filter((a) => a.winnerDeckCount > 0)
    .map((a) => (a.winnerDeckCount / a.deckCount) * 100)
  if (rates.length === 0) return 50
  const avg = rates.reduce((a, b) => a + b, 0) / rates.length
  return avg * 2
}

/**
 * Weighted average top‑4 rate across all archetypes with at least 1 win.
 * Used as the beta‑binomial prior for top4Bonus smoothing (K=10).
 * Computes totalTop4 / totalDecks across winning archetypes in the series.
 */
export function getSeriesAvgTop4Rate(series) {
  const archs = series.archetypes.filter((a) => a.winnerDeckCount > 0)
  if (archs.length === 0) return 40
  const totalTop4 = archs.reduce((s, a) => s + (a.top4 ?? 0), 0)
  const totalDecks = archs.reduce((s, a) => s + a.deckCount, 0)
  return totalDecks > 0 ? (totalTop4 / totalDecks) * 100 : 40
}

/**
 * Score = weighted sum of eventWinShare, usageRate, archWinRate, top4Bonus
 * minus a usage+eventWinShare penalty that targets high-usage low-win-rate decks.
 */
export function archetypeScoreV2(
  wins,
  archDecks,
  totalDecks,
  totalEvents,
  top4,
  weights,
  ceiling,
  top4Prior,
) {
  if (wins === 0) return 0
  const w = weights ?? [0.5, 0.2, 0.2, 0.1]
  const eventWinShare = totalEvents > 0 ? (wins / totalEvents) * 100 : 0
  const usageRate = totalDecks > 0 ? (archDecks / totalDecks) * 100 : 0
  const ceil = ceiling ?? 50

  // Bayesian-smoothed archWinRate: pulls low-sample extremes toward series avg (ceil/2)
  const K = 10
  const prior = ceil / 2 // series average win rate
  const archWinRate =
    archDecks > 0 ? ((wins + (K * prior) / 100) / (archDecks + K)) * 100 : 0

  const top4PriorRate = top4Prior ?? 40
  const top4Bonus =
    archDecks > 0
      ? ((top4 + (K * top4PriorRate) / 100) / (archDecks + K)) * 100
      : 0
  const raw =
    eventWinShare * w[0] +
    usageRate * w[1] +
    archWinRate * w[2] +
    top4Bonus * w[3]
  const penalty = Math.max(0, usageRate * (1 - archWinRate / ceil)) * 0.15
  return Math.round((raw - penalty) * 10)
}

/**
 * Computes per-series tier thresholds using ckmeans clustering.
 */
export function computeTierThresholds(series, weights) {
  const ceiling = getSeriesCeiling(series)
  const allScores = series.archetypes
    .filter((a) => a.winnerDeckCount > 0)
    .map((a) =>
      archetypeScoreV2(
        a.winnerDeckCount,
        a.deckCount,
        series.totalDecks,
        series.totalEvents,
        a.top4 ?? 0,
        weights,
        ceiling,
        getSeriesAvgTop4Rate(series),
      ),
    )
    .sort((a, b) => b - a)

  const k = Math.min(5, allScores.length)
  let clusters
  try {
    clusters = ss.ckmeans(allScores, Math.max(1, k))
  } catch {
    // Fallback: partition sorted scores into k equal groups
    const n = Math.max(1, k)
    clusters = Array.from({ length: n }, (_, i) => {
      const start = Math.floor((i * allScores.length) / n)
      const end = Math.floor(((i + 1) * allScores.length) / n)
      return allScores.slice(start, end)
    })
  }

  const clusterMins = clusters.map((cluster) => cluster[0]).reverse()

  const allTierIds = ['1', '1-5', '2', '2-5', '3']
  const usedTierIds = allTierIds.slice(0, clusterMins.length)

  const thresholds = clusterMins.map((val, idx) => {
    return {
      id: usedTierIds[idx],
      min: val,
      label: `T${usedTierIds[idx].replace('-', '.')}`,
    }
  })

  const fallbackId = allTierIds[clusterMins.length] || '4'
  thresholds.push({
    id: fallbackId,
    min: 0,
    label: `T${fallbackId.replace('-', '.')}`,
  })

  return thresholds
}

/**
 * Compute per-series tier thresholds using natural breaks (largest score gaps).
 */
export function computeTierThresholds2(series) {
  const ceiling = getSeriesCeiling(series)
  // Step 1: Score every archetype that has at least 1 win.
  const allScores = series.archetypes
    .filter((a) => a.winnerDeckCount > 0)
    .map((a) =>
      archetypeScoreV2(
        a.winnerDeckCount,
        a.deckCount,
        series.totalDecks,
        series.totalEvents,
        a.top4 ?? 0,
        undefined,
        ceiling,
        getSeriesAvgTop4Rate(series),
      ),
    )
    .sort((a, b) => b - a)

  const tierIds = ['1', '1-5', '2', '2-5', '3']
  const thresholds = []

  // Step 2: T1 from the single largest gap (natural break).
  if (allScores.length >= 2) {
    let maxGap = 0,
      maxIdx = 0
    for (let j = 0; j < allScores.length - 1; j++) {
      const gap = allScores[j] - allScores[j + 1]
      if (gap > maxGap) {
        ;((maxGap = gap), (maxIdx = j))
      }
    }
    const t1mid =
      Math.round(((allScores[maxIdx] + allScores[maxIdx + 1]) / 2) * 10) / 10
    thresholds.push({
      min: t1mid,
      id: '1',
      label: 'T1',
    })
  } else {
    thresholds.push({
      min: allScores[0] || 0,
      id: '1',
      label: 'T1',
    })
  }

  // Step 3: Distribute remaining scores (below T1) across T2–T4 using quartiles.
  const remaining = allScores
    .filter((s) => s < thresholds[0].min)
    .sort((a, b) => a - b)
  const n = remaining.length

  if (n >= 4) {
    const ph = n >= 6 ? 0.6 : 0.75 // T2: upper boundary
    const pm = n >= 6 ? 0.4 : 0.5 // T2.5: middle boundary
    const pl = n >= 6 ? 0.2 : 0.25 // T3: lower boundary
    thresholds.push({
      min: remaining[Math.floor(ph * n)],
      id: '2',
      label: 'T2',
    })
    thresholds.push({
      min: remaining[Math.floor(pm * n)],
      id: '2-5',
      label: 'T2.5',
    })
    thresholds.push({
      min: remaining[Math.floor(pl * n)],
      id: '3',
      label: 'T3',
    })
    thresholds.push({
      min: remaining[0],
      id: '4',
      label: 'T4',
    })
  } else {
    // Fallback for series with few archetypes: use natural breaks on remaining scores
    const desc = [...remaining].sort((a, b) => b - a)
    let rem = [...desc]
    for (let i = 1; i < 5 && rem.length >= 2; i++) {
      let maxGap = 0,
        maxIdx = 0
      for (let j = 0; j < rem.length - 1; j++) {
        const gap = rem[j] - rem[j + 1]
        if (gap > maxGap) {
          ;((maxGap = gap), (maxIdx = j))
        }
      }
      const t = Math.round(((rem[maxIdx] + rem[maxIdx + 1]) / 2) * 10) / 10
      const tLabel = `T${tierIds[i].replace('-', '.')}`
      thresholds.push({
        min: t,
        id: tierIds[i],
        label: tLabel,
      })
      rem = rem.filter((s) => s < rem[maxIdx])
    }
    while (thresholds.length < 5) {
      const idx = thresholds.length
      const fallbackLabel = `T${tierIds[idx].replace('-', '.')}`
      thresholds.push({
        min: 0,
        id: tierIds[idx],
        label: fallbackLabel,
      })
    }
  }

  // Step 4: T4 always has threshold 0 (includes all remaining archetypes).
  thresholds.push({
    min: 0,
    id: '4',
    label: 'T4',
  })

  return thresholds
}

/**
 * Look up the tier for a given score using pre-computed thresholds.
 */
export function getDeckTier(score, thresholds) {
  return (
    thresholds.find((t) => score >= t.min) || thresholds[thresholds.length - 1]
  )
}

// Normalize rank strings and load all tournament data from a directory
export async function loadData(dir) {
  const [tournaments, egmanRaw, limitlessRaw, cardsRaw] = await Promise.all([
    readFile(join(dir, 'data', 'tournaments-all.json'), 'utf-8').then(
      JSON.parse,
    ),
    readFile(join(dir, 'data', 'tournaments-egman.json'), 'utf-8').then(
      JSON.parse,
    ),
    readFile(join(dir, 'data', 'tournaments-limitless.json'), 'utf-8').then(
      JSON.parse,
    ),
    readFile(join(dir, 'data', 'cards.json'), 'utf-8').then(JSON.parse),
  ])

  for (const raw of [egmanRaw, limitlessRaw]) {
    for (const series of raw) {
      for (const event of series.events) {
        for (const player of event.players) {
          if (player.rank === '1st') player.rank = '優勝'
          else if (player.rank === '2nd') player.rank = '準優勝'
          else if (player.rank === '3rd') player.rank = '3位'
          else if (player.rank === '4th') player.rank = '4位'
          else player.rank = '参加'
        }
      }
    }
  }

  return {
    tournaments,
    egmanRaw,
    limitlessRaw,
    cardsRaw,
  }
}

// Count how many winner decks include each card (de-duped per deck)
export function countWinnerCards(winnerGroup) {
  const counts = {}
  if (!winnerGroup) return counts
  for (const deck of winnerGroup.decks) {
    const seen = new Set()
    for (const card of deck) {
      if (!seen.has(card.cardId)) {
        counts[card.cardId] = (counts[card.cardId] || 0) + 1
        seen.add(card.cardId)
      }
    }
  }
  return counts
}

// Aggregate card usage across decks: total copies + unique decks included
export function aggregateCards(groupDecks) {
  const cardStats = {}
  for (const deck of groupDecks) {
    const seen = new Set()
    for (const card of deck) {
      if (!cardStats[card.cardId]) {
        cardStats[card.cardId] = {
          totalQty: 0,
          decksIncluded: 0,
        }
      }
      cardStats[card.cardId].totalQty += card.quantity
      if (!seen.has(card.cardId)) {
        cardStats[card.cardId].decksIncluded++
        seen.add(card.cardId)
      }
    }
  }
  return cardStats
}

// Pick up to 4 UNIT + 2 each PILOT/COMMAND/BASE, then fill to 30
export function selectTopCards(allCards) {
  const perType = {}
  for (const card of allCards) {
    if (!perType[card.type]) perType[card.type] = []
    perType[card.type].push(card)
  }
  const typePickOrder = ['UNIT', 'PILOT', 'COMMAND', 'BASE']
  const selectedIds = new Set()
  const selected = []
  for (const type of typePickOrder) {
    const sliceSize = type === 'UNIT' ? 4 : 2
    for (const card of (perType[type] || []).slice(0, sliceSize)) {
      selected.push(card)
      selectedIds.add(card.cardId)
    }
  }
  for (const card of allCards) {
    if (!typePickOrder.includes(card.type)) continue
    if (card.type !== 'UNIT') {
      const typeCount = selected.filter((tc) => tc.type === card.type).length
      if (typeCount >= 4) continue
    }
    if (selectedIds.has(card.cardId)) continue
    if (selected.length >= 30) break
    selected.push(card)
    selectedIds.add(card.cardId)
  }
  return selected
}

// Tally cost and level distribution for chart bars
export function computeCostLevelData(topCards) {
  const costTotals = {}
  const levelTotals = {}
  for (const card of topCards) {
    if (!['UNIT', 'PILOT', 'COMMAND', 'BASE'].includes(card.type)) continue
    if (card.cost && card.cost !== '-')
      costTotals[card.cost] = (costTotals[card.cost] || 0) + 1
    if (card.level && card.level !== '-')
      levelTotals[card.level] = (levelTotals[card.level] || 0) + 1
  }
  return {
    costTotals,
    levelTotals,
  }
}

// Count feature keyword occurrences for badge display
export function computeFeatureBadges(topCards) {
  const featureCounts = {}
  for (const card of topCards) {
    if (!['UNIT', 'PILOT', 'COMMAND', 'BASE'].includes(card.type)) continue
    if (card.features) {
      for (const feature of card.features
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean)) {
        if (feature === '-') continue
        featureCounts[feature] = (featureCounts[feature] || 0) + 1
      }
    }
  }
  return Object.entries(featureCounts).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )
}

// 優勝 = tournament champion
export const WINNER = '優勝'

// Rank values considered "top 4" for top4NonWin scoring
const TOP4 = ['優勝', '準優勝', '3位', '4位']

// Extract unique colors from a deck, sorted alphabetically
export function getDeckColors(deck, lookup) {
  const colors = new Set()
  for (const card of deck) {
    colors.add(lookup(card.cardId).color)
  }
  return [...colors].sort()
}

// Per-color signature: best UNIT LR per color by qty×10 + lv×7, min qty≥2
export function getSignatureCard(deck, lookup) {
  const best = {}
  for (const card of deck) {
    const info = lookup(card.cardId)
    if (info.type !== 'UNIT' || !info.rarity?.startsWith('LR')) continue
    const lv = parseInt(info.level) || 0
    const score = card.quantity * 10 + lv * 7
    const color = info.color
    if (!best[color]) best[color] = []
    const entry = {
      name: info.name,
      color,
      score,
      qty: card.quantity,
    }
    best[color].push(entry)
    best[color].sort((a, b) => b.score - a.score)
    if (best[color].length > 2) best[color].length = 2
  }

  const colors = Object.keys(best).sort()
  const qualifiers = {}
  for (const color of colors) {
    qualifiers[color] = best[color].filter((entry) => entry.qty >= 2)
  }
  const colorsWith = colors.filter((color) => qualifiers[color].length > 0)

  let signatures
  if (colorsWith.length <= 1 && colorsWith.length > 0) {
    const color = colorsWith[0]
    signatures = qualifiers[color].slice(0, 2).map((entry) => ({
      name: entry.name,
      color: entry.color,
    }))
  } else {
    signatures = colorsWith.map((color) => {
      const entry = qualifiers[color][0]
      return {
        name: entry.name,
        color: entry.color,
      }
    })
  }

  return signatures.length > 0 ? signatures : null
}

// Build combo key from deck colors and signature cards
function buildComboKey(deck, lookup, useSig = true) {
  const colors = getDeckColors(deck, lookup)
  if (colors.length === 0) return null
  if (!useSig) return colors.join('+')
  const sigData = getSignatureCard(deck, lookup)
  const sigNames = sigData ? sigData.map((sig) => sig.name) : []
  return (
    colors.join('+') + (sigNames.length > 0 ? ` (${sigNames.join(' / ')})` : '')
  )
}

// Build deck<->combo maps for all players, winners, and top-4 players
function buildArchetypeMaps(allPlayers, winners, top4Players, lookup, useSig = true) {
  const comboArchetypes = {}
  for (const player of allPlayers) {
    const combo = buildComboKey(player.deck, lookup, useSig)
    if (!combo) continue
    if (!comboArchetypes[combo]) {
      comboArchetypes[combo] = {
        decks: [],
        deckUrls: [],
        deckWinnerFlags: [],
      }
    }
    comboArchetypes[combo].decks.push(player.deck)
    if (player.deckUrl) {
      comboArchetypes[combo].deckUrls.push(player.deckUrl)
      comboArchetypes[combo].deckWinnerFlags.push(player.rank === WINNER)
    }
  }
  const winnerComboArchetypes = {}
  for (const winner of winners) {
    const combo = buildComboKey(winner.deck, lookup, useSig)
    if (!combo) continue
    if (!winnerComboArchetypes[combo]) {
      winnerComboArchetypes[combo] = { decks: [] }
    }
    winnerComboArchetypes[combo].decks.push(winner.deck)
  }
  const top4ComboArchetypes = {}
  for (const p of top4Players) {
    const combo = buildComboKey(p.deck, lookup, useSig)
    if (!combo) continue
    if (!top4ComboArchetypes[combo]) {
      top4ComboArchetypes[combo] = { decks: [] }
    }
    top4ComboArchetypes[combo].decks.push(p.deck)
  }
  return {
    comboArchetypes,
    winnerComboArchetypes,
    top4ComboArchetypes,
  }
}

// Compute per-group deck/winner counts for winner key card (ribbon) calculation
function computeGroupCounts(groupDecks, winnerGroup, cardToGroup) {
  const groupDeckCount = {}
  const groupWinnerCount = {}
  for (const deck of groupDecks) {
    const seen = new Set()
    for (const card of deck) {
      const groupKey = cardToGroup[card.cardId]
      if (groupKey && !seen.has(groupKey)) {
        seen.add(groupKey)
        groupDeckCount[groupKey] = (groupDeckCount[groupKey] || 0) + 1
      }
    }
  }
  if (winnerGroup) {
    for (const deck of winnerGroup.decks) {
      const seen = new Set()
      for (const card of deck) {
        const groupKey = cardToGroup[card.cardId]
        if (groupKey && !seen.has(groupKey)) {
          seen.add(groupKey)
          groupWinnerCount[groupKey] = (groupWinnerCount[groupKey] || 0) + 1
        }
      }
    }
  }
  return {
    groupDeckCount,
    groupWinnerCount,
  }
}

// Serialize a deck's card IDs and quantities into a compact string
function serializeDeckCards(deck, lookup, typeOrder) {
  const cardQty = deck.reduce((acc, card) => {
    acc[card.cardId] = (acc[card.cardId] || 0) + (card.quantity || 1)
    return acc
  }, {})
  const sorted = Object.entries(cardQty).sort(([aId], [bId]) => {
    const typeA = typeOrder[lookup(aId).type.toLowerCase()] ?? 99
    const typeB = typeOrder[lookup(bId).type.toLowerCase()] ?? 99
    return typeA !== typeB ? typeA - typeB : aId.localeCompare(bId)
  })
  return sorted.map(([id, qty]) => `${id}:${qty}`).join('|')
}

const costLabels = ['1', '2', '3', '4', '5', '6', '7', '8']
const levelLabels = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * Extracts card mapping and functional grouping from raw card data.
 */
function createCardLookups(cardsRaw) {
  const cardMap = {}
  const nameToColor = {}
  const cardToGroup = {}

  for (const card of cardsRaw) {
    const key = card.cardNo
    if (!cardMap[key]) {
      cardMap[key] = {
        name: card.name,
        color: card.color,
        type: card.type,
        cost: card.cost,
        level: card.level,
        ap: card.ap,
        hp: card.hp,
        features: card.features,
        rarity: card.rarity,
        effect: card.effect,
      }
    }
    if (!nameToColor[card.name]) nameToColor[card.name] = card.color
    cardToGroup[card.cardNo] =
      card.effect === '-'
        ? `${card.level}|${card.cost}|${card.ap}|${card.hp}|-`
        : `${card.color}|${card.level}|${card.cost}|${card.ap}|${card.hp}|${card.effect || '-'}`
  }

  const lookup = (cardId) =>
    cardMap[cardId] ?? {
      name: '?',
      color: '?',
      type: '?',
      level: '?',
      rarity: '?',
    }

  return {
    lookup,
    nameToColor,
    cardToGroup,
  }
}

/**
 * Calculates series-level metadata (players, winners, top4, etc.)
 */
function getSeriesMetadata(series) {
  const allPlayers = series.events
    .flatMap((e) => e.players)
    .filter((p) => p.deck.length > 0)
  const winners = allPlayers.filter((p) => p.rank === WINNER)
  const top4Players = allPlayers.filter((p) => TOP4.includes(p.rank))
  return {
    allPlayers,
    winners,
    top4Players,
    totalWinners: winners.length,
    totalAll: allPlayers.length,
    isGlobalFormat:
      series.value.startsWith('egman-') ||
      series.value.startsWith('limitless-'),
  }
}

/**
 * Aggregates signature cards for a group of decks based on frequency.
 * Used for formats where archetypes aren't split by signature card (Egman/Limitless).
 */
function getGlobalSignatureCards(groupDecks, lookup) {
  const sigFreq = {}
  for (const deck of groupDecks) {
    const deckSigs = (() => {
      const best = {}
      for (const card of deck) {
        const info = lookup(card.cardId)
        if (info.type !== 'UNIT' || !info.rarity?.startsWith('LR')) continue
        const lv = parseInt(info.level) || 0
        const score = card.quantity * 10 + lv * 7
        const color = info.color
        if (!best[color]) best[color] = []
        best[color].push({
          name: info.name,
          color,
          score,
          qty: card.quantity,
        })
        best[color].sort((a, b) => b.score - a.score)
        if (best[color].length > 3) best[color].length = 3
      }
      const result = Object.keys(best)
        .sort()
        .flatMap((color) =>
          best[color]
            .filter((e) => e.qty >= 2)
            .slice(0, 3)
            .map((e) => ({
              name: e.name,
              color: e.color,
            })),
        )
      return result.length > 0 ? result : null
    })()

    if (deckSigs) {
      for (const sig of deckSigs) {
        if (!sigFreq[sig.name]) {
          sigFreq[sig.name] = {
            name: sig.name,
            color: sig.color,
            count: 0,
          }
        }
        sigFreq[sig.name].count++
      }
    }
  }

  const COLOR_ORDER = [
    'Blue',
    'Purple',
    'Red',
    'Green',
    'White',
    'Black',
    'Yellow',
  ]
  return Object.values(sigFreq)
    .sort((a, b) => {
      const c = COLOR_ORDER.indexOf(a.color) - COLOR_ORDER.indexOf(b.color)
      return c !== 0 ? c : b.count - a.count
    })
    .slice(0, 4)
    .map((s) => ({
      name: s.name,
      color: s.color,
    }))
}

/**
 * Builds full statistical detail for a single archetype combo group.
 */
function processArchetype(combo, group, context) {
  const {
    winnerComboArchetypes,
    top4ComboArchetypes,
    lookup,
    cardToGroup,
    nameToColor,
    isGlobalFormat,
    typeOrder,
    totalAll,
  } = context

  const groupDecks = group.decks
  const count = groupDecks.length
  const winnerGroup = winnerComboArchetypes[combo]
  const winnerCounts = countWinnerCards(winnerGroup)
  const cardAgg = aggregateCards(groupDecks)
  const { groupDeckCount, groupWinnerCount } = computeGroupCounts(
    groupDecks,
    winnerGroup,
    cardToGroup,
  )

  let allCards = Object.entries(cardAgg).map(([cardId, cardData]) => {
    const info = lookup(cardId)
    const groupKey = cardToGroup[cardId]
    const winnerDecksWithGroup = groupKey
      ? groupWinnerCount[groupKey] || 0
      : winnerCounts[cardId] || 0
    const totalWinnerDecks = winnerGroup ? winnerGroup.decks.length : 0
    const overallRate = groupKey
      ? (groupDeckCount[groupKey] || 0) / count
      : cardData.decksIncluded / count

    const support = winnerDecksWithGroup >= 2
    const rawLift =
      overallRate > 0 ? winnerDecksWithGroup / totalWinnerDecks / overallRate : 0
    const inWinner =
      winnerGroup && info.effect !== '-' && support && rawLift > 1.5

    return {
      cardId,
      name: info.name,
      color: info.color,
      type: info.type,
      cost: info.cost,
      level: info.level,
      ap: info.ap,
      hp: info.hp,
      features: info.features,
      rarity: info.rarity,
      decksIncluded: cardData.decksIncluded,
      inclusionRate: +(cardData.decksIncluded / count).toFixed(4),
      winnerDeckCount: winnerCounts[cardId] || 0,
      avgQty: Math.round(cardData.totalQty / cardData.decksIncluded),
      inWinner,
    }
  })

  const rarityScore = (rarity) =>
    rarity?.startsWith('LR') ? 100 : rarity?.startsWith('R') ? 50 : 0
  allCards.sort(
    (a, b) =>
      b.inclusionRate - a.inclusionRate ||
      rarityScore(b.rarity) - rarityScore(a.rarity) ||
      (typeOrder[a.type.toLowerCase()] || 9) -
        (typeOrder[b.type.toLowerCase()] || 9) ||
      a.cardId.localeCompare(b.cardId) ||
      a.color.localeCompare(b.color),
  )

  const topCards = selectTopCards(allCards)
  const topCardIds = new Set(topCards.map((card) => card.cardId))
  const filteredCards = allCards.filter((card) => !topCardIds.has(card.cardId))
  const { costTotals: costTotalsTop, levelTotals: levelTotalsTop } =
    computeCostLevelData(topCards)
  const { costTotals: costTotalsOther, levelTotals: levelTotalsOther } =
    computeCostLevelData(filteredCards)

  const featureBadges = computeFeatureBadges(topCards)

  const sigMatch = combo.match(/\((.+)\)/)
  const sigStr = sigMatch ? sigMatch[1] : null
  const sigCards = sigStr
    ? sigStr.split(' / ').map((name) => ({
        name: name.trim(),
        color: nameToColor[name.trim()] || 'inherit',
      }))
    : []

  const aggregatedSigCards = isGlobalFormat
    ? getGlobalSignatureCards(groupDecks, lookup)
    : []

  const deckCardIds = groupDecks.map((deck) =>
    serializeDeckCards(deck, lookup, typeOrder),
  )

  const top4Group = top4ComboArchetypes[combo]
  const top4 = top4Group ? top4Group.decks.length : 0

  return {
    combo,
    sigCards,
    aggregatedSigCards,
    cardCount: allCards.length,
    deckCount: count,
    percent: +((count / totalAll) * 100).toFixed(1),
    winnerDeckCount: winnerGroup ? winnerGroup.decks.length : 0,
    top4,
    costData: [
      costLabels.map((c) => costTotalsTop[c] || 0),
      costLabels.map((c) => costTotalsOther[c] || 0),
    ],
    levelData: [
      levelLabels.map((l) => levelTotalsTop[l] || 0),
      levelLabels.map((l) => levelTotalsOther[l] || 0),
    ],
    cards: topCards,
    filteredCards,
    featureBadges,
    deckUrls: group.deckUrls,
    deckCardIds,
    deckWinnerFlags: group.deckWinnerFlags,
  }
}

/**
 * @param {Object} opts
 * @param {Object} opts.tournaments
 * @param {Array}  opts.cardsRaw
 * @param {Object} opts.typeOrder
 * @param {Function} [opts.onSeries] - Optional callback invoked per series.
 *   Receives ({ series, winners, allPlayers, totalWinners, totalAll, lookup }).
 *   Return an object spread onto the series entry (used by meta-by-series.js for
 *   per-series card/color/combo stats). Unused by tier-table.js / archetype-grid.js.
 */
export function buildSeriesData({
  tournaments,
  cardsRaw,
  typeOrder,
  onSeries,
}) {
  const { lookup, nameToColor, cardToGroup } = createCardLookups(cardsRaw)

  return tournaments.map((series) => {
    const {
      allPlayers,
      winners,
      top4Players,
      totalWinners,
      totalAll,
      isGlobalFormat,
    } = getSeriesMetadata(series)

    const extra = onSeries
      ? onSeries({
          series,
          winners,
          allPlayers,
          totalWinners,
          totalAll,
          lookup,
        })
      : {}

    const { comboArchetypes, winnerComboArchetypes, top4ComboArchetypes } =
      buildArchetypeMaps(allPlayers, winners, top4Players, lookup, !isGlobalFormat)

    const archetypes = Object.entries(comboArchetypes).map(([combo, group]) =>
      processArchetype(combo, group, {
        winnerComboArchetypes,
        top4ComboArchetypes,
        lookup,
        cardToGroup,
        nameToColor,
        isGlobalFormat,
        typeOrder,
        totalAll,
      }),
    )

    const minSize = isGlobalFormat
      ? Math.ceil(totalAll * 0.01)
      : Math.max(
          Math.ceil(totalAll * 0.01),
          Math.min(12, Math.ceil(totalAll * 0.05)),
        )

    const main = archetypes
      .filter((a) => a.deckCount >= minSize)
      .sort((a, b) => b.deckCount - a.deckCount)

    return {
      value: series.value,
      label: series.label,
      labelShort: series.label.replace('ニュータイプチャレンジ 2026 ', ''),
      totalEvents: totalWinners,
      totalDecks: totalAll,
      costLabels,
      levelLabels,
      archetypes: main,
      ...extra,
    }
  })
}
