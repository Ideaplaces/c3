/**
 * Visual test: renders SessionView with mock data at multiple viewports.
 * No auth, no WebSocket, no real sessions. Pure UI screenshots.
 *
 * Usage: npx tsx tests/visual/screenshot-sessions.ts
 * Output: /tmp/c3-screenshots/
 */

import { chromium } from 'playwright'
import { mkdirSync, cpSync } from 'fs'
import { join } from 'path'

const BASE_URL = 'http://localhost:8347'
const OUTPUT_DIR = '/tmp/c3-screenshots'
const INBOX_DIR = '/home/chipdev/ideaplaces-meta/.inbox'

const VIEWPORTS = [
  { name: 'iphone-se', width: 375, height: 667 },
  { name: 'iphone-14', width: 390, height: 844 },
  { name: 'iphone-pro-max', width: 430, height: 932 },
  { name: 'ipad-mini', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-lg', width: 1920, height: 1080 },
]

const SCENARIOS = ['empty', 'short', 'tools', 'long', 'running', 'error', 'code']

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true })

  // Auth bypass: generate JWT cookie
  const jwt = await import('jsonwebtoken')
  const { readFileSync, resolve } = await import('fs').then(m => ({ readFileSync: m.readFileSync, resolve: require('path').resolve }))
  let secret = ''
  try {
    const env = readFileSync(resolve(__dirname, '../../.env.local'), 'utf-8')
    const match = env.match(/JWT_SECRET=(.+)/)
    if (match) secret = match[1].trim()
  } catch {}
  if (!secret) { console.error('JWT_SECRET not found'); process.exit(1) }

  const token = jwt.default.sign({ email: 'test@c3.dev', name: 'Test', avatarUrl: null }, secret, { expiresIn: '1h' })
  const cookies = [{ name: 'ccc_session', value: token, domain: 'localhost', path: '/' }]

  const browser = await chromium.launch({ headless: true })
  let count = 0

  for (const scenario of SCENARIOS) {
    console.log(`\n--- ${scenario} ---`)
    for (const vp of VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
      await ctx.addCookies(cookies)
      const page = await ctx.newPage()

      await page.goto(`${BASE_URL}/visual-test?scenario=${scenario}`)
      await page.waitForTimeout(1000) // Quick settle, no WebSocket needed

      const file = `${scenario}-${vp.name}.png`
      await page.screenshot({ path: join(OUTPUT_DIR, file), fullPage: false })
      console.log(`  ${file}`)
      count++
      await ctx.close()
    }
  }

  await browser.close()

  // Copy to .inbox
  cpSync(OUTPUT_DIR, INBOX_DIR, { recursive: true, filter: (src) => src.endsWith('.png') || !src.includes('.') })
  // Actually copy individual files
  const { readdirSync } = require('fs')
  for (const f of readdirSync(OUTPUT_DIR)) {
    if (f.endsWith('.png')) cpSync(join(OUTPUT_DIR, f), join(INBOX_DIR, f))
  }

  console.log(`\nDone! ${count} screenshots in ${OUTPUT_DIR}/ and .inbox/`)
}

main().catch(console.error)
