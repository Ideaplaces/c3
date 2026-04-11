import fs from 'fs'
import path from 'path'

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

// Minimal cron parser: supports standard 5-field cron expressions
// Fields: minute hour day-of-month month day-of-week
function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = []

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.push(i)
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      const start = range === '*' ? min : parseInt(range, 10)
      for (let i = start; i <= max; i += step) values.push(i)
    } else if (part.includes('-')) {
      const [startStr, endStr] = part.split('-')
      const start = parseInt(startStr, 10)
      const end = parseInt(endStr, 10)
      for (let i = start; i <= end; i++) values.push(i)
    } else {
      values.push(parseInt(part, 10))
    }
  }

  return values
}

function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false

  const [minField, hourField, domField, monthField, dowField] = parts
  const minute = date.getMinutes()
  const hour = date.getHours()
  const dom = date.getDate()
  const month = date.getMonth() + 1 // JS months are 0-based
  const dow = date.getDay() // 0 = Sunday

  return (
    parseCronField(minField, 0, 59).includes(minute) &&
    parseCronField(hourField, 0, 23).includes(hour) &&
    parseCronField(domField, 1, 31).includes(dom) &&
    parseCronField(monthField, 1, 12).includes(month) &&
    parseCronField(dowField, 0, 6).includes(dow)
  )
}

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

// Track last fire time per trigger to prevent double-fires
const lastFireTime = new Map<string, number>()

async function checkAndFire(trigger: CronTrigger) {
  const now = new Date()

  if (!cronMatches(trigger.schedule, now)) return

  // Prevent double-fire within the same minute
  const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`
  const lastFire = lastFireTime.get(trigger.name)
  const currentMinuteMs = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes()).getTime()
  if (lastFire && lastFire >= currentMinuteMs) return

  lastFireTime.set(trigger.name, currentMinuteMs)

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

    const result = await res.json() as { sessionId?: string; error?: string }
    if (res.ok && result.sessionId) {
      console.log(`[Cron Scheduler] Session started: ${result.sessionId} for "${trigger.name}"`)
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

    for (const trigger of activeTriggers) {
      try {
        await checkAndFire(trigger)
      } catch (err) {
        console.error(`[Cron Scheduler] Error checking "${trigger.name}":`, err)
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
