/**
 * Slack poller core logic - extracted for testability.
 * All functions are pure or take explicit dependencies (no globals, no side effects).
 */

export interface SlackMessage {
  text: string
  user?: string
  bot_id?: string
  ts: string
  thread_ts?: string
  subtype?: string
  reactions?: { name: string; users: string[] }[]
  blocks?: SlackBlock[]
  attachments?: SlackAttachment[]
}

interface SlackBlock {
  type: string
  text?: { type: string; text: string }
  elements?: { type: string; text?: string; elements?: { type: string; text?: string }[] }[]
  fields?: { type: string; text: string }[]
}

interface SlackAttachment {
  text?: string
  fallback?: string
  title?: string
  fields?: { title: string; value: string }[]
}

/**
 * Extract the full message text from a Slack message.
 * Slack puts rich content in blocks/attachments, not just the text field.
 * The text field is often a truncated summary.
 */
export function extractFullText(msg: SlackMessage): string {
  const parts: string[] = []

  // Start with the text field
  if (msg.text?.trim()) {
    parts.push(msg.text.trim())
  }

  // Extract from blocks (Block Kit messages)
  if (msg.blocks && msg.blocks.length > 0) {
    const blockTexts: string[] = []
    for (const block of msg.blocks) {
      if (block.type === 'header' && block.text?.text) {
        blockTexts.push(block.text.text)
      } else if (block.type === 'section' && block.text?.text) {
        blockTexts.push(block.text.text)
      } else if (block.type === 'context' && block.elements) {
        for (const el of block.elements) {
          if (el.text) blockTexts.push(el.text)
        }
      } else if (block.type === 'rich_text' && block.elements) {
        for (const el of block.elements) {
          if (el.elements) {
            for (const sub of el.elements) {
              if (sub.type === 'text' && sub.text) blockTexts.push(sub.text)
            }
          }
        }
      }
    }
    // If blocks gave us more content than the text field, use blocks instead
    const blockContent = blockTexts.join('\n')
    if (blockContent.length > (msg.text?.length || 0)) {
      return blockContent
    }
  }

  // Extract from attachments
  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.text?.trim()) parts.push(att.text.trim())
      if (att.fields) {
        for (const field of att.fields) {
          parts.push(`${field.title}: ${field.value}`)
        }
      }
    }
  }

  return parts.join('\n').trim() || msg.text || ''
}

export const PROCESSED_REACTION = 'eyes'
export const COOLDOWN_MS = 5 * 60 * 1000

/** How many processed timestamps to retain per channel in the local ledger. */
export const MAX_PROCESSED_HISTORY = 200

/**
 * Filter messages to only those the poller should consider processing.
 * This is the first line of defense against loops.
 */
export function filterCandidates(messages: SlackMessage[], oldestTs: string): SlackMessage[] {
  return messages
    .filter(m => !m.subtype || m.subtype === 'bot_message')
    .filter(m => m.ts !== oldestTs)
    .filter(m => !m.thread_ts || m.thread_ts === m.ts) // only top-level
    .sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts))
}

/**
 * Check if a message has the 👀 reaction (already processed).
 */
export function hasProcessedReaction(message: SlackMessage): boolean {
  if (!message.reactions) return false
  return message.reactions.some(r => r.name === PROCESSED_REACTION)
}

/**
 * Local processed-message ledger, used by triggers that run with
 * `noReaction: true`. Those channels are shared with the team, where a 👀 on an
 * alert reads as "a human is handling this" when nobody is, so the poller must
 * not write to the channel at all. The ledger replaces the reaction as the
 * idempotency marker.
 */
export function isProcessed(processedTs: string[] | undefined, ts: string): boolean {
  if (!processedTs) return false
  return processedTs.includes(ts)
}

/**
 * Record a timestamp as processed, keeping only the newest
 * MAX_PROCESSED_HISTORY entries. Returns a new array; never mutates the input.
 */
export function markProcessed(
  processedTs: string[] | undefined,
  ts: string,
  max: number = MAX_PROCESSED_HISTORY,
): string[] {
  const existing = processedTs || []
  if (existing.includes(ts)) return existing
  return [...existing, ts]
    .sort((a, b) => parseFloat(a) - parseFloat(b))
    .slice(-max)
}

/**
 * Check if the channel is in cooldown (rate limited).
 * Returns remaining cooldown in ms, or 0 if not rate limited.
 */
export function checkCooldown(
  channelId: string,
  lastSessionTimes: Map<string, number>,
  now: number = Date.now(),
  cooldownMs: number = COOLDOWN_MS
): number {
  const lastTime = lastSessionTimes.get(channelId) || 0
  const elapsed = now - lastTime
  if (elapsed < cooldownMs) {
    return cooldownMs - elapsed
  }
  return 0
}

/**
 * Determine if a message should be processed.
 * Returns { process: true } or { process: false, reason: string }.
 *
 * Pass `dedup` for triggers that do not use the 👀 reaction: the local ledger
 * of processed timestamps then decides, instead of reactions on the message.
 *
 * `cooldownMs` is the per-channel minimum gap between two sessions. The
 * default suits alert channels, where a burst is one incident repeated. A
 * channel where every message is its own case (an NPS score, a support
 * ticket) sets it to 0, otherwise the second message of a burst is dropped
 * for good: the poller advances past it and never looks again.
 */
export function shouldProcessMessage(
  message: SlackMessage,
  channelId: string,
  lastSessionTimes: Map<string, number>,
  now: number = Date.now(),
  dedup?: { processedTs: string[] | undefined },
  cooldownMs: number = COOLDOWN_MS
): { process: boolean; reason?: string } {
  const alreadyProcessed = dedup
    ? isProcessed(dedup.processedTs, message.ts)
    : hasProcessedReaction(message)
  if (alreadyProcessed) {
    return { process: false, reason: 'already_processed' }
  }

  // Check cooldown
  const cooldownRemaining = checkCooldown(channelId, lastSessionTimes, now, cooldownMs)
  if (cooldownRemaining > 0) {
    return { process: false, reason: `rate_limited_${Math.round(cooldownRemaining / 1000)}s` }
  }

  return { process: true }
}
