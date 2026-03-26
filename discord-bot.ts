import { Client, GatewayIntentBits, TextChannel } from 'discord.js'
import fs from 'fs'
import path from 'path'
import http from 'http'

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
interface ChannelTrigger {
  name: string
  channelId: string
  prompt: string
  projectPath: string
  permissionMode: string
  model: string
}

interface TriggersConfig {
  channels: Record<string, ChannelTrigger>
}

function loadTriggers(): TriggersConfig {
  const triggersPath = path.join(process.cwd(), 'triggers.json')
  try {
    return JSON.parse(fs.readFileSync(triggersPath, 'utf-8'))
  } catch {
    console.error('[Bot] Failed to load triggers.json')
    return { channels: {} }
  }
}

const CCC_URL = process.env.CCC_URL || 'http://localhost:8347'
const CCC_WEBHOOK_SECRET = process.env.CCC_WEBHOOK_SECRET || ''
const BOT_PORT = parseInt(process.env.BOT_PORT || '8348', 10)

// Track message IDs to reply to when session completes
const pendingSessions = new Map<string, { channelId: string; messageId: string }>()

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
})

client.on('ready', () => {
  const triggers = loadTriggers()
  const channelIds = Object.values(triggers.channels).map(t => t.channelId)
  console.log(`[Bot] Logged in as ${client.user?.tag}`)
  console.log(`[Bot] Watching ${channelIds.length} channels: ${channelIds.join(', ')}`)
})

client.on('messageCreate', async (msg) => {
  // Ignore bot messages
  if (msg.author.bot) return

  const triggers = loadTriggers()
  const watchedChannels = new Set(Object.values(triggers.channels).map(t => t.channelId))

  // Only process messages from configured channels
  if (!watchedChannels.has(msg.channelId)) return

  console.log(`[Bot] Message in ${msg.channelId} from ${msg.author.username}: ${msg.content.slice(0, 100)}`)

  // React with eyes to show we're processing
  try {
    await msg.react('👀')
  } catch {
    // Ignore reaction errors
  }

  try {
    const response = await fetch(`${CCC_URL}/api/webhooks/discord`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CCC_WEBHOOK_SECRET}`,
      },
      body: JSON.stringify({
        channelId: msg.channelId,
        message: msg.content,
        author: msg.author.username,
        messageId: msg.id,
        callbackUrl: `http://localhost:${BOT_PORT}/callback`,
      }),
    })

    const data = await response.json() as { sessionId?: string; trigger?: string; error?: string }

    if (response.ok && data.sessionId) {
      // Track this session so we can reply when it completes
      pendingSessions.set(data.sessionId, {
        channelId: msg.channelId,
        messageId: msg.id,
      })

      console.log(`[Bot] Session started: ${data.sessionId} for trigger "${data.trigger}"`)
    } else {
      console.error(`[Bot] Webhook failed:`, data.error)
      try {
        await msg.react('❌')
      } catch {
        // Ignore
      }
    }
  } catch (err) {
    console.error(`[Bot] Error calling CCC webhook:`, err)
    try {
      await msg.react('❌')
    } catch {
      // Ignore
    }
  }
})

// HTTP server to receive session completion callbacks from CCC
const callbackServer = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/callback') {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', async () => {
      try {
        const data = JSON.parse(body) as { sessionId: string; reason: string; summary: string }
        const pending = pendingSessions.get(data.sessionId)

        if (pending) {
          pendingSessions.delete(data.sessionId)

          const channel = client.channels.cache.get(pending.channelId) as TextChannel | undefined
          if (channel) {
            // Truncate summary for Discord (2000 char limit)
            const truncatedSummary = data.summary.length > 1800
              ? data.summary.slice(0, 1800) + '...'
              : data.summary

            const baseUrl = process.env.CCC_PUBLIC_URL || CCC_URL
            const replyContent = [
              `**Session completed** (\`${data.sessionId.slice(0, 8)}\`)`,
              '',
              truncatedSummary,
              '',
              `View full session: ${baseUrl}/sessions/${data.sessionId}`,
            ].join('\n')

            try {
              // Reply to the original message
              const originalMessage = await channel.messages.fetch(pending.messageId)
              await originalMessage.reply(replyContent)
              console.log(`[Bot] Replied to message ${pending.messageId} with session result`)
            } catch {
              // If we can't reply to the message, post in the channel
              await channel.send(replyContent)
              console.log(`[Bot] Posted session result in channel ${pending.channelId}`)
            }
          }
        }
      } catch (err) {
        console.error(`[Bot] Callback error:`, err)
      }

      res.writeHead(200)
      res.end('ok')
    })
  } else {
    res.writeHead(404)
    res.end('not found')
  }
})

callbackServer.listen(BOT_PORT, () => {
  console.log(`[Bot] Callback server listening on port ${BOT_PORT}`)
})

// Login
const token = process.env.DISCORD_BOT_TOKEN
if (!token) {
  console.error('[Bot] DISCORD_BOT_TOKEN not set')
  process.exit(1)
}
client.login(token)
