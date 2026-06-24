import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const API_BASE = 'https://play.limitlesstcg.com/api'
const LIST_URL = `${API_BASE}/tournaments?game=GUNDAM&completed=true`
const DATA_FILE = join(__dirname, 'data', 'tournaments-limitless.json')

function rankLabel(placement) {
  if (placement === 1) return '1st'
  if (placement === 2) return '2nd'
  if (placement === 3) return '3rd'
  return placement + 'th'
}

function seriesKey(name) {
  const gdMatch = name.match(/GD\d{2}/)
  if (gdMatch) {
    const code = gdMatch[0].toLowerCase()
    return {
      label: `Limitless ${gdMatch[0].toUpperCase()}`,
      value: `limitless-${code}`,
    }
  }
  if (name.includes('MSA')) {
    return {
      label: 'Limitless MSA',
      value: 'limitless-msa',
    }
  }
  return {
    label: 'Limitless Other',
    value: 'limitless-other',
  }
}

function flattenCards(decklist) {
  if (!decklist) return []
  const cards = []
  for (const type of ['unit', 'pilot', 'command', 'base']) {
    const list = decklist[type]
    if (!list) continue
    for (const c of list) {
      const cardId = `${c.set}-${c.number}`
      cards.push({
        cardId, quantity: c.count,
      })
    }
  }
  return cards
}

async function main() {
  // Load cache
  let existing = []
  let cachedIds = new Set()
  try {
    existing = JSON.parse(await readFile(DATA_FILE, 'utf-8'))
    for (const s of existing) {
      for (const e of s.events) {
        if (e._id) cachedIds.add(e._id)
      }
    }
  } catch {
    existing = []
  }

  // Fetch all tournament pages
  const allTournaments = []
  let page = 1
  while (true) {
    const res = await fetch(`${LIST_URL}&page=${page}`)
    if (!res.ok) throw new Error(`List fetch failed: ${res.status}`)
    const batch = await res.json()
    if (!batch || batch.length === 0) break
    allTournaments.push(...batch)
    page++
    await new Promise((r) => setTimeout(r, 300))
  }

  const newTournaments = allTournaments.filter((t) => !cachedIds.has(t.id))
  console.log(`Total tournaments: ${allTournaments.length}, new: ${newTournaments.length}`)

  // Fetch standings for new tournaments
  const events = []
  for (const t of newTournaments) {
    const standingsUrl = `${API_BASE}/tournaments/${t.id}/standings`
    const res = await fetch(standingsUrl)
    if (!res.ok) {
      console.warn(`  Skipping ${t.id} (${t.name}): ${res.status}`)
      await new Promise((r) => setTimeout(r, 500))
      continue
    }
    const standings = await res.json()

    const players = standings
      .filter((p) => p.decklist)
      .map((p) => ({
        rank: rankLabel(p.placing),
        name: p.name || p.player || 'Unknown',
        deckUrl: '',
        deck: flattenCards(p.decklist),
      }))
      .filter((p) => p.deck.length > 0)

    if (players.length === 0) {
      await new Promise((r) => setTimeout(r, 500))
      continue
    }

    events.push({
      date: t.date ? t.date.slice(0, 10) : '',
      shop: t.name,
      url: `https://play.limitlesstcg.com/tournament/${t.id}/standings`,
      _id: t.id,
      players,
    })

    console.log(`  ${t.id} ${t.name} (${t.players}p) → ${players.length} with decks`)
    await new Promise((r) => setTimeout(r, 500))
  }

  // Flatten all events (existing cache + new), then regroup by series key
  const allEvents = []
  for (const s of existing) {
    allEvents.push(...s.events)
  }
  allEvents.push(...events)

  const cacheKeyMap = {}
  for (const e of allEvents) {
    const { label, value } = seriesKey(e.shop)
    if (!cacheKeyMap[value]) {
      cacheKeyMap[value] = {
        label,
        value,
        url: 'https://play.limitlesstcg.com/tournaments/completed?game=GUNDAM',
        events: [],
      }
    }
    cacheKeyMap[value].events.push(e)
  }

  const output = Object.values(cacheKeyMap).sort((a, b) =>
    b.value.localeCompare(a.value),
  )

  // Remove _id from events in output (internal cache tracking only)
  for (const s of output) {
    for (const e of s.events) {
      delete e._id
    }
  }

  await writeFile(DATA_FILE, JSON.stringify(output, null, 2))
  const totalEvents = output.reduce((a, s) => a + s.events.length, 0)
  console.log(`Written to data/tournaments-limitless.json — ${output.length} series, ${totalEvents} events`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
