import { ensureToolPath } from './src/lib/env-path.js'
ensureToolPath()
import { Client, GatewayIntentBits, TextChannel, ThreadAutoArchiveDuration, type Message, type ThreadChannel } from 'discord.js'
import fs from 'fs'
import path from 'path'
import http from 'http'
import {
  DEFAULT_BOT_NAME,
  selectTriggersForBot,
  shouldFire,
  shouldFireMention,
  stripMention,
  composeMentionText,
  extractDiscordText,
  threadNameFor,
  formatSessionResult,
  routeMessage,
  composeThreadText,
  threadBusy,
  BUSY_NOTE,
  type BotChannelTrigger,
  type DiscordMessageLike,
} from './src/lib/discord-bot/logic.js'

// Load .env.local manually (no dotenv dependency)
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
  // .env.local not found, rely on environment variables
}

// Load triggers config to know which channels to watch
interface ChannelTrigger extends BotChannelTrigger {
  prompt: string
  projectPath: string
  permissionMode: string
  model: string
}

interface TriggersConfig {
  channels: Record<string, ChannelTrigger>
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
  const triggersPath = findTriggersJson()
  try {
    return JSON.parse(fs.readFileSync(triggersPath, 'utf-8'))
  } catch {
    console.error(`[Bot] Failed to load ${triggersPath}`)
    return { channels: {} }
  }
}

// Which identity this process is. The default bot serves every trigger with
// no `bot` field; a named one (C3_DISCORD_BOT=spotter) serves only the
// triggers that name it, with the token in the env var named by
// C3_DISCORD_BOT_TOKEN_ENV. See ecosystem.config.cjs.
const BOT_NAME = process.env.C3_DISCORD_BOT || DEFAULT_BOT_NAME
const TOKEN_ENV = process.env.C3_DISCORD_BOT_TOKEN_ENV || 'DISCORD_BOT_TOKEN'

/** The triggers this process serves, read fresh so an edit to triggers.json needs no restart. */
function myTriggers(): ChannelTrigger[] {
  return selectTriggersForBot(loadTriggers().channels, BOT_NAME)
}

const CCC_URL = process.env.CCC_URL || 'http://localhost:8347'
const CCC_WEBHOOK_SECRET = process.env.CCC_WEBHOOK_SECRET || ''
const BOT_PORT = parseInt(process.env.BOT_PORT || '8348', 10)
const BASE_URL = process.env.C3_BASE_URL || CCC_URL

// Where to post when a session completes: the thread the bot opened, or the
// channel as a reply to the triggering message.
interface PendingSession {
  channelId: string
  messageId: string
  threadId?: string
  startedAt: number
}
const pendingSessions = new Map<string, PendingSession>()

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

client.on('ready', () => {
  const triggers = myTriggers()
  console.log(`[Bot] Logged in as ${client.user?.tag} (bot "${BOT_NAME}", triggers from ${findTriggersJson()})`)
  console.log(`[Bot] Watching ${triggers.length} channels: ${triggers.map(t => `${t.name}=${t.channelId}`).join(', ')}`)
})

function toLike(msg: Message): DiscordMessageLike {
  return {
    content: msg.content,
    embeds: msg.embeds.map(e => e.toJSON()),
    attachments: [...msg.attachments.values()].map(a => ({ name: a.name, url: a.url, contentType: a.contentType })),
    webhookId: msg.webhookId,
    authorIsBot: msg.author.bot,
    mentionsBot: client.user ? msg.mentions.users.has(client.user.id) : false,
    referencedMessageId: msg.reference?.messageId ?? null,
  }
}

async function react(msg: Message, emoji: string) {
  try {
    await msg.react(emoji)
  } catch {
    // Reactions are a courtesy; a missing permission must not stop the session.
  }
}

/**
 * Start a session for one message. Shared by the gateway listener and the
 * /replay endpoint, so a report that arrived before the bot was watching (or
 * while it was down) goes through exactly the path a live one does.
 */
async function handleMessage(msg: Message, source: 'gateway' | 'replay') {
  const trigger = myTriggers().find(t => t.channelId === msg.channelId)
  if (!trigger) return { started: false, reason: 'channel not served by this bot' }

  const like = toLike(msg)
  let text: string
  // The message the session is about and the one that gets the thread: the
  // triggering message itself, or, for a mention trigger, the report the
  // person replied to.
  let subject: Message = msg
  if (trigger.mention) {
    const referenced = like.referencedMessageId
      ? await msg.channel.messages.fetch(like.referencedMessageId).catch(() => null)
      : null
    if (!shouldFireMention(trigger, like, referenced ? toLike(referenced) : null)) {
      return { started: false, reason: 'not a reply that mentions the bot on a matching message' }
    }
    subject = referenced as Message
    const request = stripMention(msg.content, client.user?.id ?? '')
    text = composeMentionText(toLike(subject), msg.author.username, request)
  } else {
    if (!shouldFire(trigger, like)) return { started: false, reason: 'message does not match the trigger' }
    text = extractDiscordText(like)
  }
  console.log(`[Bot] ${source} message ${msg.id} in ${trigger.name} from ${msg.author.username}: ${text.slice(0, 100).replace(/\n/g, ' ')}`)

  await react(msg, '👀')

  let threadId: string | undefined
  let threadCreated = false
  if (trigger.thread) {
    try {
      const existing = subject.thread ?? (subject.hasThread ? await subject.channel.messages.fetch(subject.id).then(m => m.thread) : null)
      const thread = existing ?? await subject.startThread({
        name: threadNameFor(toLike(subject)),
        autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
      })
      threadId = thread.id
      threadCreated = !existing
    } catch (err) {
      console.error(`[Bot] Could not open a thread on ${subject.id}, replying in channel instead:`, err)
    }
  }

  return startSession(msg, trigger, text, subject.id, threadId, true, undefined, threadCreated)
}

/**
 * Hand one message to the server and remember where the answer goes. `msg` is
 * what gets the eyes or the cross; `subjectId` and `threadId` are where the
 * answer is posted.
 */
async function startSession(msg: Message, trigger: BotChannelTrigger, text: string, subjectId: string, threadId: string | undefined, announce: boolean, followUp?: string, threadCreated = false) {
  try {
    const response = await fetch(`${CCC_URL}/api/webhooks/discord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CCC_WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        channelId: trigger.channelId,
        message: text,
        author: msg.author.username,
        messageId: subjectId,
        threadId,
        threadCreated,
        followUp,
        callbackUrl: `http://localhost:${BOT_PORT}/callback`,
      }),
    })

    const data = await response.json() as { sessionId?: string; trigger?: string; error?: string }

    if (response.status === 409 && threadId) {
      // The thread's session is still answering the previous message.
      const thread = await client.channels.fetch(threadId).catch(() => null)
      if (thread?.isThread()) await thread.send(BUSY_NOTE).catch(() => {})
      return { started: false, reason: 'thread session busy' }
    }
    if (response.ok && data.sessionId) {
      pendingSessions.set(data.sessionId, { channelId: trigger.channelId, messageId: subjectId, threadId, startedAt: Date.now() })
      console.log(`[Bot] Session started: ${data.sessionId} for trigger "${data.trigger}"`)
      if (threadId && announce) {
        const thread = await client.channels.fetch(threadId).catch(() => null)
        if (thread?.isThread()) {
          await thread.send(`On it. Session: ${BASE_URL}/sessions/${data.sessionId}`).catch(() => {})
        }
      }
      return { started: true, sessionId: data.sessionId, threadId }
    }
    console.error(`[Bot] Webhook failed:`, data.error)
    await react(msg, '❌')
    return { started: false, reason: data.error || `HTTP ${response.status}` }
  } catch (err) {
    console.error(`[Bot] Error calling CCC webhook:`, err)
    await react(msg, '❌')
    return { started: false, reason: String(err) }
  }
}

// Threads whose follow-up is between "reply received" and "session registered":
// set before the first await, so two quick replies cannot both start a session.
const startingThreads = new Set<string>()

/**
 * A person replying inside a thread under a thread trigger: the same agent answers
 * in the same thread, with the conversation so far, instead of the reply being
 * ignored because a thread is not the trigger's channel. One session per thread at
 * a time: a second one could not see the first one's answer.
 */
async function handleThreadReply(msg: Message, trigger: BotChannelTrigger) {
  if (!msg.channel.isThread()) return
  const thread = msg.channel
  if (startingThreads.has(thread.id) || threadBusy(pendingSessions.values(), thread.id, Date.now())) {
    await thread.send(BUSY_NOTE).catch(() => {})
    return
  }
  startingThreads.add(thread.id)
  try {
    return await startThreadReply(msg, thread, trigger)
  } finally {
    startingThreads.delete(thread.id)
  }
}

async function startThreadReply(msg: Message, thread: ThreadChannel, trigger: BotChannelTrigger) {
  const starter = await thread.fetchStarterMessage().catch((err) => {
    console.warn(`[Bot] No starter message for thread ${thread.id}, answering without it:`, err?.message ?? err)
    return null
  })
  const recent = await thread.messages.fetch({ limit: 30 }).catch(() => null)
  const asLine = (m: Message) => ({ author: m.author.username, isBot: m.author.bot, content: extractDiscordText(toLike(m)) })
  const replies = [...(recent?.values() ?? [])]
    .filter(m => m.id !== msg.id && m.id !== starter?.id && !m.system)
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp)
    .map(asLine)
  const text = composeThreadText(starter ? asLine(starter) : null, replies, msg.author.username, extractDiscordText(toLike(msg)))
  console.log(`[Bot] thread reply ${msg.id} in ${trigger.name}/${thread.id} from ${msg.author.username}: ${msg.content.slice(0, 100).replace(/\n/g, ' ')}`)
  await react(msg, '👀')
  // `text` carries the whole thread for a new session; `followUp` is the new message
  // alone, which the server uses to resume the thread's own session when it has one.
  return startSession(msg, trigger, text, msg.id, thread.id, false, extractDiscordText(toLike(msg)))
}

client.on('messageCreate', async (msg) => {
  const route = routeMessage(myTriggers(), {
    channelId: msg.channelId,
    parentId: msg.channel.isThread() ? msg.channel.parentId : null,
    isThread: msg.channel.isThread(),
    isSelf: msg.author.id === client.user?.id,
    isSystem: msg.system,
    authorIsBot: msg.author.bot,
  })
  if (route.kind === 'channel') await handleMessage(msg, 'gateway')
  else if (route.kind === 'thread') await handleThreadReply(msg, route.trigger)
})

function readJsonBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
  })
}

// Post the completion notice where the session was announced. The server
// already posts one itself when it has a token for this bot (`replied: true`
// in the payload); this path covers the case where it does not.
async function onSessionCallback(body: string) {
  const data = JSON.parse(body) as {
    sessionId: string; reason: string; summary: string; projectPath?: string
    failed?: boolean; failureReason?: string; replied?: boolean
  }
  const pending = pendingSessions.get(data.sessionId)
  if (!pending) return
  pendingSessions.delete(data.sessionId)
  if (data.replied) return

  const content = formatSessionResult(data, BASE_URL)
  const target = await client.channels.fetch(pending.threadId ?? pending.channelId).catch(() => null)
  if (!target || !('send' in target)) return
  if (pending.threadId) {
    await (target as TextChannel).send(content)
    console.log(`[Bot] Posted session result in thread ${pending.threadId}`)
    return
  }
  try {
    const originalMessage = await (target as TextChannel).messages.fetch(pending.messageId)
    await originalMessage.reply(content)
    console.log(`[Bot] Replied to message ${pending.messageId} with session result`)
  } catch {
    await (target as TextChannel).send(content)
    console.log(`[Bot] Posted session result in channel ${pending.channelId}`)
  }
}

// Run an existing message through the same path as a live one. Used to
// backfill a channel's history and to retry a report the bot missed.
async function onReplay(body: string) {
  const { channelId, messageId } = JSON.parse(body) as { channelId: string; messageId: string }
  const channel = await client.channels.fetch(channelId)
  if (!channel || !channel.isTextBased()) throw new Error(`channel ${channelId} is not a text channel`)
  const msg = await (channel as TextChannel).messages.fetch(messageId)
  return handleMessage(msg, 'replay')
}

// HTTP server: session completion callbacks from C3, and replays.
const callbackServer = http.createServer(async (req, res) => {
  if (req.method !== 'POST' || (req.url !== '/callback' && req.url !== '/replay')) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const body = await readJsonBody(req)
  try {
    if (req.url === '/callback') {
      await onSessionCallback(body)
      res.writeHead(200)
      res.end('ok')
      return
    }
    const auth = req.headers.authorization
    if (!CCC_WEBHOOK_SECRET || auth !== `Bearer ${CCC_WEBHOOK_SECRET}`) {
      res.writeHead(401)
      res.end('unauthorized')
      return
    }
    const result = await onReplay(body)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result))
  } catch (err) {
    console.error(`[Bot] ${req.url} error:`, err)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: String(err) }))
  }
})

callbackServer.listen(BOT_PORT, () => {
  console.log(`[Bot] Callback server listening on port ${BOT_PORT}`)
})

// Login
const token = process.env[TOKEN_ENV]
if (!token) {
  console.error(`[Bot] ${TOKEN_ENV} not set`)
  process.exit(1)
}
client.login(token)
