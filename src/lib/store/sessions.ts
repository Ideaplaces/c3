import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SessionMeta } from './types'
import { scanAllSessions, entryToSessionMeta, findSession as findClaudeSession } from '@/lib/claude-sessions/scanner'

const DATA_DIR = join(homedir(), '.ccc', 'data')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

/**
 * Read CCC's own session metadata (for active/recently-started sessions).
 * This is a small overlay on top of Claude Code's native storage.
 */
// The overlay grows to hundreds of megabytes, so it is parsed again only when the file changed.
let cache: { mtimeMs: number; size: number; sessions: SessionMeta[] } | null = null

function readCCCSessions(): SessionMeta[] {
  ensureDataDir()
  if (!existsSync(SESSIONS_FILE)) {
    return []
  }
  try {
    const { mtimeMs, size } = statSync(SESSIONS_FILE)
    if (!cache || cache.mtimeMs !== mtimeMs || cache.size !== size) {
      cache = { mtimeMs, size, sessions: JSON.parse(readFileSync(SESSIONS_FILE, 'utf-8')) }
    }
    // A copy, so a caller's push or replace never reaches the cache before it is written
    return [...cache.sessions]
  } catch {
    return []
  }
}

function writeSessions(sessions: SessionMeta[]) {
  ensureDataDir()
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2))
  cache = null
}

/**
 * Get all sessions: merge Claude Code native sessions with CCC overlay data.
 * CCC sessions take priority (they have richer metadata like cost, model, status).
 */
export function getAllSessions(): SessionMeta[] {
  const cccSessions = readCCCSessions()
  const cccSessionIds = new Set(cccSessions.map((s) => s.id))

  // Get all Claude Code native sessions, excluding ones CCC already tracks
  const claudeSessions = scanAllSessions()
    .filter((entry) => !cccSessionIds.has(entry.sessionId))
    .map(entryToSessionMeta)

  const merged = [...cccSessions, ...claudeSessions]
  return merged.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

const PROMPT_PREVIEW_CHARS = 200

function preview(text: string): string {
  return text && text.length > PROMPT_PREVIEW_CHARS ? text.slice(0, PROMPT_PREVIEW_CHARS) : text
}

/**
 * The sessions list the page shows: newest first, at most `limit`, prompts cut
 * to a preview. `web` is only what was started from the page; `all` adds every
 * agent run and every native Claude Code session on the machine, which is tens
 * of thousands of rows, so it is never the default.
 */
export function listSessions({ scope, limit }: { scope: 'web' | 'all'; limit: number }): SessionMeta[] {
  const pool = scope === 'web'
    ? readCCCSessions().filter((s) => s.source === 'web')
    : getAllSessions()
  return pool
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit)
    .map((s) => ({ ...s, firstPrompt: preview(s.firstPrompt), lastPrompt: preview(s.lastPrompt) }))
}

/**
 * Get a specific session by ID. Checks CCC overlay first, then Claude Code native.
 */
export function getSession(id: string): SessionMeta | undefined {
  // Check CCC overlay first (has richer data)
  const cccSession = readCCCSessions().find((s) => s.id === id)
  if (cccSession) return cccSession

  // Fall back to Claude Code native storage
  const claudeEntry = findClaudeSession(id)
  if (claudeEntry) return entryToSessionMeta(claudeEntry)

  return undefined
}

export function createSession(session: SessionMeta): SessionMeta {
  const sessions = readCCCSessions()
  sessions.push(session)
  writeSessions(sessions)
  return session
}

export function updateSession(id: string, updates: Partial<SessionMeta>): SessionMeta | undefined {
  const sessions = readCCCSessions()
  const index = sessions.findIndex((s) => s.id === id)
  if (index === -1) return undefined

  sessions[index] = {
    ...sessions[index],
    ...updates,
    updatedAt: new Date().toISOString(),
  }
  writeSessions(sessions)
  return sessions[index]
}

export function deleteSession(id: string): boolean {
  const sessions = readCCCSessions()
  const filtered = sessions.filter((s) => s.id !== id)
  if (filtered.length === sessions.length) return false
  writeSessions(filtered)
  return true
}
