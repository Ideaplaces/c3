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
  /** Whether this bot's user is @mentioned in the message. */
  mentionsBot?: boolean
  /** The message this one replies to, when it is a reply. */
  referencedMessageId?: string | null
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
  /**
   * When true, nothing fires on its own. A person replies to a message with
   * an @mention of the bot, and that replied-to message becomes the subject
   * of the session, with the person's words as the request. `webhookId` then
   * applies to the subject, not to the reply.
   */
  mention?: boolean
}

/**
 * Whether a reply that @mentions the bot should start a session on the
 * message it replies to. The mention is the human's decision to spend a
 * session; a mention with no reply has no subject and is ignored.
 */
export function shouldFireMention(
  trigger: BotChannelTrigger,
  reply: DiscordMessageLike,
  subject: DiscordMessageLike | null,
): boolean {
  if (!trigger.mention) return false
  if (reply.authorIsBot || !reply.mentionsBot || !reply.referencedMessageId) return false
  if (!subject) return false
  if (trigger.webhookId) return subject.webhookId === trigger.webhookId
  return true
}

/** The mention of the bot removed, so the request reads as the person wrote it. */
export function stripMention(content: string, botUserId: string): string {
  return content.replace(new RegExp(`<@!?${botUserId}>`, 'g'), '').replace(/\s+/g, ' ').trim()
}

/** The session text for a mention: the subject in full, then what the person asked. */
export function composeMentionText(subject: DiscordMessageLike, author: string, request: string): string {
  const ask = request || 'Take care of this one.'
  return `${extractDiscordText(subject)}\n\nRequest from ${author}: ${ask}`
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

export interface IncomingLike {
  channelId: string
  /** The parent channel when the message was posted inside a thread. */
  parentId?: string | null
  isThread: boolean
  isSelf: boolean
  isSystem: boolean
  authorIsBot: boolean
}

export type Route<T> = { kind: 'channel'; trigger: T } | { kind: 'thread'; trigger: T } | { kind: 'ignore' }

/**
 * Where one gateway message goes. A message in a trigger's channel (or in a thread
 * that is itself a trigger) takes the normal path. A person replying inside a
 * thread under a `thread: true` trigger is talking to the same agent, so it starts
 * a follow-up session there (Chip, 2026-10-14, on the superfan channels: "it should
 * be a thread with a subsection", the way Slack threads work). Never for bots, the
 * bot itself, Discord's system messages, mention triggers, or a trigger pinned to a
 * webhook: its threads are where people talk next to an app's reports for free.
 */
export function routeMessage<T extends BotChannelTrigger>(triggers: T[], msg: IncomingLike): Route<T> {
  if (msg.isSelf || msg.isSystem) return { kind: 'ignore' }
  const own = triggers.find(t => t.channelId === msg.channelId)
  if (own) return { kind: 'channel', trigger: own }
  if (!msg.isThread || msg.authorIsBot || !msg.parentId) return { kind: 'ignore' }
  const parent = triggers.find(t => t.channelId === msg.parentId)
  if (!parent || !parent.thread || parent.mention || parent.webhookId) return { kind: 'ignore' }
  return { kind: 'thread', trigger: parent }
}

/** How long a thread waits on an unanswered session before taking the next reply anyway. */
export const THREAD_BUSY_TTL_MS = 60 * 60 * 1000

export const BUSY_NOTE = 'Still working on the previous message. Send this again once I have answered.'

/**
 * Whether a thread already has a session working for it. An entry older than the
 * TTL is treated as lost: a server restart drops the completion callback, and the
 * thread must not stay locked until the bot restarts.
 */
export function threadBusy(entries: Iterable<{ threadId?: string; startedAt: number }>, threadId: string, now: number, ttlMs = THREAD_BUSY_TTL_MS): boolean {
  for (const e of entries) if (e.threadId === threadId && now - e.startedAt < ttlMs) return true
  return false
}

export interface ThreadLine {
  author: string
  isBot: boolean
  content: string
}

/**
 * What a bot line in the thread contributed to the conversation: the answer, not
 * the "On it" line, the session link or the resume command around it.
 */
export function agentAnswer(content: string): string | null {
  const text = content.trim()
  if (/^On it\. Session: /.test(text) || text === BUSY_NOTE) return null
  if (/^:warning: \*\*Agent session failed\*\*/.test(text)) return '(that run failed before answering)'
  const done = text.match(/^\*\*Session completed\*\*[^\n]*([\s\S]*?)(?:\s*View full session:[\s\S]*)?$/)
  return done ? done[1].trim() || null : text
}

export function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, Math.max(0, max - 1)) + '…' : text
}

/**
 * A follow-up in a thread as one block for the prompt: the opening message, the
 * replies so far oldest first, then the new message. Each session starts fresh, so
 * without the history a second question ("and last month?") has nothing to refer
 * to. The result never exceeds maxChars: the new message keeps up to 60% of it and
 * the opening up to 20%, then the oldest replies go first.
 */
export function composeThreadText(opening: ThreadLine | null, replies: ThreadLine[], author: string, request: string, maxChars = 6000): string {
  const line = (l: ThreadLine) => {
    const content = l.isBot ? agentAnswer(l.content) : l.content.trim()
    return content ? `${l.isBot ? 'Agent' : l.author}: ${content}` : null
  }
  const head = 'Conversation so far in this thread, oldest first:'
  const gap = '(earlier messages left out)'
  // The fixed text (header, gap marker, blank lines) comes off the top, so the cap holds at any size.
  const room = Math.max(0, maxChars - head.length - gap.length - 4 * 2)
  const ask = clip(`New message from ${author} in this thread: ${request.trim()}`, Math.floor(room * 0.6))
  const openingMax = Math.floor(room * 0.2)
  const first = opening ? line(opening) : null
  const rest = replies.map(line).filter((l): l is string => l !== null)
  if (!first && !rest.length) return ask
  const build = (kept: string[]) =>
    [head, ...(first ? [clip(first, openingMax)] : []), ...(kept.length < rest.length ? [gap] : []), ...kept, ask].join('\n\n')
  let kept = rest
  while (kept.length && build(kept).length > maxChars) kept = kept.slice(1)
  return build(kept)
}
