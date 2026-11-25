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
 * does not break a conversation that is still going. A report and a channel
 * conversation can share a Discord thread, with a separate session for each.
 */
interface ThreadSession {
  sessionId: string
  trigger: string
  linkedAt: string
}

export interface ThreadLink extends ThreadSession {
  discordChannel?: ThreadSession
  slackReplies?: Record<string, { sessionId: string; status: 'started' | 'resumed' }>
  discordReplies?: Record<string, 'pending' | 'resumed'>
}

const MAX_AGE_MS = 30 * 86_400_000
const HOME_RETENTION_MS = 60 * 86_400_000

export function isThreadLinkExpired(link: ThreadSession, now = new Date(), maxAgeMs = MAX_AGE_MS): boolean {
  return !(Date.parse(link.linkedAt) >= now.getTime() - maxAgeMs)
}

export function isHomeThreadLabel(label: string | undefined): label is `cron:${string}` | `slack:${string}` {
  return Boolean(label && /^(cron|slack):.+$/.test(label))
}

export function threadsFile(): string {
  if (process.env.C3_DISCORD_THREADS_FILE) return process.env.C3_DISCORD_THREADS_FILE
  const base = process.env.C3_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.c3')
  return path.join(base, 'state', 'discord-threads.json')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isThreadSession(value: unknown): value is ThreadSession & Record<string, unknown> {
  if (!isRecord(value)) return false
  const { sessionId, trigger, linkedAt } = value
  return isNonemptyString(sessionId) && isNonemptyString(trigger) &&
    typeof linkedAt === 'string' && Number.isFinite(Date.parse(linkedAt))
}

function isThreadLink(value: unknown): boolean {
  if (!isThreadSession(value)) return false
  const { discordChannel, discordReplies, slackReplies } = value
  if (discordChannel !== undefined && !isThreadSession(discordChannel)) return false
  if (discordReplies !== undefined && (!isRecord(discordReplies) ||
      !Object.values(discordReplies).every(status => status === 'pending' || status === 'resumed'))) return false
  return slackReplies === undefined || (isRecord(slackReplies) && Object.values(slackReplies).every(receipt =>
    isRecord(receipt) && isNonemptyString(receipt.sessionId) && (receipt.status === 'started' || receipt.status === 'resumed'),
  ))
}

function read(file: string): Record<string, ThreadLink> {
  let contents: string
  try {
    contents = fs.readFileSync(file, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  const links: unknown = JSON.parse(contents)
  if (!isRecord(links)) {
    throw new Error(`Invalid thread links in ${file}`)
  }
  if (!Object.values(links).every(isThreadLink)) {
    throw new Error(`Invalid thread link entry in ${file}`)
  }
  return links as Record<string, ThreadLink>
}

export function sessionForThread(threadId: string, file = threadsFile()): ThreadLink | null {
  const links = read(file)
  if (!Object.hasOwn(links, threadId)) return null
  const link = links[threadId]
  return isHomeThreadLabel(link.trigger) ? retainedHomeLink(link, new Date()) ?? null : link
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
  const links = new Map<string, ThreadLink>()
  for (const [id, existing] of Object.entries(read(file))) {
    if (existing.discordChannel && isThreadLinkExpired(existing.discordChannel, now)) delete existing.discordChannel
    const retained = isHomeThreadLabel(existing.trigger)
      ? retainedHomeLink(existing, now)
      : isThreadLinkExpired(existing, now) ? undefined : existing
    if (retained) links.set(id, retained)
  }

  const existing = links.get(threadId)
  if (existing && isHomeThreadLabel(existing.trigger)) {
    if (!isHomeThreadLabel(link.trigger)) {
      links.set(threadId, { ...existing, discordChannel: link })
    } else if (existing.sessionId === link.sessionId) {
      links.set(threadId, { ...link, discordChannel: existing.discordChannel })
    }
  } else {
    links.set(threadId, existing && isHomeThreadLabel(link.trigger) ? { ...link, discordChannel: existing } : link)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(links), null, 1) + '\n')
  fs.renameSync(tmp, file)
}

function retainedHomeLink(link: ThreadLink, now: Date): ThreadLink | undefined {
  if (isThreadLinkExpired(link, now, HOME_RETENTION_MS)) return link.discordChannel
  const { sessionId, trigger, linkedAt, discordChannel } = link
  if (isThreadLinkExpired(link, now)) return { sessionId, trigger, linkedAt, discordChannel }
  return link
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
