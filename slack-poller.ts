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
  // Minimum gap between two sessions on this channel. Defaults to COOLDOWN_MS
  // (5 minutes). 0 for channels where every message is its own case.
  cooldownMs?: number
  // When true, the poller never writes to the channel: no 👀 marker on the
  // alert. Dedup falls back to the local processed ledger in the state file.
  // Used on channels shared with a team, where a reaction reads as "someone is
  // handling this" when nobody is.
  noReaction?: boolean
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

function expandEnvVars(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name) => {
      const resolved = process.env[name]
      if (resolved === undefined) {
        console.warn(`[Slack Poller] Env var ${name} referenced in triggers.json is not set`)
        return match
      }
      return resolved
    })
  }
  if (Array.isArray(value)) return value.map(expandEnvVars)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEnvVars(v)
    }
    return out
  }
  return value
}

function loadTriggers(): TriggersConfig {
  try {
    const triggersPath = findTriggersJson()
    console.log(`[Slack Poller] Loading config from ${triggersPath}`)
    const raw = JSON.parse(fs.readFileSync(triggersPath, 'utf-8'))
    return expandEnvVars(raw) as TriggersConfig
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
  // Processed message timestamps per channel, for triggers running with
  // noReaction: true (no 👀 marker to read back from Slack).
  processed?: Record<string, string[]>
}

function loadState(): PollerState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as PollerState
    return { lastTs: parsed.lastTs || {}, processed: parsed.processed || {} }
  } catch {
    return { lastTs: {}, processed: {} }
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
  extractFullText,
  isProcessed,
  markProcessed,
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

  // Reaction-free triggers dedup off the local ledger instead of the 👀 marker.
  const useReaction = trigger.noReaction !== true

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

    // Check if already processed: the 👀 reaction via the Slack API, or the
    // local ledger for channels the poller must not write to.
    const alreadyProcessed = useReaction
      ? await hasBeenProcessed(token, trigger.channelId, msg.ts)
      : isProcessed(state.processed?.[trigger.channelId], msg.ts)
    if (alreadyProcessed) {
      console.log(`[Slack Poller] Skipping already-processed message ${msg.ts}`)
      continue
    }

    // Check rate limit (uses tested shouldProcessMessage logic)
    const decision = shouldProcessMessage(
      msg,
      trigger.channelId,
      lastSessionTime,
      Date.now(),
      useReaction ? undefined : { processedTs: state.processed?.[trigger.channelId] },
      trigger.cooldownMs,
    )
    if (!decision.process) {
      console.log(`[Slack Poller] Skipping message ${msg.ts}: ${decision.reason}`)
      continue
    }

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

    // Extract full message content (blocks + attachments, not just truncated text)
    const fullMessage = extractFullText(msg)
    console.log(`[Slack Poller] Processing message from ${author} (${fullMessage.length} chars): ${fullMessage.slice(0, 100)}...`)

    // Forward to C3 webhook. :eyes: is only added AFTER c3 confirms it handled
    // the message, so a dead/500-responding c3 cannot silently swallow one.
    // "Handled" is a started session, or, for a mirror-only channel, a message
    // successfully copied into Discord.
    let handled: string | undefined
    let failureReason: string | undefined

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
          message: fullMessage,
          author,
          messageTs: msg.ts,
        }),
      })

      if (!webhookRes.ok) {
        failureReason = `HTTP ${webhookRes.status} ${webhookRes.statusText}`
      } else {
        const result = await webhookRes.json() as {
          sessionId?: string
          mirrored?: boolean
          error?: string
        }
        if (result.sessionId) {
          handled = `session ${result.sessionId}`
        } else if (result.mirrored) {
          handled = 'mirrored to Discord'
        } else {
          failureReason = `c3 neither started a session nor mirrored (error: ${result.error || 'unknown'})`
        }
      }
    } catch (err) {
      failureReason = err instanceof Error ? err.message : String(err)
    }

    if (handled) {
      console.log(`[Slack Poller] Handled: ${handled}`)
      lastSessionTime.set(trigger.channelId, Date.now())
      // Only mark the Slack message as processed after c3 confirms it handled it.
      if (useReaction) {
        await markAsProcessed(token, trigger.channelId, msg.ts)
      } else {
        if (!state.processed) state.processed = {}
        state.processed[trigger.channelId] = markProcessed(
          state.processed[trigger.channelId],
          msg.ts,
        )
        saveState(state)
      }
    } else {
      console.error(
        `[Slack Poller] Webhook failed for ${trigger.name} msg ${msg.ts}: ${failureReason}.` +
        ` Not marking processed so it is visible as unhandled.`
      )
      // Do NOT mark as processed. lastTs has already advanced so we don't re-fetch;
      // on reaction channels the absent :eyes: flags the message for human
      // attention, and on reaction-free channels this error log is the signal.
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
  slackTriggers.forEach(t =>
    console.log(`  - #${t.name} (${t.channelId}) every ${(t.pollIntervalMs || 15000) / 1000}s`),
  )

  const state = loadState()

  // Initialize last seen timestamps to now if not set (don't process old messages)
  for (const trigger of slackTriggers) {
    if (!state.lastTs[trigger.channelId]) {
      // Set to current time so we only process NEW messages
      state.lastTs[trigger.channelId] = String(Date.now() / 1000)
      saveState(state)
    }
  }

  // Poll loop: each channel runs on its own pollIntervalMs timer, with
  // staggered start times so channels sharing a workspace token don't hit
  // the Slack API in one burst (that pattern got us ratelimited).
  const inFlight = new Set<string>()

  const pollOne = async (trigger: SlackTrigger) => {
    if (inFlight.has(trigger.channelId)) return
    inFlight.add(trigger.channelId)
    try {
      await pollChannel(trigger, state)
    } catch (err) {
      console.error(`[Slack Poller] Error polling ${trigger.name}:`, err)
    } finally {
      inFlight.delete(trigger.channelId)
    }
  }

  slackTriggers.forEach((trigger, i) => {
    const intervalMs = trigger.pollIntervalMs || 15000
    setTimeout(() => {
      void pollOne(trigger)
      setInterval(() => void pollOne(trigger), intervalMs)
    }, i * 2000)
  })
}

main().catch(err => {
  console.error('[Slack Poller] Fatal error:', err)
  process.exit(1)
})
