import fs from 'fs'
import path from 'path'
import { chipAsks, runFailed } from './report-asks'

/**
 * Which Claude session a Discord or Slack thread belongs to. A thread is one
 * conversation, so it is one session: the first message in the thread starts
 * it, every reply resumes it (Chip, 2026-10-14: "a thread is linked with a
 * Claude Code session, and everything is on top of that same session").
 *
 * Kept on disk next to the triggers, so a restart of the server or the bot
 * does not break a conversation that is still going. Expired home links retain
 * the original session ID so a late reply can be pointed back to it.
 */
export interface ThreadLink {
  sessionId: string
  trigger: string
  linkedAt: string
  slackReplies?: Record<string, { sessionId: string; status: 'started' | 'resumed' }>
  discordReplies?: Record<string, 'pending' | 'resumed'>
}

const MAX_AGE_MS = 30 * 86_400_000

export function isThreadLinkExpired(link: ThreadLink, now = new Date()): boolean {
  return !(Date.parse(link.linkedAt) >= now.getTime() - MAX_AGE_MS)
}

export function isHomeThreadLabel(label: string | undefined): label is `cron:${string}` | `slack:${string}` {
  return Boolean(label && /^(cron|slack):.+$/.test(label))
}

export function threadsFile(): string {
  if (process.env.C3_DISCORD_THREADS_FILE) return process.env.C3_DISCORD_THREADS_FILE
  const base = process.env.C3_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.c3')
  return path.join(base, 'state', 'discord-threads.json')
}

function read(file: string, failOnError = false): Record<string, ThreadLink> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (err) {
    if (failOnError && (err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    return {}
  }
}

export function sessionForThread(threadId: string, file = threadsFile()): ThreadLink | null {
  const links = read(file)
  return Object.hasOwn(links, threadId) ? links[threadId] : null
}

export function linkThread(threadId: string, sessionId: string, trigger: string, now = new Date(), file = threadsFile()): void {
  saveLink(threadId, { sessionId, trigger, linkedAt: now.toISOString() }, now, file)
}

export function recordSlackThreadReply(
  threadId: string, trigger: string, ts: string, accepted: { sessionId: string; status: 'started' | 'resumed' }, previous: ThreadLink | null,
): void {
  const now = new Date()
  saveLink(threadId, {
    sessionId: accepted.sessionId, trigger, linkedAt: now.toISOString(),
    slackReplies: { ...(previous?.trigger === trigger ? previous.slackReplies : {}), [ts]: accepted },
  }, now, threadsFile())
}

export function recordHomeThreadReply(
  threadId: string, link: ThreadLink, messageId: string, status?: 'pending' | 'resumed',
): void {
  const discordReplies = { ...link.discordReplies }
  if (status) discordReplies[messageId] = status
  else delete discordReplies[messageId]
  saveLink(threadId, { ...link, discordReplies }, new Date(), threadsFile())
}

function saveLink(threadId: string, link: ThreadLink, now: Date, file: string): void {
  const links = Object.entries(read(file, true)).flatMap(([id, existing]) => {
    if (!isThreadLinkExpired(existing, now)) return [[id, existing]]
    if (!isHomeThreadLabel(existing.trigger)) return []
    const { sessionId, trigger, linkedAt } = existing
    return [[id, { sessionId, trigger, linkedAt }]]
  })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries([...links, [threadId, link]]), null, 1) + '\n')
  fs.renameSync(tmp, file)
}

/** The turn a resumed session receives: only the new message, since it already has the rest. */
export function followUpPrompt(author: string, message: string, platform: 'Discord' | 'Slack' = 'Discord'): string {
  return [
    `${author} replied in the ${platform} thread:`,
    '',
    '<message>',
    message.trim(),
    '</message>',
    '',
    'Answer this message. Your final message is posted in the thread for them: the answer first,',
    platform === 'Discord'
      ? 'short. Do not post to Discord yourself, and do not start new work they did not ask for.'
      : 'short. Let C3 deliver it. Keep session URLs out of your answer and stay within the request.',
  ].join('\n')
}

/**
 * Archive quiet reports in webhook threads. Asks, failed runs, and threads
 * that a person started stay open. A reply in an archived thread reopens it.
 */
export function shouldArchiveThread(opts: { webhookTrigger: boolean; failed: boolean; summary: string }): boolean {
  return opts.webhookTrigger && !opts.failed && chipAsks(opts.summary).length === 0 && !runFailed(opts.summary)
}

/** Archiving is tidying: a failure is logged and never thrown, the report has already landed. */
export async function archiveThread(token: string, threadId: string): Promise<boolean> {
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${threadId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    })
    if (!res.ok) console.error(`[Webhook] Archiving thread ${threadId} failed: ${res.status}`)
    return res.ok
  } catch (err) {
    console.error(`[Webhook] Archiving thread ${threadId} failed:`, err)
    return false
  }
}
