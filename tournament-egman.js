import { writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function parseDeckUrl(url) {
  try {
    const u = new URL(url)
    const deckParam = u.searchParams.get('deck')
    if (!deckParam) return []
    return deckParam.split(',').map(pair => {
      const [cardId, quantityStr] = pair.split(':')
      return { cardId, quantity: parseInt(quantityStr, 10) || 1 }
    })
  } catch {
    return []
  }
}

function rankLabel(placement) {
  if (placement === 1) return '1st'
  if (placement === 2) return '2nd'
  if (placement === 3) return '3rd'
  return placement + 'th'
}

async function main() {
  const res = await fetch('https://deckbuilder.egmanevents.com/api/tournaments/gundam')
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`)
  const tournaments = await res.json()

  const grouped = {}
  for (const t of tournaments) {
    if (!t.tournament_results || t.tournament_results.length === 0) continue
    const groupKey = t.set_group || t.format || 'unknown'
    if (!grouped[groupKey]) {
      grouped[groupKey] = {
        label: `Egman ${groupKey}`,
        value: `egman-${groupKey.toLowerCase()}`,
        url: 'https://deckbuilder.egmanevents.com/gundam/tournaments',
        events: [],
      }
    }

    const players = t.tournament_results
      .filter(r => r.deck_list_url && r.deck_list_url.length > 0)
      .map((r, i) => {
        const deckUrl = Array.isArray(r.deck_list_url) ? r.deck_list_url[0] : r.deck_list_url
        return {
          rank: rankLabel(r.placement || i + 1),
          name: r.player_name || 'Unknown',
          deckUrl,
          deck: parseDeckUrl(deckUrl),
        }
      })
      .filter(p => p.deck.length > 0)

    if (players.length === 0) continue

    grouped[groupKey].events.push({
      date: t.start_date ? t.start_date.slice(0, 10) : '',
      shop: t.tournament_name || '',
      url: 'https://deckbuilder.egmanevents.com/gundam/tournaments',
      players,
    })
  }

  const output = Object.values(grouped)
  await writeFile(join(__dirname, 'data', 'tournaments-egman.json'), JSON.stringify(output, null, 2))
  console.log(`Written to data/tournaments-egman.json — ${output.length} series, ${output.reduce((a, s) => a + s.events.length, 0)} events`)
}

main().catch(e => { console.error(e); process.exit(1) })
