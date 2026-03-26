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

function loadTriggers(): TriggersConfig {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'triggers.json'), 'utf-8'))
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

interface SlackMessage {
  text: string
  user?: string
  bot_id?: string
  ts: string
  thread_ts?: string
  subtype?: string
}

interface SlackHistoryResponse {
  ok: boolean
  messages?: SlackMessage[]
  error?: string
}

interface SlackUserResponse {
  ok: boolean
  user?: { real_name?: string; name?: string }
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

  // Filter messages:
  // - Include regular messages and bot alerts (monitoring systems post as bots)
  // - Exclude our own bot's replies (they contain "Agent Investigation Complete")
  // - Exclude thread replies (thread_ts !== ts means it's a reply, not a top-level message)
  const messages = (data.messages || [])
    .filter(m => !m.subtype || m.subtype === 'bot_message')
    .filter(m => m.ts !== oldest)
    .filter(m => !m.thread_ts || m.thread_ts === m.ts) // only top-level messages
    .filter(m => !m.text?.includes('Agent Investigation Complete')) // ignore our own replies
    .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))

  if (messages.length === 0) return

  console.log(`[Slack Poller] ${messages.length} new message(s) in #${trigger.name}`)

  for (const msg of messages) {
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

    console.log(`[Slack Poller] Forwarding message from ${author}: ${msg.text.slice(0, 100)}...`)

    // Forward to CCC webhook
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
      } else {
        console.error(`[Slack Poller] Webhook error:`, result.error)
      }
    } catch (err) {
      console.error(`[Slack Poller] Error calling CCC:`, err)
    }

    // Update last seen timestamp
    state.lastTs[trigger.channelId] = msg.ts
    saveState(state)
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
