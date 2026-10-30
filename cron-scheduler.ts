import { ensureToolPath } from './src/lib/env-path.js'
ensureToolPath()
import fs from 'fs'
import path from 'path'
import { dueAt } from './src/lib/triggers/cron.js'

// Load .env.local
try {
  const envPath = path.join(process.cwd(), '.env.local')
  const envContent = fs.readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIdx = trimmed.indexOf('=')
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx)
    const value = trimmed.slice(eqIdx + 1)
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
} catch {
  // rely on environment
}

// Load triggers config
interface CronTrigger {
  name: string
  schedule: string
  prompt: string
  projectPath: string
  permissionMode: string
  model: string
  enabled?: boolean
}

interface TriggersConfig {
  cron?: Record<string, CronTrigger>
}

function findTriggersJson(): string {
  const home = process.env.HOME || '/tmp'
  if (process.env.C3_CONFIG_DIR) {
    return path.join(process.env.C3_CONFIG_DIR, 'triggers.json')
  }
  const candidates = [
    path.join(home, '.c3', 'triggers.json'),
    path.join(process.cwd(), 'triggers.json'),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return path.join(process.cwd(), 'triggers.json')
}

function loadTriggers(): TriggersConfig {
  try {
    const triggersPath = findTriggersJson()
    console.log(`[Cron Scheduler] Loading config from ${triggersPath}`)
    return JSON.parse(fs.readFileSync(triggersPath, 'utf-8'))
  } catch {
    return { cron: {} }
  }
}

const CCC_URL = process.env.CCC_URL || 'http://localhost:8347'
const CCC_WEBHOOK_SECRET = process.env.CCC_WEBHOOK_SECRET || ''

// The schedule as a person reads it, for the startup log (the matcher itself is src/lib/triggers/cron.ts).
function humanReadableCron(expression: string): string {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return expression
  const [min, hour, dom, month, dow] = parts

  const dowNames: Record<string, string> = {
    '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed',
    '4': 'Thu', '5': 'Fri', '6': 'Sat',
    '1-5': 'Mon-Fri', '0,6': 'Sat,Sun',
  }

  const timePart = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`

  if (dom === '*' && month === '*' && dow !== '*') {
    return `${dowNames[dow] || dow} at ${timePart}`
  }
  if (dom === '*' && month === '*' && dow === '*') {
    return `Daily at ${timePart}`
  }
  return expression
}

// Last minute fired per trigger, so the two ticks of a minute fire it once.
const lastFireTime = new Map<string, number>()

async function fire(trigger: CronTrigger, now: Date) {
  console.log(`[Cron Scheduler] Firing trigger "${trigger.name}" (schedule: ${trigger.schedule})`)

  try {
    const res = await fetch(`${CCC_URL}/api/webhooks/cron`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CCC_WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        triggerName: trigger.name,
        schedule: trigger.schedule,
        timestamp: now.toISOString(),
      }),
    })

    const result = await res.json() as { sessionId?: string; error?: string; status?: string; reason?: string }
    if (res.ok && result.sessionId) {
      console.log(`[Cron Scheduler] Session started: ${result.sessionId} for "${trigger.name}"`)
    } else if (res.ok && result.status === 'skipped') {
      console.log(`[Cron Scheduler] Precheck skipped "${trigger.name}": ${result.reason}`)
    } else {
      console.error(`[Cron Scheduler] Webhook error for "${trigger.name}":`, result.error)
    }
  } catch (err) {
    console.error(`[Cron Scheduler] Error firing "${trigger.name}":`, err)
  }
}

// Main loop: check every 30 seconds
async function main() {
  const triggers = loadTriggers()
  const cronTriggers = Object.values(triggers.cron || {}).filter(t => t.enabled !== false)

  if (cronTriggers.length === 0) {
    console.log('[Cron Scheduler] No cron triggers configured. Exiting.')
    process.exit(0)
  }

  console.log(`[Cron Scheduler] Loaded ${cronTriggers.length} trigger(s):`)
  cronTriggers.forEach(t => console.log(`  - ${t.name}: ${t.schedule} (${humanReadableCron(t.schedule)})`))

  const check = async () => {
    // Reload config each cycle (hot-reload like other pollers)
    const freshTriggers = loadTriggers()
    const activeTriggers = Object.values(freshTriggers.cron || {}).filter(t => t.enabled !== false)
    // One clock reading for the whole list: every trigger is judged on the same
    // minute, however long the earlier firings take (see dueAt).
    const now = new Date()
    const due = dueAt(activeTriggers, now, lastFireTime)
    console.log(`[Cron Scheduler] Checking ${activeTriggers.length} triggers at ${now.toISOString()} (${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}): ${due.length ? due.map(t => t.name).join(', ') : 'none due'}`)

    for (const trigger of due) {
      try {
        await fire(trigger, now)
      } catch (err) {
        console.error(`[Cron Scheduler] Error firing "${trigger.name}":`, err)
      }
    }
  }

  // Check every 30 seconds
  setInterval(check, 30_000)

  // Initial check
  await check()
}

main().catch(err => {
  console.error('[Cron Scheduler] Fatal error:', err)
  process.exit(1)
})
