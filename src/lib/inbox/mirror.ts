import crypto from 'crypto'
import { askKey, chipAsks, runFailed } from './asks'
import { formatInboxLine } from './format'
import { getItem, inboxFile, openItemFor, saveItem } from './store'
import type { InboxConfig } from './config'

/**
 * Copy a post that needs Chip into #needs-chip (Chip, 2026-10-24: "a single one ... kind of
 * like my inbox, but it still points to the other ones"). The post stays in its home channel;
 * the inbox gets one line linking to it and a thread on that line. The thread is linked to the
 * session that asked, so Chip's reply there resumes it (src/app/api/webhooks/discord/route.ts).
 *
 * The source message id is the idempotency key: the item is recorded as `posting` before the
 * Discord write, and the write carries a nonce derived from the same key, so a retry after a
 * lost answer finds the item and Discord drops the second copy.
 */

export interface MirrorInput {
  /** The channel the post is in, or the parent channel when it is in a thread. */
  sourceChannelId: string
  sourceMessageId: string
  /** The thread the post is in, when it is in one: the jump link goes through it. */
  sourceThreadId?: string
  text: string
  agent?: string
  sessionId?: string
}

export interface MirrorDeps {
  post(channelId: string, content: string, nonce: string): Promise<string | null>
  openThread(channelId: string, messageId: string, name: string): Promise<boolean>
  channelName(channelId: string): Promise<string>
  link(threadId: string, sessionId: string, trigger: string): void
  now(): Date
  file?: string
}

export type MirrorResult =
  | { status: 'posted'; inboxMessageId: string }
  | { status: 'duplicate'; inboxMessageId?: string }
  | { status: 'no-ask' }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string }

/** Discord accepts a nonce of at most 25 characters. */
export function nonceFor(key: string): string {
  return 'nc' + crypto.createHash('sha1').update(key).digest('hex').slice(0, 22)
}

export async function mirrorToInbox(input: MirrorInput, config: InboxConfig | null, deps: MirrorDeps): Promise<MirrorResult> {
  if (!config) return { status: 'skipped', reason: 'no inbox configured' }
  if (input.sourceChannelId === config.channelId) return { status: 'skipped', reason: 'already in the inbox' }
  if (config.skipChannelIds.includes(input.sourceChannelId)) return { status: 'skipped', reason: 'channel Chip reads directly' }

  const asks = chipAsks(input.text)
  const failed = asks.length ? null : runFailed(input.text)
  if (!asks.length && !failed) return { status: 'no-ask' }

  const file = deps.file ?? inboxFile()
  const now = deps.now()
  const sourceKey = input.sourceMessageId
  const existing = getItem(sourceKey, file)
  if (existing && existing.status !== 'posting') return { status: 'duplicate', inboxMessageId: existing.inboxMessageId }

  const channelName = await deps.channelName(input.sourceChannelId)
  const jumpUrl = `https://discord.com/channels/${config.guildId}/${input.sourceThreadId ?? input.sourceChannelId}/${input.sourceMessageId}`
  const askKeys = failed ? [`${input.agent ?? channelName}:run-failed`] : asks.map(askKey)
  const base = { sourceKey, askKeys, channelName, agent: input.agent, sessionId: input.sessionId, createdAt: existing?.createdAt ?? now.toISOString() }

  const open = existing ? null : openItemFor(askKeys, now, file)
  if (open) {
    // Asked again: one note in the open item's thread, none when the same session repeats itself
    // (a superfan's own post and its completion summary carry the same ask).
    if (open.sessionId !== input.sessionId || !input.sessionId) {
      await deps.post(open.inboxMessageId!, `${failed ? 'Failed' : 'Asked'} again in #${channelName}${input.agent ? ` by ${input.agent}` : ''}: <${jumpUrl}>`, nonceFor(`${sourceKey}:repeat`))
    }
    saveItem({ ...base, status: 'repeat', inboxMessageId: open.inboxMessageId }, now, file)
    return { status: 'duplicate', inboxMessageId: open.inboxMessageId }
  }

  saveItem({ ...base, status: 'posting' }, now, file)
  const line = formatInboxLine({ channelName, agent: input.agent, asks, failed, jumpUrl })
  const id = await deps.post(config.channelId, line, nonceFor(sourceKey))
  if (!id) return { status: 'failed', reason: 'Discord refused the inbox line' }

  const threadName = `${channelName}: ${failed ? 'run failed' : asks[0]}`.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').slice(0, 100)
  if (!(await deps.openThread(config.channelId, id, threadName))) {
    console.error(`[Inbox] Could not open a thread on ${id}; Chip's reply there will start a fresh session`)
  }
  if (input.sessionId) deps.link(id, input.sessionId, config.trigger)
  saveItem({ ...base, status: 'open', inboxMessageId: id }, now, file)
  return { status: 'posted', inboxMessageId: id }
}
