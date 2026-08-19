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

export interface MirrorHeaderOptions {
  channelName: string
  author: string
  message: string
  sessionId: string
  sessionUrl: string
  permalink?: string
}

/** The copy of the Slack alert that lands in Discord, with a live session link. */
export function formatAlertMirror(opts: MirrorHeaderOptions): string {
  const lines = [`**#${opts.channelName}** · ${opts.author}`]
  if (opts.permalink) lines.push(`<${opts.permalink}>`)
  lines.push('', opts.message.trim(), '')
  lines.push(`_Investigating…_ \`${opts.sessionId.slice(0, 8)}\` · <${opts.sessionUrl}>`)
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

/**
 * Post content across as many messages as Discord's limit requires.
 * Returns the ID of the FIRST message, which is what replies should reference.
 * Returns null if the first message could not be posted at all.
 */
export async function postDiscordChunked(
  botToken: string,
  channelId: string,
  content: string,
  replyToMessageId?: string,
): Promise<string | null> {
  const chunks = chunkDiscordContent(content)
  if (chunks.length === 0) return null

  let firstId: string | null = null
  for (let i = 0; i < chunks.length; i++) {
    // Only the first message carries the reply pointer; the rest follow it.
    const id = await postDiscordMessage(
      botToken,
      channelId,
      chunks[i],
      i === 0 ? replyToMessageId : undefined,
    )
    if (i === 0) {
      if (!id) return null
      firstId = id
    }
  }
  return firstId
}
