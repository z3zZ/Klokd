import { _electron as electron } from 'playwright-core'
import { fileURLToPath } from 'url'
import path from 'path'
import fs from 'fs'

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..')
const ELECTRON_BIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const SHOT_DIR = path.join(ROOT, 'scripts', 'screenshots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

console.log('Launching Klokd...')
const app = await electron.launch({
  executablePath: ELECTRON_BIN,
  args: [ROOT],
  cwd: ROOT,
  timeout: 30_000,
})

await app.evaluate(({ BrowserWindow }) => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) { win.show(); win.focus() }
})

const page = app.windows()[0]
page.on('pageerror', err => console.error('PAGE ERROR:', err.message))

await page.waitForLoadState('domcontentloaded')
await new Promise(r => setTimeout(r, 2000))

async function shot(name) {
  const p = path.join(SHOT_DIR, `${name}.png`)
  await page.screenshot({ path: p, timeout: 8000 }).catch(e => console.log('screenshot timeout:', name))
  console.log('  ✓', name)
}

async function nav(label) {
  await page.evaluate(text => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === text)
    if (btn) btn.click()
  }, label)
  await new Promise(r => setTimeout(r, 800))
}

// Check all 4 views
console.log('Taking screenshots of all views...')
await shot('today-view')

await nav('week'); await shot('week-view')
await nav('apps');  await shot('apps-view')
await nav('settings'); await shot('settings-view')
await nav('today'); await shot('today-view-return')

// Verify key brand elements
const checks = await page.evaluate(() => ({
  wordmark: document.body.innerHTML.includes('kl<span'),
  tagline: document.body.innerText.includes('your day,'),
  kloked: document.body.innerText.includes('kloked.'),
  navButtons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()),
  bgColor: getComputedStyle(document.body).backgroundColor,
}))

console.log('\nBrand checks:')
console.log('  wordmark present:', checks.wordmark)
console.log('  tagline present:', checks.tagline)
console.log('  "kloked." present:', checks.kloked)
console.log('  nav buttons:', checks.navButtons)
console.log('  background:', checks.bgColor, '(expect rgb(13, 13, 13))')

const pass = checks.wordmark && checks.tagline && checks.kloked && checks.bgColor === 'rgb(13, 13, 13)'
console.log(pass ? '\n✓ All checks passed' : '\n✗ Some checks failed')

await app.close()
