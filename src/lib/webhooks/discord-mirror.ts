/**
 * Mirror a Slack alert into a Discord channel and answer it there.
 *
 * The Eli alert channels are shared with the whole team, so C3 must not write
 * into them: no thread reply, no reaction. The findings used to go to a Slack
 * DM, which loses the per-channel grouping. Instead every watched Slack channel
 * has a twin Discord channel. The alert is copied there, and the agent's
 * investigation is posted as an inline reply to that copy, so the alert and its
 * answer sit together in the channel that matches the alert's own source.
 *
 * Discord caps a message at 2000 characters, so anything long is split across
 * several messages. The reply always references the FIRST mirrored message, the
 * one carrying the header, so the pointer lands on the alert itself.
 */

export const DISCORD_CONTENT_LIMIT = 2000

/** Leaves room for the fence bookkeeping added when a split lands mid code block. */
const DEFAULT_CHUNK_LIMIT = 1900

const FENCE = '```'

/**
 * Split content into Discord-sized messages on line boundaries.
 *
 * A split that lands inside a fenced code block closes the fence on the way out
 * and reopens it on the way in, otherwise the second half renders as prose and
 * every subsequent block in the message is inverted.
 */
export function chunkDiscordContent(text: string, limit = DEFAULT_CHUNK_LIMIT): string[] {
  if (limit <= 0) throw new Error('chunkDiscordContent: limit must be positive')
  if (!text) return []
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let current = ''
  // Fence state at the end of `current`. When true, closing the chunk here
  // requires a closing fence, and the next chunk must reopen one.
  let inFence = false

  const fits = (candidate: string) =>
    candidate.length + (inFence ? FENCE.length + 1 : 0) <= limit

  const closeChunk = () => {
    chunks.push(inFence ? `${current}\n${FENCE}` : current)
  }

  for (const rawLine of text.split('\n')) {
    // A line longer than the whole budget cannot be placed on a boundary, so
    // break it at the character level rather than emitting an oversized message.
    const pieces =
      rawLine.length > limit - FENCE.length - 1
        ? hardSplit(rawLine, limit - FENCE.length - 1)
        : [rawLine]

    for (const line of pieces) {
      const candidate = current ? `${current}\n${line}` : line
      if (current && !fits(candidate)) {
        closeChunk()
        current = inFence ? `${FENCE}\n${line}` : line
      } else {
        current = candidate
      }
      if (line.trimStart().startsWith(FENCE)) inFence = !inFence
    }
  }

  if (current.trim() && current.trim() !== FENCE) closeChunk()

  return chunks
}

function hardSplit(line: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < line.length; i += size) out.push(line.slice(i, i + size))
  return out
}

/**
 * Rewrite Slack mrkdwn as Discord markdown.
 *
 * The two dialects overlap enough to look interchangeable and are not. Slack
 * bold is `*one asterisk*`, which Discord renders as literal asterisks, and
 * Slack links are `<url|label>`, which Discord renders raw. A mirrored alert
 * full of stray asterisks is the difference between a channel you read and one
 * you skim past.
 *
 * Code spans are left exactly as they are: an alert quotes log lines verbatim,
 * and "fixing" the punctuation inside one would misreport the evidence.
 */
export function slackMarkdownToDiscord(text: string): string {
  const converted = mapOutsideCodeSpans(text, segment =>
    segment
      // <url|label> and <url>. Do links before emphasis so a label containing
      // an asterisk is not mangled mid-rewrite.
      .replace(/<(https?:\/\/[^|>\s]+)\|([^>]+)>/g, '[$2]($1)')
      // *bold* -> **bold**, only when the asterisks hug the text and stand
      // alone, so multiplication and glob patterns survive.
      .replace(/(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])/g, '**$1**')
      // ~strike~ -> ~~strike~~
      .replace(/(?<![~\w])~(?!\s)([^~\n]+?)(?<!\s)~(?![~\w])/g, '~~$1~~'),
  )

  return dropSlackArtifacts(converted)
}

/** Apply a transform to everything except fenced blocks and inline code. */
function mapOutsideCodeSpans(text: string, fn: (segment: string) => string): string {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts.map((part, i) => (i % 2 === 1 ? part : fn(part))).join('')
}

/**
 * Strip the residue of reading a Slack message through the API: attachments
 * with no text render as "[no preview available]", and a bot that sets both
 * `text` and a header block repeats its own title on the next line.
 */
function dropSlackArtifacts(text: string): string {
  // The repeated title is usually not character-identical: the bot puts the
  // plain string in `text` and an emoji-prefixed copy in its header block.
  const withoutDecoration = (line: string) => line.trim().replace(/^(?::[a-z0-9_+-]+:\s*)+/i, '')

  const out: string[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '[no preview available]') continue
    const previous = out[out.length - 1]
    if (
      previous !== undefined &&
      line.trim() &&
      withoutDecoration(line) === withoutDecoration(previous)
    ) {
      continue
    }
    out.push(line)
  }
  return out.join('\n').trim()
}

export interface MirrorHeaderOptions {
  channelName: string
  author: string
  message: string
  permalink?: string
  /** Omitted on a mirror-only channel, where no session runs. */
  sessionId?: string
  sessionUrl?: string
}

/**
 * The copy of the Slack alert that lands in Discord. It carries a live session
 * link when an investigation is starting, and nothing when the channel is
 * mirror-only, so the message never promises an answer that is not coming.
 */
export function formatAlertMirror(opts: MirrorHeaderOptions): string {
  const lines = [`**#${opts.channelName}** · ${opts.author}`]
  if (opts.permalink) lines.push(`<${opts.permalink}>`)
  lines.push('', slackMarkdownToDiscord(opts.message))
  if (opts.sessionId && opts.sessionUrl) {
    lines.push('', `_Investigating…_ \`${opts.sessionId.slice(0, 8)}\` · <${opts.sessionUrl}>`)
  }
  return lines.join('\n')
}

export interface InvestigationReplyOptions {
  failed: boolean
  /** The agent's report, or the failure reason when `failed` is true. */
  body: string
  sessionId: string
  sessionUrl: string
  resumeCommand: string
}

/** The agent's answer, posted as an inline reply to the mirrored alert. */
export function formatInvestigationReply(opts: InvestigationReplyOptions): string {
  const short = opts.sessionId.slice(0, 8)
  const head = opts.failed
    ? [`⚠️ **Agent session failed** (\`${short}\`)`, '', `**Reason:** ${opts.body.trim()}`]
    : [`**Investigation complete** (\`${short}\`)`, '', opts.body.trim()]

  return [
    ...head,
    '',
    `Session: <${opts.sessionUrl}>`,
    'Resume:',
    FENCE,
    opts.resumeCommand,
    FENCE,
  ].join('\n')
}

/**
 * The log line for a report that reached Discord. `outcome` describes the
 * INVESTIGATED session, not this post, which succeeded. It must not spell any
 * word in the `\b(error|exception|failed|fatal|unhandled|uncaught)\b` regex
 * that the c3 log shipper and the Azure alert summarizer both scan with: a
 * bare `failed=true` here made every successfully delivered failure report
 * raise a false production alert.
 */
export function formatReportPostedLog(opts: {
  channelId: string
  sessionId: string
  failed: boolean
}): string {
  return (
    `[Slack Webhook] Posted report to Discord ${opts.channelId} for ${opts.sessionId}` +
    ` (outcome=${opts.failed ? 'failure' : 'success'})`
  )
}

/**
 * Post one message. Returns its ID, or null when Discord refuses, so callers
 * can fall back rather than assume the report was delivered.
 */
export async function postDiscordMessage(
  botToken: string,
  channelId: string,
  content: string,
  replyToMessageId?: string,
): Promise<string | null> {
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bot ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        ...(replyToMessageId
          ? {
              message_reference: { message_id: replyToMessageId, fail_if_not_exists: false },
              allowed_mentions: { parse: [] },
            }
          : { allowed_mentions: { parse: [] } }),
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(
        `[Discord Mirror] POST to ${channelId} failed: HTTP ${res.status} ${detail.slice(0, 300)}`,
      )
      return null
    }
    const data = (await res.json()) as Record<string, unknown>
    return typeof data.id === 'string' ? data.id : null
  } catch (err) {
    console.error(`[Discord Mirror] POST to ${channelId} error:`, err)
    return null
  }
}

/** The seam that lets the chunk sequencing be tested without touching Discord. */
export type MessagePoster = (
  botToken: string,
  channelId: string,
  content: string,
  replyToMessageId?: string,
) => Promise<string | null>

/**
 * Post content across as many messages as Discord's limit requires, chaining
 * each one as a reply to the message before it. Without the chain the second
 * and later parts of a long report float free in the channel, detached from
 * the alert they answer.
 *
 * Returns the ID of the FIRST message, or null if that first message could not
 * be posted at all, so the caller can fall back instead of assuming delivery.
 */
export async function postDiscordChunked(
  botToken: string,
  channelId: string,
  content: string,
  replyToMessageId?: string,
  poster: MessagePoster = postDiscordMessage,
): Promise<string | null> {
  const chunks = chunkDiscordContent(content)
  if (chunks.length === 0) return null

  let firstId: string | null = null
  let previousId = replyToMessageId
  for (let i = 0; i < chunks.length; i++) {
    const id = await poster(botToken, channelId, chunks[i], previousId)
    if (i === 0) {
      if (!id) return null
      firstId = id
    }
    // A dropped continuation chunk must not re-point the chain at the alert.
    if (id) previousId = id
  }
  return firstId
}
