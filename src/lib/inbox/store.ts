import fs from 'fs'
import path from 'path'

/**
 * The #needs-chip items, on disk next to the thread links (src/lib/webhooks/discord-threads.ts),
 * keyed by the message that asked. That key is the record of intent: an item is written as
 * `posting` before the Discord write and turned `open` after it, so a retry of the same source
 * post finds it and never posts a second line. Items older than MAX_AGE_DAYS are dropped on
 * write; an ask that old is asked again as a new line.
 */

export type InboxStatus = 'posting' | 'open' | 'answered' | 'repeat'

export interface InboxItem {
  sourceKey: string
  askKeys: string[]
  status: InboxStatus
  channelName: string
  createdAt: string
  inboxMessageId?: string
  sessionId?: string
  agent?: string
  answeredAt?: string
}

const MAX_AGE_DAYS = 14

export function inboxFile(): string {
  if (process.env.C3_INBOX_FILE) return process.env.C3_INBOX_FILE
  const base = process.env.C3_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.c3')
  return path.join(base, 'state', 'needs-chip.json')
}

function read(file: string): Record<string, InboxItem> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

function fresh(item: InboxItem, now: Date): boolean {
  return Date.parse(item.createdAt) >= now.getTime() - MAX_AGE_DAYS * 86_400_000
}

export function getItem(sourceKey: string, file = inboxFile()): InboxItem | null {
  return read(file)[sourceKey] ?? null
}

export function saveItem(item: InboxItem, now = new Date(), file = inboxFile()): void {
  const items = Object.fromEntries(Object.entries(read(file)).filter(([, i]) => fresh(i, now)))
  items[item.sourceKey] = item
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(items, null, 1) + '\n')
  fs.renameSync(tmp, file)
}

/**
 * The open item that already holds every one of these asks, or null. Only a post whose asks are
 * all open already is a repeat; one new ask among old ones makes it a new line.
 */
export function openItemFor(askKeys: string[], now = new Date(), file = inboxFile()): InboxItem | null {
  if (askKeys.length === 0) return null
  const open = Object.values(read(file)).filter(i => i.status === 'open' && i.inboxMessageId && fresh(i, now))
  const covered = askKeys.every(k => open.some(i => i.askKeys.includes(k)))
  if (!covered) return null
  return open.find(i => i.askKeys.includes(askKeys[0])) ?? null
}

/** Chip replied in the item's thread (its id is the inbox line's id). Returns whether one changed. */
export function markAnswered(threadId: string, now = new Date(), file = inboxFile()): boolean {
  const item = Object.values(read(file)).find(i => i.inboxMessageId === threadId)
  if (!item || item.status === 'answered') return false
  saveItem({ ...item, status: 'answered', answeredAt: now.toISOString() }, now, file)
  return true
}
