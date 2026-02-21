import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { SessionMeta } from './types'

const DATA_DIR = join(homedir(), '.ccc', 'data')
const SESSIONS_FILE = join(DATA_DIR, 'sessions.json')

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true })
  }
}

function readSessions(): SessionMeta[] {
  ensureDataDir()
  if (!existsSync(SESSIONS_FILE)) {
    return []
  }
  try {
    const raw = readFileSync(SESSIONS_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

function writeSessions(sessions: SessionMeta[]) {
  ensureDataDir()
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2))
}

export function getAllSessions(): SessionMeta[] {
  return readSessions().sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  )
}

export function getSession(id: string): SessionMeta | undefined {
  return readSessions().find((s) => s.id === id)
}

export function createSession(session: SessionMeta): SessionMeta {
  const sessions = readSessions()
  sessions.push(session)
  writeSessions(sessions)
  return session
}

export function updateSession(id: string, updates: Partial<SessionMeta>): SessionMeta | undefined {
  const sessions = readSessions()
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
  const sessions = readSessions()
  const filtered = sessions.filter((s) => s.id !== id)
  if (filtered.length === sessions.length) return false
  writeSessions(filtered)
  return true
}
