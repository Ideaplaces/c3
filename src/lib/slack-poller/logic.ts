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
}

export const PROCESSED_REACTION = 'eyes'
export const COOLDOWN_MS = 5 * 60 * 1000

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
 * Check if the channel is in cooldown (rate limited).
 * Returns remaining cooldown in ms, or 0 if not rate limited.
 */
export function checkCooldown(
  channelId: string,
  lastSessionTimes: Map<string, number>,
  now: number = Date.now()
): number {
  const lastTime = lastSessionTimes.get(channelId) || 0
  const elapsed = now - lastTime
  if (elapsed < COOLDOWN_MS) {
    return COOLDOWN_MS - elapsed
  }
  return 0
}

/**
 * Determine if a message should be processed.
 * Returns { process: true } or { process: false, reason: string }.
 */
export function shouldProcessMessage(
  message: SlackMessage,
  channelId: string,
  lastSessionTimes: Map<string, number>,
  now: number = Date.now()
): { process: boolean; reason?: string } {
  // Check 👀 reaction
  if (hasProcessedReaction(message)) {
    return { process: false, reason: 'already_processed' }
  }

  // Check cooldown
  const cooldownRemaining = checkCooldown(channelId, lastSessionTimes, now)
  if (cooldownRemaining > 0) {
    return { process: false, reason: `rate_limited_${Math.round(cooldownRemaining / 1000)}s` }
  }

  return { process: true }
}
