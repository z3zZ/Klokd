// NETWORK AUDIT — klokd makes zero outbound network requests at runtime.
// Python dependencies: pywin32, psutil, watchdog, pyyaml, sqlite3 (stdlib)
// None of these make network calls during normal operation.
// The only network call in the entire app is loading JetBrains Mono
// from Google Fonts in the Electron renderer on first load.
// This can be replaced with a local font file for fully offline operation.

'use strict'

const {
  app, BrowserWindow, Tray, ipcMain, nativeImage, dialog, Menu,
} = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const zlib = require('zlib')
const AutoLaunch = require('electron-auto-launch')
const yaml = require('js-yaml')
const { getInsights } = require('./insights')

// Never show crash dialogs — log and continue.
process.on('uncaughtException', (err) => {
  console.error('[klokd] uncaught exception:', err.message)
})

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, '..')
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.yaml')
const CATEGORIES_PATH = path.join(ROOT, 'config', 'categories.yaml')

const DEFAULT_SETTINGS = {
  poll_interval_seconds: 5,
  idle_threshold_seconds: 120,
  db_path: 'data/klokd.db',
  log_path: 'logs/daemon.log',
  consent_given: false,
  consent_timestamp: null,
}

function loadSettings() {
  try {
    return yaml.load(fs.readFileSync(SETTINGS_PATH, 'utf8')) || { ...DEFAULT_SETTINGS }
  } catch {
    saveSettings({ ...DEFAULT_SETTINGS })
    return { ...DEFAULT_SETTINGS }
  }
}

function saveSettings(obj) {
  fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true })
  fs.writeFileSync(SETTINGS_PATH, yaml.dump(obj), 'utf8')
}

const settings = loadSettings()
const DB_PATH = path.resolve(ROOT, settings.db_path)
const POLL_INTERVAL = settings.poll_interval_seconds || 5

// ---------------------------------------------------------------------------
// SQLite via sql.js (pure WASM — no native compilation required)
// ---------------------------------------------------------------------------

let SQL = null

async function initSQL() {
  const initSqlJs = require('sql.js')
  SQL = await initSqlJs({
    locateFile: file => path.join(ROOT, 'node_modules', 'sql.js', 'dist', file),
  })
}

function openDb() {
  if (!SQL) throw new Error('SQL not initialised')
  if (!fs.existsSync(DB_PATH)) return new SQL.Database()
  try {
    return new SQL.Database(fs.readFileSync(DB_PATH))
  } catch {
    console.error('[klokd] DB corrupt — recreating')
    try { fs.unlinkSync(DB_PATH) } catch {}
    return new SQL.Database()
  }
}

function dbAll(sql, params = []) {
  const db = openDb()
  try {
    const stmt = db.prepare(sql)
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  } finally {
    db.close()
  }
}

function dbExec(sqls) {
  const db = openDb()
  try {
    db.run(sqls)
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    fs.writeFileSync(DB_PATH, db.export())
  } finally {
    db.close()
  }
}

function dbTransaction(fn) {
  const db = openDb()
  try {
    db.run('BEGIN')
    fn(db)
    db.run('COMMIT')
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })
    fs.writeFileSync(DB_PATH, db.export())
  } catch (e) {
    try { db.run('ROLLBACK') } catch {}
    throw e
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Colour map
// ---------------------------------------------------------------------------

const CAT_COLORS = {
  productive:    '#C8F135',
  gaming:        '#7C6FE8',
  social:        '#E8785A',
  entertainment: '#5AB4E8',
  system:        '#333333',
  uncategorised: '#888888',
}

// ---------------------------------------------------------------------------
// DB query functions
// ---------------------------------------------------------------------------

function queryTodaySummary() {
  const rows = dbAll(`
    SELECT COALESCE(category, 'uncategorised') as cat, COUNT(*) as cnt
    FROM events
    WHERE date(timestamp) = date('now')
      AND is_idle = 0
    GROUP BY cat
    ORDER BY cnt DESC
  `)

  const totalCount = rows.reduce((s, r) => s + r.cnt, 0)
  const totalSeconds = totalCount * POLL_INTERVAL

  return {
    categories: rows.map(r => ({
      key: r.cat,
      label: r.cat,
      color: CAT_COLORS[r.cat] || CAT_COLORS.uncategorised,
      seconds: r.cnt * POLL_INTERVAL,
      pct: totalCount > 0 ? Math.round((r.cnt / totalCount) * 100) : 0,
    })),
    totalSeconds,
    date: new Date().toISOString().slice(0, 10),
  }
}

function queryTopApps() {
  const rows = dbAll(`
    SELECT exe, COALESCE(category, 'uncategorised') as cat, COUNT(*) as cnt
    FROM events
    WHERE date(timestamp) = date('now')
      AND is_idle = 0
      AND category != 'system'
      AND exe NOT IN ('desktop', 'unknown')
    GROUP BY exe
    ORDER BY cnt DESC
    LIMIT 10
  `)

  return rows.map(r => ({
    exe: r.exe,
    label: r.exe.replace(/\.exe$/i, ''),
    seconds: r.cnt * POLL_INTERVAL,
    category: r.cat,
    color: CAT_COLORS[r.cat] || CAT_COLORS.uncategorised,
  }))
}

function queryWeekTrends() {
  const rows = dbAll(`
    SELECT date(timestamp) as day, COALESCE(category, 'uncategorised') as cat, COUNT(*) as cnt
    FROM events
    WHERE date(timestamp) >= date('now', '-6 days')
      AND is_idle = 0
    GROUP BY day, cat
    ORDER BY day ASC
  `)

  const dayMap = {}
  rows.forEach(r => {
    if (!dayMap[r.day]) dayMap[r.day] = {}
    dayMap[r.day][r.cat] = (dayMap[r.day][r.cat] || 0) + r.cnt * POLL_INTERVAL
  })

  const result = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const day = d.toISOString().slice(0, 10)
    const cats = dayMap[day] || {}
    result.push({
      date: day,
      categories: Object.entries(cats).map(([key, seconds]) => ({
        key, seconds, color: CAT_COLORS[key] || CAT_COLORS.uncategorised,
      })),
    })
  }
  return result
}

// ---------------------------------------------------------------------------
// Tray icon — programmatic 16×16 PNG, no external assets needed
// ---------------------------------------------------------------------------

function makeCrc32Table() {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
}
const _crcTable = makeCrc32Table()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = _crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(type, 'ascii')
  const crc = Buffer.allocUnsafe(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

function createTrayIconBuffer() {
  const W = 16, H = 16
  const rgba = Buffer.alloc(W * H * 4, 0)
  const put = (x, y) => {
    x = Math.round(x); y = Math.round(y)
    if (x < 0 || x >= W || y < 0 || y >= H) return
    const i = (y * W + x) * 4
    rgba[i] = 0x88; rgba[i+1] = 0x88; rgba[i+2] = 0x88; rgba[i+3] = 0xff
  }
  for (let a = 0; a < 360; a += 2)
    put(8 + 6.3 * Math.cos(a * Math.PI / 180), 8 + 6.3 * Math.sin(a * Math.PI / 180))
  for (let t = 0; t <= 1; t += 0.2) put(8, 8 - 3.5 * t)
  for (let t = 0; t <= 1; t += 0.2) put(8 + 4 * t, 8)

  const sl = Buffer.alloc(H * (1 + W * 4))
  for (let y = 0; y < H; y++) {
    sl[y * (1 + W * 4)] = 0
    rgba.copy(sl, y * (1 + W * 4) + 1, y * W * 4, (y + 1) * W * 4)
  }
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(sl)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// Daemon process management
// ---------------------------------------------------------------------------

let daemonProc = null
let daemonRestartTimer = null

function startDaemon() {
  const pidFile = path.join(ROOT, 'data', 'daemon.pid')
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10)
      process.kill(pid, 0)
      return
    } catch {
      try { fs.unlinkSync(pidFile) } catch {}
    }
  }

  const python = process.platform === 'win32' ? 'pythonw' : 'python3'
  daemonProc = spawn(python, [path.join(ROOT, 'daemon', 'main.py')], {
    cwd: ROOT,
    detached: false,
    stdio: 'ignore',
  })

  daemonProc.on('exit', (code) => {
    daemonProc = null
    if (code !== 0 && !app.isQuitting) {
      daemonRestartTimer = setTimeout(startDaemon, 5000)
    }
  })
}

function stopDaemon() {
  if (daemonRestartTimer) clearTimeout(daemonRestartTimer)
  if (daemonProc) {
    try { daemonProc.kill('SIGTERM') } catch {}
    daemonProc = null
  }
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let win = null
let tray = null

function createWindow() {
  win = new BrowserWindow({
    width: 360,
    height: 580,
    frame: false,
    resizable: false,
    maximizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#0D0D0D',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadFile(path.join(__dirname, 'dist', 'index.html'))
  win.setMenuBarVisibility(false)

  win.on('blur', () => {
    if (win && !win.webContents.isDevToolsOpened()) win.hide()
  })
  win.on('closed', () => { win = null })
}

function positionAboveTray() {
  if (!win || !tray) return
  const tb = tray.getBounds()
  const wb = win.getBounds()
  win.setPosition(
    Math.round(tb.x + tb.width / 2 - wb.width / 2),
    Math.round(tb.y - wb.height - 4),
    false
  )
}

function toggleWindow() {
  if (!win) createWindow()
  if (win.isVisible()) {
    win.hide()
  } else {
    positionAboveTray()
    win.show()
    win.focus()
  }
}

// ---------------------------------------------------------------------------
// Auto-launch
// ---------------------------------------------------------------------------

const autoLauncher = new AutoLaunch({ name: 'Klokd' })

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('klokd:getConsentStatus', () => {
  return { given: !!loadSettings().consent_given }
})

ipcMain.handle('klokd:setConsent', () => {
  const s = loadSettings()
  s.consent_given = true
  s.consent_timestamp = new Date().toISOString()
  saveSettings(s)
  startDaemon()
  return { ok: true }
})

ipcMain.handle('klokd:getTodaySummary', () => {
  try { return queryTodaySummary() } catch { return { categories: [], totalSeconds: 0, date: '' } }
})

ipcMain.handle('klokd:getTopApps', () => {
  try { return queryTopApps() } catch { return [] }
})

ipcMain.handle('klokd:getWeekTrends', () => {
  try { return queryWeekTrends() } catch { return [] }
})

ipcMain.handle('klokd:getInsights', async () => {
  try { return getInsights(dbAll) } catch { return [] }
})

ipcMain.handle('klokd:getAutoLaunchEnabled', async () => {
  try { return { enabled: await autoLauncher.isEnabled() } } catch { return { enabled: false } }
})

ipcMain.handle('klokd:setAutoLaunch', async (_e, enabled) => {
  try {
    if (enabled) await autoLauncher.enable(); else await autoLauncher.disable()
    return { ok: true }
  } catch { return { ok: false } }
})

ipcMain.handle('klokd:getSettings', () => {
  return { pollInterval: loadSettings().poll_interval_seconds }
})

ipcMain.handle('klokd:setPollInterval', (_e, seconds) => {
  const s = loadSettings(); s.poll_interval_seconds = seconds; saveSettings(s)
  return { ok: true }
})

ipcMain.handle('klokd:getCategoriesYaml', () => {
  try { return { content: fs.readFileSync(CATEGORIES_PATH, 'utf8') } } catch { return { content: '' } }
})

ipcMain.handle('klokd:setCategoriesYaml', (_e, content) => {
  try {
    yaml.load(content)
    fs.writeFileSync(CATEGORIES_PATH, content, 'utf8')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('klokd:recategoriseAll', () => {
  try {
    const cats = yaml.load(fs.readFileSync(CATEGORIES_PATH, 'utf8'))?.categories || {}
    function classify(exe, title) {
      const el = exe.toLowerCase(), tl = title.toLowerCase()
      for (const cat of Object.values(cats)) {
        if ((cat.apps || []).map(a => a.toLowerCase()).includes(el)) return cat.label
      }
      for (const cat of Object.values(cats)) {
        for (const p of cat.title_patterns || []) {
          if (tl.includes(p.toLowerCase())) return cat.label
        }
      }
      return 'uncategorised'
    }

    const rows = dbAll('SELECT id, exe, title FROM events')
    dbTransaction(db => {
      const stmt = db.prepare('UPDATE events SET category = ? WHERE id = ?')
      for (const r of rows) { stmt.run([classify(r.exe, r.title), r.id]); stmt.reset() }
      stmt.free()
    })
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('klokd:exportData', async () => {
  const { filePath } = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('desktop'), `klokd_export_${new Date().toISOString().slice(0, 10)}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  })
  if (!filePath) return { ok: false }
  try {
    const rows = dbAll('SELECT timestamp, exe, title, category, is_idle, session_id FROM events ORDER BY timestamp')
    const header = 'timestamp,exe,title,category,is_idle,session_id\n'
    const body = rows.map(r =>
      [r.timestamp, r.exe, `"${(r.title || '').replace(/"/g, '""')}"`, r.category, r.is_idle, r.session_id].join(',')
    ).join('\n')
    fs.writeFileSync(filePath, header + body, 'utf8')
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

ipcMain.handle('klokd:deleteAllData', async () => {
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Delete all data', 'Cancel'],
    defaultId: 1,
    message: 'delete all data? this cannot be undone.',
  })
  if (response !== 0) return { ok: false, cancelled: true }
  try {
    dbExec(`
      DROP TABLE IF EXISTS events;
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL, exe TEXT NOT NULL, title TEXT NOT NULL,
        is_idle INTEGER NOT NULL DEFAULT 0, category TEXT, session_id TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ts ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_cat ON events(category);
    `)
    const s = loadSettings()
    s.consent_given = false
    s.consent_timestamp = null
    saveSettings(s)
    stopDaemon()
    app.relaunch()
    app.quit()
    return { ok: true }
  } catch (err) { return { ok: false, error: err.message } }
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  app.setAppUserModelId('dev.joshan.klokd')

  await initSQL()

  const icon = nativeImage.createFromBuffer(createTrayIconBuffer())
  tray = new Tray(icon)
  tray.setToolTip('klokd')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open klokd', click: () => toggleWindow() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit() } },
  ]))
  tray.on('click', () => toggleWindow())

  createWindow()
  startDaemon()
})

app.on('before-quit', () => { app.isQuitting = true })
app.on('will-quit', () => stopDaemon())
app.on('window-all-closed', () => { /* stay in tray */ })
