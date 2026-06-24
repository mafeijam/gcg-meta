import axios from 'axios'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataFile = join(__dirname, 'data', 'cards.json')
const outDir = join(__dirname, 'data', 'images')

function getImageUrl(imageUrl) {
  return imageUrl.split('?')[0]
}

function getFilename(imageUrl) {
  return getImageUrl(imageUrl).split('/').pop()
}

function getDest(imageUrl) {
  return join(outDir, getFilename(imageUrl))
}

async function downloadImage(url, dest) {
  const res = await axios.get(url, { responseType: 'arraybuffer' })
  writeFileSync(dest, Buffer.from(res.data))
}

const cards = JSON.parse(readFileSync(dataFile, 'utf8'))

mkdirSync(outDir, { recursive: true })

const seen = new Set()
const unique = []
for (const c of cards) {
  if (!seen.has(c.imageUrl)) {
    seen.add(c.imageUrl)
    unique.push({ url: c.imageUrl, dest: getDest(c.imageUrl), exists: existsSync(getDest(c.imageUrl)) })
  }
}

console.log(`Downloading ${unique.length} unique card images to ${outDir}/`)

let done = 0
let skipped = 0
const concurrency = 10

for (let i = 0; i < unique.length; i += concurrency) {
  const batch = unique.slice(i, i + concurrency)
  const results = await Promise.allSettled(
    batch.map(item =>
      item.exists
        ? Promise.resolve('skipped')
        : downloadImage(item.url, item.dest).then(() => 'done')
    )
  )
  for (const r of results) {
    if (r.status === 'fulfilled') {
      if (r.value === 'done') done++
      else skipped++
    } else {
      console.error(`  FAILED: ${r.reason.message}`)
    }
  }
  if ((done + skipped) % 50 === 0 || done + skipped === unique.length) {
    console.log(`  Progress: ${done + skipped}/${unique.length} (${done} new, ${skipped} cached)`)
  }
}

console.log(`Complete — ${done} downloaded, ${skipped} already existed`)
