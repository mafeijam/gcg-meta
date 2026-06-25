import axios from 'axios'
import * as cheerio from 'cheerio'
import { readFileSync, existsSync } from 'node:fs'

const baseUrl = 'https://www.gundam-gcg.com/jp/cards/'
const dataFile = 'data/cards.json'

async function fetchPackages() {
  const res = await axios.get(baseUrl)
  const $ = cheerio.load(res.data)
  const seen = new Set()
  const packages = []
  $('.js-selectBtn-package[data-val]').each((_, el) => {
    const code = $(el).attr('data-val')
    const name = $(el).text().trim()
    if (code && !seen.has(code)) {
      seen.add(code)
      packages.push({
        code,
        name,
      })
    }
  })
  return packages
}

function loadCached() {
  if (!existsSync(dataFile)) return []
  try {
    return JSON.parse(readFileSync(dataFile, 'utf8'))
  } catch {
    return []
  }
}

async function fetchCardList(packageCode) {
  const url = `${baseUrl}?package=${packageCode}&freeword=`
  const res = await axios.get(url)
  const $ = cheerio.load(res.data)
  const cards = []
  $('.cardItem').each((_, el) => {
    const anchor = $(el).find('a')
    const detailParam =
      anchor.attr('data-src')?.match(/detailSearch=([^&]+)/)?.[1] ?? ''
    cards.push({ id: detailParam })
  })
  return cards
}

const cachedMap = new Map(loadCached().map(c => [c.id, c]))

const packages = await fetchPackages()
const allCardIds = new Set()
for (const pkg of packages) {
  const cards = await fetchCardList(pkg.code)
  for (const c of cards) {
    allCardIds.add(c.id)
  }
}

const newIds = [...allCardIds].filter(id => !cachedMap.has(id))

if (newIds.length === 0) {
  console.log('No new cards found.')
} else {
  console.log(`Found ${newIds.length} new card(s):`)
  for (const id of newIds) {
    console.log(`  ${id}`)
  }
  console.log('\nRun \'node card.js\' to fetch details.')
}
