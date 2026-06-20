'use strict'

const POLL = 5 // seconds per event

const TEMPLATES = {
  peak_focus:             'Your most focused window tends to be {time_range}.',
  gaming_above_avg:       'Gaming ran {delta} above your weekly average.',
  gaming_below_avg:       'Gaming is down {delta} on your usual week.',
  focus_fragmented:       'You switched apps {count} times during focused work today.',
  long_streak:            'You held a focused session for {duration} today.',
  week_category_up:       '{category} time is up {pct}% on last week.',
  week_category_down:     '{category} time is down {pct}% on last week.',
  productive_peak_missed: 'Your usual focus window was {category} today.',
}

const FORBIDDEN = [
  'waste', 'wasting', 'wasted', 'too much', 'should',
  'warning', 'great job', 'well done', 'bad', 'unproductive',
  'shame', 'guilty', 'problem',
]

function fill(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] != null ? String(vars[k]) : `{${k}}`)
}

function validate(text) {
  const lower = text.toLowerCase()
  for (const w of FORBIDDEN) {
    if (lower.includes(w)) throw new Error(`Forbidden word '${w}' in insight text`)
  }
  return text
}

function fmtHour(h) {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

function fmtRange(h) { return `${fmtHour(h)}–${fmtHour(h + 2)}` }

function fmtSecs(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return h ? `${h}h ${m}m` : `${m}m`
}

function parseTs(ts) {
  return new Date(ts.replace(' ', 'T') + 'Z').getTime()
}

// Each insight function receives `dbAll(sql, params)` from main.js
// dbAll returns an array of plain row objects.

function peakFocusWindow(dbAll) {
  try {
    const [{ d }] = dbAll(`
      SELECT COUNT(DISTINCT date(timestamp)) AS d FROM events
      WHERE timestamp >= datetime('now', '-7 days')
        AND category = 'productive' AND is_idle = 0
    `)
    if (d < 4) return null

    const rows = dbAll(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS cnt
      FROM events
      WHERE timestamp >= datetime('now', '-7 days')
        AND category = 'productive' AND is_idle = 0
      GROUP BY hour
    `)
    if (!rows.length) return null

    const counts = {}
    for (const r of rows) counts[r.hour] = r.cnt

    let best = 0
    for (let h = 1; h < 23; h++) {
      const score = (counts[h] || 0) + (counts[h + 1] || 0)
      const bestScore = (counts[best] || 0) + (counts[best + 1] || 0)
      if (score > bestScore) best = h
    }
    if ((counts[best] || 0) + (counts[best + 1] || 0) === 0) return null

    return { text: validate(fill(TEMPLATES.peak_focus, { time_range: fmtRange(best) })), priority: 2 }
  } catch { return null }
}

function gamingVsAverage(dbAll) {
  const MIN_DELTA = 30 * 60
  try {
    const todayCnt = dbAll(`
      SELECT COUNT(*) AS n FROM events
      WHERE date(timestamp) = date('now') AND category = 'gaming' AND is_idle = 0
    `)[0].n
    const pastCnt = dbAll(`
      SELECT COUNT(*) AS n FROM events
      WHERE timestamp >= datetime('now', '-7 days')
        AND date(timestamp) < date('now')
        AND category = 'gaming' AND is_idle = 0
    `)[0].n
    const trackedDays = dbAll(`
      SELECT COUNT(DISTINCT date(timestamp)) AS d FROM events
      WHERE timestamp >= datetime('now', '-7 days')
        AND date(timestamp) < date('now')
    `)[0].d

    if (!trackedDays) return null
    const todaySecs = todayCnt * POLL
    const avgSecs = (pastCnt * POLL) / trackedDays
    const delta = todaySecs - avgSecs
    if (Math.abs(delta) < MIN_DELTA) return null

    const key = delta > 0 ? 'gaming_above_avg' : 'gaming_below_avg'
    return { text: validate(fill(TEMPLATES[key], { delta: fmtSecs(Math.abs(delta)) })), priority: 1 }
  } catch { return null }
}

function focusFragmentation(dbAll) {
  try {
    const rows = dbAll(`
      SELECT exe FROM events
      WHERE date(timestamp) = date('now') AND category = 'productive' AND is_idle = 0
      ORDER BY timestamp
    `)
    if (rows.length < 2) return null

    const productiveHours = (rows.length * POLL) / 3600
    if (productiveHours < 0.5) return null

    let switches = 0
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].exe !== rows[i - 1].exe) switches++
    }
    if (switches / productiveHours <= 8) return null

    return { text: validate(fill(TEMPLATES.focus_fragmented, { count: switches })), priority: 2 }
  } catch { return null }
}

function longStreak(dbAll) {
  const MIN_STREAK = 90 * 60
  const GAP_LIMIT = 120
  try {
    const rows = dbAll(`
      SELECT timestamp FROM events
      WHERE date(timestamp) = date('now') AND category = 'productive' AND is_idle = 0
      ORDER BY timestamp
    `)
    if (!rows.length) return null

    let best = POLL, current = POLL
    for (let i = 1; i < rows.length; i++) {
      const gap = (parseTs(rows[i].timestamp) - parseTs(rows[i - 1].timestamp)) / 1000
      if (gap <= GAP_LIMIT) {
        current += POLL
      } else {
        best = Math.max(best, current)
        current = POLL
      }
    }
    best = Math.max(best, current)
    if (best < MIN_STREAK) return null

    return { text: validate(fill(TEMPLATES.long_streak, { duration: fmtSecs(best) })), priority: 3 }
  } catch { return null }
}

function weekOverWeek(dbAll) {
  try {
    const toMap = (rows) => Object.fromEntries(rows.map(r => [r.cat, r.cnt * POLL]))

    const thisWeek = toMap(dbAll(`
      SELECT COALESCE(category, 'uncategorised') AS cat, COUNT(*) AS cnt
      FROM events
      WHERE timestamp >= datetime('now', '-7 days') AND is_idle = 0
      GROUP BY cat
    `))
    const lastWeek = toMap(dbAll(`
      SELECT COALESCE(category, 'uncategorised') AS cat, COUNT(*) AS cnt
      FROM events
      WHERE timestamp >= datetime('now', '-14 days')
        AND timestamp < datetime('now', '-7 days')
        AND is_idle = 0
      GROUP BY cat
    `))

    if (!Object.keys(thisWeek).length || !Object.keys(lastWeek).length) return null

    const topCat = Object.entries(thisWeek).sort((a, b) => b[1] - a[1])[0][0]
    const thisSecs = thisWeek[topCat]
    const prevSecs = lastWeek[topCat] || 0
    if (!prevSecs) return null

    const pctChange = (thisSecs - prevSecs) / prevSecs * 100
    if (Math.abs(pctChange) <= 25) return null

    const pct = Math.floor(Math.abs(pctChange))
    const key = pctChange > 0 ? 'week_category_up' : 'week_category_down'
    const cat = topCat.charAt(0).toUpperCase() + topCat.slice(1)
    return { text: validate(fill(TEMPLATES[key], { category: cat, pct })), priority: 2 }
  } catch { return null }
}

function productivePeakMissed(dbAll) {
  try {
    const [{ d }] = dbAll(`
      SELECT COUNT(DISTINCT date(timestamp)) AS d FROM events
      WHERE timestamp >= datetime('now', '-7 days')
        AND category = 'productive' AND is_idle = 0
    `)
    if (d < 4) return null

    const rows = dbAll(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS cnt
      FROM events
      WHERE timestamp >= datetime('now', '-7 days')
        AND category = 'productive' AND is_idle = 0
      GROUP BY hour
    `)
    if (!rows.length) return null

    const counts = {}
    for (const r of rows) counts[r.hour] = r.cnt
    let best = 0
    for (let h = 1; h < 23; h++) {
      if ((counts[h] || 0) + (counts[h + 1] || 0) > (counts[best] || 0) + (counts[best + 1] || 0)) best = h
    }

    const todayRows = dbAll(`
      SELECT COALESCE(category, 'uncategorised') AS cat, COUNT(*) AS cnt
      FROM events
      WHERE date(timestamp) = date('now')
        AND CAST(strftime('%H', timestamp) AS INTEGER) IN (${best}, ${best + 1})
        AND is_idle = 0
      GROUP BY cat
      ORDER BY cnt DESC
      LIMIT 1
    `)
    if (!todayRows.length) return null

    const dominant = todayRows[0].cat
    if (dominant === 'productive') return null

    return { text: validate(fill(TEMPLATES.productive_peak_missed, { category: dominant })), priority: 1 }
  } catch { return null }
}

function getInsights(dbAll, max = 2) {
  const fns = [gamingVsAverage, productivePeakMissed, peakFocusWindow, focusFragmentation, weekOverWeek, longStreak]
  const results = []
  for (const fn of fns) {
    try {
      const r = fn(dbAll)
      if (r) results.push(r)
    } catch { /* one bad insight never blocks the rest */ }
  }
  results.sort((a, b) => a.priority - b.priority)
  return results.slice(0, max)
}

module.exports = { getInsights }
