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
interface SlackTrigger {
  name: string
  channelId: string
  prompt: string
  projectPath: string
  permissionMode: string
  model: string
  slackBotToken?: string
  pollIntervalMs?: number
}

interface TriggersConfig {
  slack?: Record<string, SlackTrigger>
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
    console.log(`[Slack Poller] Loading config from ${triggersPath}`)
    return JSON.parse(fs.readFileSync(triggersPath, 'utf-8'))
  } catch {
    return { slack: {} }
  }
}

const CCC_URL = process.env.CCC_URL || 'http://localhost:8347'
const CCC_WEBHOOK_SECRET = process.env.CCC_WEBHOOK_SECRET || ''
const DEFAULT_SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || ''

// Track last seen message per channel
const STATE_FILE = path.join(process.env.HOME || '/tmp', '.ccc', 'data', 'slack-poller-state.json')

interface PollerState {
  lastTs: Record<string, string>
}

function loadState(): PollerState {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'))
  } catch {
    return { lastTs: {} }
  }
}

function saveState(state: PollerState) {
  const dir = path.dirname(STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

import {
  filterCandidates,
  shouldProcessMessage,
  PROCESSED_REACTION,
  type SlackMessage,
} from './src/lib/slack-poller/logic.js'

interface SlackHistoryResponse {
  ok: boolean
  messages?: SlackMessage[]
  error?: string
}

interface SlackUserResponse {
  ok: boolean
  user?: { real_name?: string; name?: string }
}

interface SlackApiResponse {
  ok: boolean
  error?: string
}

// Rate limiting state (in-memory, resets on restart)
const lastSessionTime = new Map<string, number>()

async function hasBeenProcessed(token: string, channelId: string, ts: string): Promise<boolean> {
  const res = await fetch(
    `https://slack.com/api/reactions.get?channel=${channelId}&timestamp=${ts}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  )
  const data = await res.json() as { ok: boolean; message?: { reactions?: { name: string }[] } }
  if (!data.ok || !data.message?.reactions) return false
  return data.message.reactions.some(r => r.name === PROCESSED_REACTION)
}

async function markAsProcessed(token: string, channelId: string, ts: string): Promise<void> {
  const res = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ channel: channelId, timestamp: ts, name: PROCESSED_REACTION }),
  })
  const data = await res.json() as SlackApiResponse
  if (!data.ok && data.error !== 'already_reacted') {
    console.error(`[Slack Poller] Failed to add reaction: ${data.error}`)
  }
}

async function pollChannel(trigger: SlackTrigger, state: PollerState) {
  const token = trigger.slackBotToken || DEFAULT_SLACK_TOKEN
  if (!token) {
    console.error(`[Slack Poller] No token for ${trigger.name}`)
    return
  }

  const oldest = state.lastTs[trigger.channelId] || ''
  const url = `https://slack.com/api/conversations.history?channel=${trigger.channelId}&limit=10${oldest ? `&oldest=${oldest}` : ''}`

  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  const data = await res.json() as SlackHistoryResponse

  if (!data.ok) {
    console.error(`[Slack Poller] Error polling ${trigger.name}: ${data.error}`)
    return
  }

  // Filter candidates using tested logic
  const candidates = filterCandidates(data.messages || [], oldest)

  if (candidates.length === 0) return

  for (const msg of candidates) {
    // Update last seen timestamp regardless of whether we process it
    state.lastTs[trigger.channelId] = msg.ts
    saveState(state)

    // Check if already processed via Slack API (reaction check)
    const alreadyProcessed = await hasBeenProcessed(token, trigger.channelId, msg.ts)
    if (alreadyProcessed) {
      console.log(`[Slack Poller] Skipping already-processed message ${msg.ts}`)
      continue
    }

    // Check rate limit (uses tested shouldProcessMessage logic)
    const decision = shouldProcessMessage(msg, trigger.channelId, lastSessionTime)
    if (!decision.process) {
      console.log(`[Slack Poller] Skipping message ${msg.ts}: ${decision.reason}`)
      continue
    }

    // Mark as processed IMMEDIATELY (before forwarding) to prevent re-processing
    await markAsProcessed(token, trigger.channelId, msg.ts)

    // Get author name
    let author = 'bot'
    if (msg.user) {
      try {
        const userRes = await fetch(`https://slack.com/api/users.info?user=${msg.user}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        })
        const userData = await userRes.json() as SlackUserResponse
        if (userData.ok && userData.user) {
          author = userData.user.real_name || userData.user.name || msg.user
        }
      } catch {
        author = msg.user
      }
    }

    console.log(`[Slack Poller] Processing message from ${author}: ${msg.text.slice(0, 100)}...`)

    // Forward to C3 webhook
    try {
      const webhookRes = await fetch(`${CCC_URL}/api/webhooks/slack`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CCC_WEBHOOK_SECRET}`,
        },
        body: JSON.stringify({
          channelId: trigger.channelId,
          channelName: trigger.name,
          message: msg.text,
          author,
          messageTs: msg.ts,
        }),
      })

      const result = await webhookRes.json() as { sessionId?: string; error?: string }
      if (webhookRes.ok && result.sessionId) {
        console.log(`[Slack Poller] Session started: ${result.sessionId}`)
        lastSessionTime.set(trigger.channelId, Date.now())
      } else {
        console.error(`[Slack Poller] Webhook error:`, result.error)
      }
    } catch (err) {
      console.error(`[Slack Poller] Error calling C3:`, err)
    }
  }
}

// Main loop
async function main() {
  const triggers = loadTriggers()
  const slackTriggers = Object.values(triggers.slack || {})

  if (slackTriggers.length === 0) {
    console.log('[Slack Poller] No Slack triggers configured. Exiting.')
    process.exit(0)
  }

  console.log(`[Slack Poller] Watching ${slackTriggers.length} channel(s):`)
  slackTriggers.forEach(t => console.log(`  - #${t.name} (${t.channelId})`))

  const state = loadState()

  // Initialize last seen timestamps to now if not set (don't process old messages)
  for (const trigger of slackTriggers) {
    if (!state.lastTs[trigger.channelId]) {
      // Set to current time so we only process NEW messages
      state.lastTs[trigger.channelId] = String(Date.now() / 1000)
      saveState(state)
    }
  }

  // Poll loop
  const pollInterval = slackTriggers[0].pollIntervalMs || 15000
  console.log(`[Slack Poller] Polling every ${pollInterval / 1000}s`)

  const poll = async () => {
    for (const trigger of slackTriggers) {
      try {
        await pollChannel(trigger, state)
      } catch (err) {
        console.error(`[Slack Poller] Error polling ${trigger.name}:`, err)
      }
    }
  }

  // Initial poll
  await poll()

  // Continue polling
  setInterval(poll, pollInterval)
}

main().catch(err => {
  console.error('[Slack Poller] Fatal error:', err)
  process.exit(1)
})
