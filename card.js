import axios from 'axios'
import * as cheerio from 'cheerio'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

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
      packages.push({ code, name })
    }
  })
  return packages
}

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

async function fetchCardList(packageCode) {
  const url = `${baseUrl}?package=${packageCode}&freeword=`
  const res = await axios.get(url)
  const $ = cheerio.load(res.data)

  const cards = []
  $('.cardItem').each((_, el) => {
    const anchor = $(el).find('a')
    const img = $(el).find('img')
    const detailParam = anchor.attr('data-src')?.match(/detailSearch=([^&]+)/)?.[1] ?? ''
    cards.push({
      id: detailParam,
      name: img.attr('alt'),
      imageUrl: new URL(img.attr('data-src'), baseUrl).href,
    })
  })
  return cards
}

async function fetchCardDetail(cardId) {
  const url = `${baseUrl}detail.php?detailSearch=${cardId}`
  const res = await axios.get(url)
  const $ = cheerio.load(res.data)

  const text = (sel) => $(sel).text().trim()

  const detail = {
    id: cardId,
    cardNo: text('.cardNo'),
    rarity: text('.rarity').replace(/\s+/g, ''),
    name: text('.cardName'),
    level: text('.cardDataRow.side dl:has(dt:contains("Lv.")) dd'),
    cost: text('.cardDataRow.side dl:has(dt:contains("COST")) dd'),
    color: text('.cardDataRow.side dl:has(dt:contains("色")) dd'),
    type: text('.cardDataRow.side dl:has(dt:contains("タイプ")) dd'),
    terrain: text('.cardDataRow:has(dt:contains("地形")) dd'),
    features: text('.cardDataRow:has(dt:contains("特徴")) dd'),
    effect: text('.cardDataRow.overview .dataTxt'),
    link: text('.cardDataRow:has(dt:contains("リンク")) dd'),
    ap: text('.cardDataRow.side dl:has(dt:contains("AP")) dd'),
    hp: text('.cardDataRow.side dl:has(dt:contains("HP")) dd'),
    sourceTitle: text('.cardDataRow:has(dt:contains("出典タイトル")) dd'),
    acquisitionInfo: text('.cardDataRow:has(dt:contains("入手情報")) dd'),
    imageUrl: new URL($('.cardImage img').attr('src'), baseUrl).href,
  }
  return detail
}

const cached = loadCached()
const cachedMap = new Map(cached.map(c => [c.id, c]))

const packages = await fetchPackages()
console.log(`Loaded ${packages.length} packages from website`)

const allCardIds = new Set()
for (const pkg of packages) {
  console.log(`\nFetching ${pkg.name}...`)
  const cards = await fetchCardList(pkg.code)
  console.log(`  Found ${cards.length} cards`)
  for (const c of cards) {
    allCardIds.add(c.id)
  }
}

console.log(`\nTotal unique cards: ${allCardIds.size}`)

let fetched = 0
let skipped = 0
const results = []
for (const id of allCardIds) {
  if (cachedMap.has(id)) {
    results.push(cachedMap.get(id))
    skipped++
  } else {
    console.log(`  Fetching ${id}...`)
    const detail = await fetchCardDetail(id)
    results.push(detail)
    fetched++
  }
}

console.log(`\nDone. ${results.length} total, ${fetched} fetched, ${skipped} cached`)
writeFileSync(dataFile, JSON.stringify(results, null, 2))
console.log(`Saved to ${dataFile}`)
