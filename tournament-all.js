import axios from 'axios'
import * as cheerio from 'cheerio'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'

const baseUrl = 'https://www.gundam-gcg.com/jp/tournament-results/'
const dataFile = 'data/tournaments-all.json'

function loadCached() {
  if (!existsSync(dataFile)) {
    return []
  }
  try {
    return JSON.parse(readFileSync(dataFile, 'utf8'))
  } catch {
    return []
  }
}

async function fetchTournaments() {
  console.log('Fetching tournament list...')
  const res = await axios.get(baseUrl)
  const $ = cheerio.load(res.data)

  const items = []
  $('.filterListItems a').each((_, el) => {
    items.push({
      label: $(el).text().trim(),
      value: $(el).attr('href').match(/series=(\d+)/)?.[1] ?? '',
      url: new URL($(el).attr('href'), baseUrl).href,
    })
  })
  console.log(`  Found ${items.length} tournaments`)
  return items
}

async function fetchPlayerDeck(deckUrl) {
  const res = await axios.get(deckUrl)
  const $ = cheerio.load(res.data)

  const cards = []
  $('.useCardsList li').each((_, el) => {
    const img = $(el).find('img')
    cards.push({
      cardId: img.attr('alt'),
      quantity: parseInt($(el).find('.useCardsNum').text(), 10),
      imageUrl: new URL(img.attr('src'), baseUrl).href,
    })
  })
  return cards
}

async function fetchPlayers(eventUrl) {
  const res = await axios.get(eventUrl)
  const $ = cheerio.load(res.data)

  const players = []
  const promises = []
  $('.userListDetail').each((_, el) => {
    const link = $(el).find('a')
    const deckUrl = new URL(link.attr('href'), baseUrl).href
    const player = {
      rank: $(el).find('.userInfoRank').text().trim(),
      name: $(el).find('.userInfoName').text().trim(),
      deckUrl,
    }
    players.push(player)
    promises.push(
      fetchPlayerDeck(deckUrl).then(cards => {
        player.deck = cards
        console.log(`    ${player.rank} ${player.name}: ${cards.length} cards`)
      })
    )
  })
  await Promise.all(promises)
  return players
}

async function fetchEvents(url) {
  const res = await axios.get(url)
  const $ = cheerio.load(res.data)

  const events = []
  $('.shopListDetail').each((_, el) => {
    const link = $(el).find('a')
    events.push({
      date: $(el).find('time').attr('datetime'),
      shop: $(el).find('.shopName').text().trim(),
      url: new URL(link.attr('href'), baseUrl).href,
    })
  })
  return events
}

const cached = loadCached()
const cachedByUrl = new Map()
for (const t of cached) {
  for (const ev of t.events ?? []) {
    cachedByUrl.set(ev.url, ev)
  }
}
console.log(`Loaded ${cachedByUrl.size} cached events`)

const tournaments = await fetchTournaments()

let totalEvents = 0
let fetchedEvents = 0
let skippedEvents = 0
for (const t of tournaments) {
  console.log(`\nProcessing: ${t.label}`)
  const events = await fetchEvents(t.url)
  totalEvents += events.length
  let eventIdx = 0
  for (const ev of events) {
    eventIdx++
    const cached = cachedByUrl.get(ev.url)
    if (cached?.players) {
      ev.players = cached.players
      skippedEvents++
    } else {
      console.log(`  [${eventIdx}/${events.length}] Fetching ${ev.shop} (${ev.date})...`)
      ev.players = await fetchPlayers(ev.url)
      fetchedEvents++
    }
  }
  t.events = events
}

const playerCount = tournaments.reduce((s, t) => s + t.events.reduce((s2, e) => s2 + (e.players?.length || 0), 0), 0)
console.log(`\nDone. ${totalEvents} events, ${fetchedEvents} fetched, ${skippedEvents} cached, ${playerCount} total players`)
if (existsSync(dataFile)) {
  const bakPath = dataFile + '.bak'
  copyFileSync(dataFile, bakPath)
  console.log(`Backed up existing data to ${bakPath}`)
}
writeFileSync(dataFile, JSON.stringify(tournaments, null, 2))
console.log(`Saved to ${dataFile}`)
