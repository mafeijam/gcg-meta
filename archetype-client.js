const colorHex = {
  Blue: '#2b6cb0',
  White: '#cbd5e0',
  Purple: '#805ad5',
  Red: '#e53e3e',
  Green: '#38a169',
  Black: '#1a202c',
  Yellow: '#d69e2e',
}

let pieCharts = []
let archetypeCharts = {}
let otherCardsAllOpen = false
const fragCache = {}
const fragPromises = {}
const archFragCache = {}
const archFragPromises = {}

var urlTargetSeries = null
var urlTargetArchetype = null
;(function () {
  var params = new URLSearchParams(window.location.search)
  var s = params.get('series')
  var a = params.get('archetype')
  if (s && ARCH_LABELS.indexOf(s) !== -1) {
    urlTargetSeries = s
    if (a !== null) {
      urlTargetArchetype = parseInt(a, 10) || 0
    }
  }
})()

function updateUrl(series, archetype) {
  var params = new URLSearchParams()
  params.set('series', series)
  if (archetype !== null && archetype !== undefined) {
    params.set('archetype', archetype)
  }
  var newUrl = window.location.pathname + '?' + params.toString()
  history.replaceState(null, '', newUrl)
}

function loadSeriesFrag(seriesId) {
  if (fragCache[seriesId]) return Promise.resolve(fragCache[seriesId])
  if (!fragPromises[seriesId]) {
    fragPromises[seriesId] = fetch('archetype-grid-' + seriesId + '.frag.html?v=' + (typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : ''))
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load fragment: ' + r.status)
        return r.text()
      })
      .then(function (html) {
        fragCache[seriesId] = html
        return html
      })
  }
  return fragPromises[seriesId]
}

function initPieChart(seriesId, canvas) {
  const seriesIdx = ARCH_LABELS.indexOf(seriesId)
  if (seriesIdx === -1) return
  const clusters = ARCH_DATA[seriesIdx]
  if (!clusters || clusters.length === 0) return
  if (!canvas) return

  const existingIdx = pieCharts.findIndex((c) => c.seriesId === seriesId)
  if (existingIdx !== -1) {
    pieCharts[existingIdx].chart.destroy()
    pieCharts.splice(existingIdx, 1)
  }

  const totalDecks = ARCH_TOTALS[seriesIdx]
  const grouped = {}
  for (const c of clusters) {
    const key = c.combo.split(' (')[0]
    if (!grouped[key]) grouped[key] = 0
    grouped[key] += c.deckCount
  }
  const sorted = Object.entries(grouped).sort((a, b) => b[1] - a[1])
  const groupLabels = sorted.map((e) => e[0])
  const groupData = sorted.map((e) => e[1])
  const groupPct = groupData.map((v) => +((v / totalDecks) * 100).toFixed(1))

  function segmentColor(label) {
    const colors = label
      .split(' (')[0]
      .split('+')
      .map((s) => colorHex[s.trim()])
      .filter(Boolean)
    return (
      colors[0] ||
      (typeof clusterPalette !== 'undefined' ? clusterPalette[0] : '#718096')
    )
  }
  const chart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: groupLabels,
      datasets: [
        {
          data: groupPct,
          backgroundColor: groupLabels.map(segmentColor),
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: window.innerWidth < 768 ? false : true,
      layout: { padding: { top: 25 } },
      plugins: {
        legend: { display: false },
        tooltip: {callbacks: {label: (ctx) => {
              const idx = ctx.dataIndex
              return (
                ctx.label +
                ': ' +
                groupData[idx] +
                ' decks (' +
                ctx.parsed.y +
                '%)'
              )
            },},},
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxRotation: 45,
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => v + '%',
            color: document.documentElement.classList.contains('dark-mode')
              ? '#94a3b8'
              : '#718096',
          },
          grid: {color: document.documentElement.classList.contains('dark-mode')
              ? '#334155'
              : '#e2e8f0',},
        },
      },
    },
    plugins: [
      {
        id: 'barGradient',
        afterDatasetDraw(chart, args) {
          if (args.index !== 0) return
          const ctx = chart.ctx
          const meta = chart.getDatasetMeta(0)
          if (!meta.data || !meta.data.length) return
          ctx.save()
          for (let i = 0; i < meta.data.length; i++) {
            const bar = meta.data[i]
            if (bar.hidden || bar.skip) continue
            const x = bar.x,
              base = bar.base,
              w = bar.width
            const y = Math.min(bar.y, base),
              h = Math.abs(bar.y - base)
            if (h <= 0 || w <= 0) continue
            const label = chart.data.labels[i]
            const colors = label
              .split(' (')[0]
              .split('+')
              .map((s) => colorHex[s.trim()])
              .filter(Boolean)
            if (!colors.length) continue
            const grad = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y)
            grad.addColorStop(0, colors[0])
            grad.addColorStop(1, colors.length > 1 ? colors[1] : colors[0])
            ctx.fillStyle = grad
            ctx.fillRect(x - w / 2, y, w, h)
          }
          ctx.restore()
        },
      },
      {
        id: 'barLabels',
        afterDraw(chart) {
          const ctx = chart.ctx
          const meta = chart.getDatasetMeta(0)
          if (!meta.data || !meta.data.length) return
          const isDark =
            document.documentElement.classList.contains('dark-mode')
          ctx.save()
          ctx.textAlign = 'center'
          ctx.textBaseline = 'bottom'
          ctx.font =
            '11px -apple-system, BlinkMacSystemFont, "Noto Sans JP", sans-serif'
          ctx.fillStyle = isDark ? '#e2e8f0' : '#1a202c'
          for (let i = 0; i < meta.data.length; i++) {
            const bar = meta.data[i]
            if (bar.hidden || bar.skip) continue
            ctx.fillText(chart.data.datasets[0].data[i] + '%', bar.x, bar.y - 4)
          }
          ctx.restore()
        },
      },
    ],
  })
  pieCharts.push({
    canvas,
    chart,
    seriesId,
  })
}

if (!urlTargetSeries) {
  var activePane = document.querySelector('.tab-pane.active')
  if (activePane) {
    loadAndRenderFragment(activePane.id.replace('series-', ''), activePane)
  }
}

function loadAndRenderFragment(seriesId, pane, afterRender) {
  var loadingTimer = setTimeout(function () {
    pane.innerHTML = '<div class="tab-pane-loading">Loading\u2026</div>'
  }, 200)
  loadSeriesFrag(seriesId).then(function (html) {
    clearTimeout(loadingTimer)
    pane.innerHTML = html
    initSeriesContent(seriesId, pane)
    if (afterRender) afterRender()
  })
}

function loadArchetypeFrag(seriesId, idx) {
  var key = seriesId + '-' + idx
  if (archFragCache[key]) return Promise.resolve(archFragCache[key])
  if (!archFragPromises[key]) {
    archFragPromises[key] = fetch('archetype-grid-' + seriesId + '-' + idx + '.frag.html?v=' + (typeof DATA_VERSION !== 'undefined' ? DATA_VERSION : ''))
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load archetype fragment: ' + r.status)
        return r.text()
      })
      .then(function (html) {
        archFragCache[key] = html
        return html
      })
  }
  return archFragPromises[key]
}

function loadAndRenderArchFrag(seriesId, idx, afterRender) {
  var loadingTimer = setTimeout(function () {
    var layout = document.getElementById('archetype-layout-' + seriesId)
    if (layout && !document.getElementById('arch-loading-' + seriesId + '-' + idx)) {
      var loadingEl = document.createElement('div')
      loadingEl.className = 'tab-pane-loading'
      loadingEl.textContent = 'Loading\u2026'
      loadingEl.id = 'arch-loading-' + seriesId + '-' + idx
      layout.appendChild(loadingEl)
    }
  }, 200)
  loadArchetypeFrag(seriesId, idx).then(function (html) {
    clearTimeout(loadingTimer)
    var loadingEl = document.getElementById('arch-loading-' + seriesId + '-' + idx)
    if (loadingEl) loadingEl.remove()
    var layout = document.getElementById('archetype-layout-' + seriesId)
    if (layout) {
      var wrapper = document.createElement('div')
      wrapper.innerHTML = html
      var tableWrap = wrapper.firstElementChild
      if (tableWrap) {
        tableWrap.style.display = 'none'
        layout.appendChild(tableWrap)
      }
    }
    if (afterRender) afterRender()
  })
}

function initSeriesContent(seriesId, pane) {
  const pieCanvas = pane.querySelector('.archetype-pie canvas')
  if (pieCanvas && !pieCharts.some(function (c) { return c.seriesId === seriesId })) {
    initPieChart(seriesId, pieCanvas)
  }
  initArchetypeCharts(seriesId, 0)
  syncOtherCardsState()
  var archIdx = 0
  if (urlTargetSeries === seriesId && urlTargetArchetype !== null) {
    var archOptions = document.querySelectorAll('#as-custom-' + seriesId + ' .as-option')
    if (urlTargetArchetype < archOptions.length) {
      archIdx = urlTargetArchetype
    }
  }
  switchArchetype(seriesId, archIdx, urlTargetArchetype !== null)
}

function toggleArchetypeSelect(seriesId) {
  const options = document.querySelector(
    '#as-custom-' + seriesId + ' .as-options',
  )
  const trigger = document.querySelector(
    '#as-custom-' + seriesId + ' .as-trigger',
  )
  const isOpen = options.classList.contains('open')
  document
    .querySelectorAll('.as-options')
    .forEach((el) => el.classList.remove('open'))
  document
    .querySelectorAll('.as-trigger')
    .forEach((el) => el.classList.remove('open'))
  if (!isOpen) {
    options.classList.add('open')
    trigger.classList.add('open')
  }
}

function toggleSeriesDropdown(el) {
  const options = el.parentElement.querySelector('.msd-options')
  const isOpen = options.classList.contains('open')
  document
    .querySelectorAll('.msd-options')
    .forEach((o) => o.classList.remove('open'))
  if (!isOpen) options.classList.add('open')
}

function selectSeries(value, el, doUpdateUrl) {
  if (doUpdateUrl === undefined) doUpdateUrl = true
  switchTab('series-' + value, null)
  document
    .querySelectorAll('.msd-option')
    .forEach((o) => o.classList.remove('active'))
  el.classList.add('active')
  el
    .closest('.mobile-series-dropdown')
    .querySelector('.msd-label').textContent = el.textContent.trim()
  document
    .querySelectorAll('.msd-options')
    .forEach((o) => o.classList.remove('open'))
  if (doUpdateUrl) updateUrl(value, null)
}

function syncOtherCardsState() {
  const open = otherCardsAllOpen
  document.querySelectorAll('.archetype-other-toggle').forEach((toggle) => {
    const key = toggle.dataset.key
    const container = key
      ? document.getElementById('archetype-other-' + key)
      : null
    if (container) {
      container.style.display = open ? 'grid' : 'none'
      toggle.textContent = open
        ? 'Hide Other Cards'
        : `Other Cards (${toggle.dataset.count})`
    }
  })
}

function switchArchetype(seriesId, idx, shouldScroll) {
  if (shouldScroll === undefined) shouldScroll = true
  var key = seriesId + '-' + idx
  if (!archFragCache[key]) {
    loadAndRenderArchFrag(seriesId, idx, function () {
      completeArchetypeSwitch(seriesId, idx, shouldScroll)
    })
    return
  }
  completeArchetypeSwitch(seriesId, idx, shouldScroll)
}

function completeArchetypeSwitch(seriesId, idx, shouldScroll) {
  if (shouldScroll === undefined) shouldScroll = true
  if (shouldScroll) updateUrl(seriesId, idx)
  document
    .querySelectorAll('#series-' + seriesId + ' .archetype-table-wrap')
    .forEach((w) => (w.style.display = 'none'))
  const el = document.getElementById('archetype-table-' + seriesId + '-' + idx)
  if (el) el.style.display = ''
  const container = document.getElementById('as-custom-' + seriesId)
  const option = container.querySelectorAll('.as-option')[idx]
  const trigger = container.querySelector('.as-trigger')
  trigger.querySelector('.as-trigger-label').innerHTML =
    option.querySelector('.as-opt-label').innerHTML
  trigger.querySelector('.as-trigger-stats').innerHTML =
    option.querySelector('.as-opt-stats').innerHTML
  container
    .querySelectorAll('.as-option')
    .forEach((opt) => opt.classList.remove('active'))
  option.classList.add('active')
  container.querySelector('.as-options').classList.remove('open')
  trigger.classList.remove('open')
  initArchetypeCharts(seriesId, idx)
  syncOtherCardsState()
  if (shouldScroll) {
    const tableWrap = document.getElementById(
      'archetype-table-' + seriesId + '-' + idx,
    )
    if (tableWrap) {
      const wrapper = tableWrap.querySelector('.archetype-2col-wrapper')
      if (wrapper) {
        wrapper.scrollIntoView({
          behavior: 'instant',
          block: 'start',
        })
      }
    }
  }
}

function initArchetypeCharts(seriesId, idx) {
  const seriesIdx = ARCH_LABELS.indexOf(seriesId)
  if (seriesIdx === -1) return
  const costCanvas = document.getElementById('overview-cost-chart-' + seriesId)
  const levelCanvas = document.getElementById(
    'overview-level-chart-' + seriesId,
  )
  if (!costCanvas || !levelCanvas) return
  const triggerLabel = document.querySelector(
    '#as-custom-' + seriesId + ' .as-trigger-label',
  )
  costCanvas.parentElement.querySelector('h4').textContent = 'Cost'
  levelCanvas.parentElement.querySelector('h4').textContent = 'Level'
  const isDark = document.documentElement.classList.contains('dark-mode')
  function chartOpts(labels, data) {
    return {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            data: data[0],
            backgroundColor: isDark ? '#818cf8' : '#3b82f6',
            borderRadius: 3,
            label: 'Top',
          },
          {
            data: data[1],
            backgroundColor: isDark ? '#475569' : '#cbd5e0',
            borderRadius: 3,
            label: 'Other',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: window.innerWidth < 768 ? false : true,
        plugins: {
          legend: { display: false },
          tooltip: {callbacks: {label: (ctx) => ctx.dataset.label + ': ' + ctx.parsed.y,},},
        },
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: isDark ? '#94a3b8' : '#718096' },
          },
          y: {
            stacked: true,
            beginAtZero: true,
            grid: { color: isDark ? '#334155' : '#e2e8f0' },
            ticks: {
              color: isDark ? '#94a3b8' : '#718096',
              stepSize: 1,
            },
          },
        },
        layout: { padding: { top: 25 } },
      },
      plugins: [
        {
          id: 'barLabels',
          afterDraw(chart) {
            const ctx = chart.ctx
            const meta = chart.getDatasetMeta(chart.data.datasets.length - 1)
            meta.data.forEach((bar, i) => {
              const top = chart.data.datasets[0].data[i] || 0
              const other = chart.data.datasets[1].data[i] || 0
              if (top + other === 0) return
              ctx.save()
              ctx.fillStyle = document.documentElement.classList.contains(
                'dark-mode',
              )
                ? '#e2e8f0'
                : '#1a202c'
              ctx.font = '12px sans-serif'
              ctx.textAlign = 'center'
              const label = [top, other].filter((v) => v > 0).join(' / ')
              if (label) ctx.fillText(label, bar.x, bar.y - 5)
              ctx.restore()
            })
          },
        },
      ],
    }
  }
  if (archetypeCharts[seriesId]) {
    const charts = archetypeCharts[seriesId]
    charts.cost.data.datasets[0].data = ARCH_COST_DATA[seriesIdx][idx][0]
    charts.cost.data.datasets[1].data = ARCH_COST_DATA[seriesIdx][idx][1]
    charts.level.data.datasets[0].data = ARCH_LEVEL_DATA[seriesIdx][idx][0]
    charts.level.data.datasets[1].data = ARCH_LEVEL_DATA[seriesIdx][idx][1]
    charts.cost.update()
    charts.level.update()
  } else {
    archetypeCharts[seriesId] = {
      cost: new Chart(
        costCanvas,
        chartOpts(ARCH_COST_LABELS, ARCH_COST_DATA[seriesIdx][idx]),
      ),
      level: new Chart(
        levelCanvas,
        chartOpts(ARCH_LEVEL_LABELS, ARCH_LEVEL_DATA[seriesIdx][idx]),
      ),
    }
  }
}

function switchTab(id, el) {
  document
    .querySelectorAll('.tab-pane')
    .forEach((p) => p.classList.remove('active'))
  if (el)
    el.parentElement
      .querySelectorAll('.tab')
      .forEach((t) => t.classList.remove('active'))
  const pane = document.getElementById(id)
  pane.classList.add('active')
  if (el) el.classList.add('active')
  const seriesId = id.replace('series-', '')
  if (!fragCache[seriesId]) {
    loadAndRenderFragment(seriesId, pane, function () {
      requestAnimationFrame(updateTabsScrollIndicators)
    })
  } else {
    initSeriesContent(seriesId, pane)
    requestAnimationFrame(updateTabsScrollIndicators)
  }
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('.archetype-select-custom')) {
    document
      .querySelectorAll('.as-options')
      .forEach((el) => el.classList.remove('open'))
    document
      .querySelectorAll('.as-trigger')
      .forEach((el) => el.classList.remove('open'))
  }
  if (!e.target.closest('.mobile-series-dropdown')) {
    document
      .querySelectorAll('.msd-options')
      .forEach((el) => el.classList.remove('open'))
  }
})

function openDeckUrlModal(seriesId) {
  const active = document.querySelector(
    '#as-custom-' + seriesId + ' .as-option.active',
  )
  const idx = active?.dataset.value
  if (idx === undefined) return
  const container = document.getElementById('deck-urls-' + seriesId + '-' + idx)
  if (!container) return
  document.getElementById('deck-url-list').innerHTML = container.innerHTML
  document.getElementById('deck-url-modal').style.display = 'flex'
}

function closeDeckUrlModal() {
  document.getElementById('deck-url-modal').style.display = 'none'
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDeckUrlModal()
})

// Deck card preview on hover
function imgPath(cardId) {
  return `https://jw-assets.imgix.net/gcg-img/${cardId}.webp`
}

// Card image hover debounce (300ms delay)
document.addEventListener('mouseover', (e) => {
  const wrapper = e.target.closest('.card-img-wrapper')
  if (!wrapper || wrapper.closest('.card-img-wrapper') !== wrapper) return
  const enlarge = wrapper.querySelector('.card-img-enlarge')
  if (!enlarge) return
  const timer = wrapper.dataset.enlargeTimer
  if (timer) clearTimeout(+timer)
  wrapper.dataset.enlargeTimer = setTimeout(() => {
    enlarge.style.display = 'block'
  }, 300)
})
document.addEventListener('mouseout', (e) => {
  const wrapper = e.target.closest('.card-img-wrapper')
  if (!wrapper) return
  const related = e.relatedTarget
  if (related && wrapper.contains(related)) return
  const timer = wrapper.dataset.enlargeTimer
  if (timer) clearTimeout(+timer)
  const enlarge = wrapper.querySelector('.card-img-enlarge')
  if (enlarge) enlarge.style.display = 'none'
})

// Deck URL hover debounce (300ms delay)
document.addEventListener('mouseover', (e) => {
  const item = e.target.closest('.deck-url-item')
  if (!item) {
    const popup = document.getElementById('deck-preview-popup')
    if (popup) popup.style.opacity = '0'
    return
  }
  const timer = item.dataset.previewTimer
  if (timer) clearTimeout(+timer)
  const cards = item.dataset.cards
  if (!cards) return
  const entries = cards.split('|').map((e) => {
    const [id, qty] = e.split(':')
    return {
      id,
      qty: qty ? +qty : 1,
    }
  })
  item.dataset.previewTimer = setTimeout(() => {
    const popup =
      document.getElementById('deck-preview-popup') ||
      (() => {
        const el = document.createElement('div')
        el.id = 'deck-preview-popup'
        el.className = 'deck-preview-popup'
        document.body.appendChild(el)
        return el
      })()
    popup.innerHTML = entries
      .map(
        ({ id, qty }) =>
          `<div class="deck-preview-card"><img src="${imgPath(id)}" alt="" loading="lazy"><span class="card-qty-badge">${qty}</span></div>`,
      )
      .join('')
    const rect = item.getBoundingClientRect()
    popup.style.left = Math.min(rect.left, window.innerWidth - 400) + 'px'
    const cardsPerRow = entries.length > 8 ? Math.ceil(entries.length / 2) : 8
    const rows = Math.ceil(entries.length / cardsPerRow)
    popup.style.gridTemplateColumns = `repeat(${cardsPerRow}, 1fr)`
    popup.style.maxWidth = `${Math.min(cardsPerRow * 85 + 12, window.innerWidth - 20)}px`
    const estimatedHeight = 18 + rows * 114 + (rows - 1) * 4
    popup.style.top =
      (rect.bottom + 4 + estimatedHeight <= window.innerHeight
        ? rect.bottom + 4
        : rect.top - estimatedHeight - 24 >= 0
          ? rect.top - estimatedHeight - 24
          : rect.bottom + 4) + 'px'
    popup.style.opacity = '1'
  }, 300)
})
document.addEventListener('mouseout', (e) => {
  const item = e.target.closest('.deck-url-item')
  if (!item) return
  const related = e.relatedTarget
  if (related && item.contains(related)) return
  const timer = item.dataset.previewTimer
  if (timer) clearTimeout(+timer)
  const popup = document.getElementById('deck-preview-popup')
  if (popup) popup.style.opacity = '0'
})

// Tabs scroll indicator
function updateTabsScrollIndicators() {
  document.querySelectorAll('.tabs-inner').forEach((el) => {
    const tabs = el.parentElement
    const canScrollLeft = el.scrollLeft > 4
    const canScrollRight = el.scrollWidth - el.clientWidth - el.scrollLeft > 4
    tabs.classList.toggle('can-scroll-left', canScrollLeft)
    tabs.classList.toggle('can-scroll-right', canScrollRight)
  })
}
document.addEventListener('scroll', updateTabsScrollIndicators, true)
window.addEventListener('resize', updateTabsScrollIndicators)
requestAnimationFrame(updateTabsScrollIndicators)

// Sticky tabs background
;(() => {
  document.querySelectorAll('.tabs').forEach((tabs) => {
    const sentinel = document.createElement('div')
    sentinel.style.cssText =
      'position:absolute;top:0;left:0;width:1px;height:1px'
    tabs.parentElement.insertBefore(sentinel, tabs)
    new IntersectionObserver(
      ([e]) => tabs.classList.toggle('stuck', !e.isIntersecting),
      { rootMargin: '-1px 0px 0px' },
    ).observe(sentinel)
  })
})()

function initNav() {
  if (urlTargetSeries !== null) {
    var seriesIdx = ARCH_LABELS.indexOf(urlTargetSeries)
    var options = document.querySelectorAll('.msd-option')
    var el = options[seriesIdx]
    if (el) selectSeries(urlTargetSeries, el, false)
    return
  }
  const firstTab = document.querySelector('.tab.active')
  if (firstTab) firstTab.click()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    initNav()
  })
} else {
  initNav()
}
document.addEventListener('click', (e) => {
  const otherBtn = e.target.closest('.archetype-other-toggle')
  if (otherBtn) {
    otherCardsAllOpen = !otherCardsAllOpen
    syncOtherCardsState()
    return
  }
})

// Dark mode toggle
window.onDarkModeToggle = (isDark) => {
  const barColor = isDark ? '#818cf8' : '#3b82f6'
  const barColorOther = isDark ? '#475569' : '#cbd5e0'
  const gridColor = isDark ? '#334155' : '#e2e8f0'
  const textColor = isDark ? '#94a3b8' : '#718096'
  for (const pc of pieCharts) {
    pc.chart.options.scales.x.ticks.color = textColor
    pc.chart.options.scales.y.ticks.color = textColor
    pc.chart.options.scales.y.grid.color = gridColor
    pc.chart.update()
  }
  for (const key in archetypeCharts) {
    const charts = archetypeCharts[key]
    for (const type of ['cost', 'level']) {
      charts[type].data.datasets[0].backgroundColor = barColor
      charts[type].data.datasets[1].backgroundColor = barColorOther
      charts[type].options.scales.y.grid.color = gridColor
      charts[type].options.scales.y.ticks.color = textColor
      charts[type].options.scales.x.ticks.color = textColor
      charts[type].update()
    }
  }
}

