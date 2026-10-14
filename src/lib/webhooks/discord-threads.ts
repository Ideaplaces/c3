import fs from 'fs'
import path from 'path'

/**
 * Which Claude session a Discord thread belongs to. A thread is one
 * conversation, so it is one session: the first message in the thread starts
 * it, every reply resumes it (Chip, 2026-10-14: "a thread is linked with a
 * Claude Code session, and everything is on top of that same session").
 *
 * Kept on disk next to the triggers, so a restart of the server or the bot
 * does not break a conversation that is still going. Links older than
 * MAX_AGE_DAYS are dropped on write.
 */
export interface ThreadLink {
  sessionId: string
  trigger: string
  linkedAt: string
}

const MAX_AGE_DAYS = 30

export function threadsFile(): string {
  if (process.env.C3_DISCORD_THREADS_FILE) return process.env.C3_DISCORD_THREADS_FILE
  const base = process.env.C3_CONFIG_DIR || path.join(process.env.HOME || '/tmp', '.c3')
  return path.join(base, 'state', 'discord-threads.json')
}

function read(file: string): Record<string, ThreadLink> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return {}
  }
}

export function sessionForThread(threadId: string, file = threadsFile()): ThreadLink | null {
  return read(file)[threadId] ?? null
}

export function linkThread(threadId: string, sessionId: string, trigger: string, now = new Date(), file = threadsFile()): void {
  const cut = now.getTime() - MAX_AGE_DAYS * 86_400_000
  const links = Object.fromEntries(Object.entries(read(file)).filter(([, l]) => Date.parse(l.linkedAt) >= cut))
  links[threadId] = { sessionId, trigger, linkedAt: now.toISOString() }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(links, null, 1) + '\n')
  fs.renameSync(tmp, file)
}

/** The turn a resumed session receives: only the new message, since it already has the rest. */
export function followUpPrompt(author: string, message: string): string {
  return [
    `${author} replied in the Discord thread:`,
    '',
    '<message>',
    message.trim(),
    '</message>',
    '',
    'Answer this message. Your final message is posted in the thread for them: the answer first,',
    'short. Do not post to Discord yourself, and do not start new work they did not ask for.',
  ].join('\n')
}
