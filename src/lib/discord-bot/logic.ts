/**
 * Pure logic for the Discord gateway bot (discord-bot.ts), kept out of the
 * process script so it can be unit tested without discord.js or a socket.
 */

export interface DiscordEmbedField {
  name: string
  value: string
}

export interface DiscordEmbedLike {
  title?: string | null
  description?: string | null
  fields?: DiscordEmbedField[]
  footer?: { text?: string | null } | null
  image?: { url?: string | null } | null
  thumbnail?: { url?: string | null } | null
}

export interface DiscordAttachmentLike {
  name?: string | null
  url: string
  contentType?: string | null
}

export interface DiscordMessageLike {
  content: string
  embeds?: DiscordEmbedLike[]
  attachments?: DiscordAttachmentLike[]
  webhookId?: string | null
  authorIsBot?: boolean
}

export interface BotChannelTrigger {
  name: string
  channelId: string
  /** Which gateway process serves this trigger. Unset means the default bot. */
  bot?: string
  /** When set, only messages posted through this webhook fire the trigger. */
  webhookId?: string
  /** When true, the bot opens a thread on the message and the session replies there. */
  thread?: boolean
}

export const DEFAULT_BOT_NAME = 'default'

/**
 * The triggers a given gateway process is responsible for. Two processes
 * running with different bot tokens must never both answer the same channel,
 * so each trigger names its bot and each process filters on its own name.
 */
export function selectTriggersForBot<T extends BotChannelTrigger>(
  triggers: Record<string, T>,
  botName: string,
): T[] {
  return Object.values(triggers).filter(t => (t.bot ?? DEFAULT_BOT_NAME) === botName)
}

/**
 * Whether a message in a watched channel should start a session. Webhook
 * posts are allowed (alert summarisers, in-app reporters), other bots are
 * not, and a trigger pinned to one webhook ignores every human message in
 * the channel, so people can talk next to the reports without paying for a
 * session each time.
 */
export function shouldFire(trigger: BotChannelTrigger, msg: DiscordMessageLike): boolean {
  if (msg.authorIsBot && !msg.webhookId) return false
  if (trigger.webhookId) return msg.webhookId === trigger.webhookId
  return true
}

/**
 * Everything the message carries, as one block of text for the prompt. The
 * gateway only forwarded `content` before, and a report posted as an embed has
 * an empty content: the agent received nothing and investigated nothing.
 */
export function extractDiscordText(msg: DiscordMessageLike): string {
  const parts: string[] = []
  if (msg.content?.trim()) parts.push(msg.content.trim())

  for (const embed of msg.embeds ?? []) {
    const lines: string[] = []
    if (embed.title) lines.push(`**${embed.title}**`)
    if (embed.description) lines.push(embed.description)
    for (const f of embed.fields ?? []) lines.push(`${f.name}: ${f.value}`)
    if (embed.footer?.text) lines.push(`Footer: ${embed.footer.text}`)
    const image = embed.image?.url || embed.thumbnail?.url
    if (image) lines.push(`Image: ${image}`)
    if (lines.length) parts.push(lines.join('\n'))
  }

  const attachments = (msg.attachments ?? []).map(a =>
    `Attachment: ${a.name || 'file'} ${a.url}${a.contentType ? ` (${a.contentType})` : ''}`,
  )
  if (attachments.length) parts.push(attachments.join('\n'))

  return parts.join('\n\n')
}

const THREAD_NAME_LIMIT = 100

/**
 * A thread name a human can scan in the channel's thread list: the embed
 * title plus its first short field (the reporter's screen, say), or the first
 * line of the message. Discord caps names at 100 characters.
 */
export function threadNameFor(msg: DiscordMessageLike, fallback = 'Report'): string {
  const embed = msg.embeds?.[0]
  let name = ''
  if (embed?.title) {
    name = embed.title
    const field = embed.fields?.find(f => f.value && f.value.length <= 40)
    if (field) name += ` · ${field.value}`
  } else if (msg.content?.trim()) {
    name = msg.content.trim().split('\n')[0]
  } else if (embed?.description) {
    name = embed.description.split('\n')[0]
  }
  name = name.replace(/\s+/g, ' ').trim() || fallback
  return name.length > THREAD_NAME_LIMIT ? name.slice(0, THREAD_NAME_LIMIT - 1) + '…' : name
}

export interface SessionResultLike {
  sessionId: string
  summary: string
  projectPath?: string
  failed?: boolean
  failureReason?: string
}

/** The completion message the bot posts when the server did not post one itself. */
export function formatSessionResult(result: SessionResultLike, baseUrl: string): string {
  const short = result.sessionId.slice(0, 8)
  const resume = result.projectPath
    ? ['Resume in terminal:', '```', `cd ${result.projectPath} && claude --resume ${result.sessionId} --dangerously-skip-permissions`, '```']
    : []
  if (result.failed) {
    const reason = result.failureReason || 'unknown'
    return [
      `:warning: **Agent session failed** (\`${short}\`)`,
      '',
      `**Reason:** ${reason.length > 1500 ? reason.slice(0, 1500) + '...' : reason}`,
      '',
      `Take over: ${baseUrl}/sessions/${result.sessionId}`,
      ...resume,
    ].join('\n')
  }
  const summary = result.summary.length > 1800 ? result.summary.slice(0, 1800) + '...' : result.summary
  return [
    `**Session completed** (\`${short}\`)`,
    '',
    summary,
    '',
    `View full session: ${baseUrl}/sessions/${result.sessionId}`,
    ...resume,
  ].join('\n')
}
