import { ensureToolPath } from './src/lib/env-path.js'
import fs from 'fs'
import path from 'path'
import type { SlackTrigger } from './src/lib/triggers/config.js'
import { resolveSlackToken } from './src/lib/webhooks/resolve-slack-token.js'
import { forwardToC3, getMessageAuthor, hasBeenProcessed, markAsProcessed, slackConversationPage } from './src/lib/slack-poller/client.js'
import { pollSlackThreads } from './src/lib/slack-poller/threads.js'
import { filterCandidates, shouldProcessMessage, extractFullText, isProcessed, markProcessed } from './src/lib/slack-poller/logic.js'

function loadLocalEnv() {
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
      if (!process.env[key]) process.env[key] = value
    }
  } catch {
    // rely on environment
  }
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

// Track last seen message per channel
const STATE_FILE = path.join(process.env.HOME || '/tmp', '.ccc', 'data', 'slack-poller-state.json')

interface PollerState {
  lastTs: Record<string, string>
  // Processed message timestamps per channel, for triggers running with
  // noReaction: true (no 👀 marker to read back from Slack).
  processed?: Record<string, string[]>
  lastReplySeen?: Record<string, Record<string, string>>
}

function loadState(): PollerState {
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as PollerState
    return { lastTs: parsed.lastTs || {}, processed: parsed.processed || {}, lastReplySeen: parsed.lastReplySeen || {} }
  } catch {
    return { lastTs: {}, processed: {} }
  }
}

function saveState(state: PollerState) {
  const dir = path.dirname(STATE_FILE)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

// Rate limiting state (in-memory, resets on restart)
const lastSessionTime = new Map<string, number>()

export async function pollChannel(trigger: SlackTrigger, state: PollerState, persist = saveState) {
  const token = resolveSlackToken(trigger.slackBotToken)
  if (!token) {
    console.error(`[Slack Poller] No token for ${trigger.name}`)
    return
  }

  if (trigger.threadsOnly) {
    state.lastReplySeen ??= {}
    const lastReplySeen = state.lastReplySeen[trigger.channelId] ??= {}
    if (await pollSlackThreads(trigger, token, lastReplySeen)) persist(state)
    return
  }

  // Reaction-free triggers dedup off the local ledger instead of the 👀 marker.
  const useReaction = trigger.noReaction !== true

  const oldest = state.lastTs[trigger.channelId] || ''
  const data = await slackConversationPage(token, 'history', {
    channel: trigger.channelId, limit: '10', ...(oldest ? { oldest } : {}),
  })

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
    persist(state)

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

    const author = await getMessageAuthor(token, msg.user)

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
      const webhookRes = await forwardToC3({
        channelId: trigger.channelId, channelName: trigger.name, message: fullMessage, author, messageTs: msg.ts,
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
        persist(state)
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
  ensureToolPath()
  loadLocalEnv()
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
    if (!trigger.threadsOnly && !state.lastTs[trigger.channelId]) {
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

async function run() {
  try {
    await main()
  } catch (err) {
    console.error('[Slack Poller] Fatal error:', err)
    process.exit(1)
  }
}

if (typeof require !== 'undefined' && require.main === module) void run()
