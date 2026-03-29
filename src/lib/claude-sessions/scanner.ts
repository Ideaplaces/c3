import { readdirSync, readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join, basename } from 'path'
import { homedir } from 'os'

const CLAUDE_PROJECTS_DIR = join(homedir(), '.claude', 'projects')

export interface ClaudeSessionEntry {
  sessionId: string
  fullPath: string
  fileMtime: number
  firstPrompt: string
  lastPrompt: string
  messageCount: number
  created: string
  modified: string
  gitBranch: string
  projectPath: string
  isSidechain: boolean
}

interface SessionsIndex {
  version: number
  entries: ClaudeSessionEntry[]
}

// Cache for scan results (refreshed every 10 seconds)
let cachedEntries: ClaudeSessionEntry[] | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 10_000

export function clearCache() {
  cachedEntries = null
  cacheTimestamp = 0
}

/**
 * Read the first ~4KB of a file to extract metadata without loading the whole thing.
 * This is fast even for multi-MB JSONL files.
 */
function readFileHead(filePath: string, maxBytes = 4096): string {
  try {
    const fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(maxBytes)
    const bytesRead = readSync(fd, buffer, 0, maxBytes, 0)
    closeSync(fd)
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return ''
  }
}

/**
 * Read the last ~16KB of a file to find the last user prompt.
 */
function readFileTail(filePath: string, maxBytes = 16384): string {
  try {
    const size = statSync(filePath).size
    if (size === 0) return ''
    const start = Math.max(0, size - maxBytes)
    const length = size - start
    const fd = openSync(filePath, 'r')
    const buffer = Buffer.alloc(length)
    const bytesRead = readSync(fd, buffer, 0, length, start)
    closeSync(fd)
    return buffer.toString('utf-8', 0, bytesRead)
  } catch {
    return ''
  }
}

/**
 * Extract the text content from a user message's content field.
 */
function extractUserText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const textBlock = content.find((b: { type?: string }) => b.type === 'text')
    if (textBlock?.text) return textBlock.text
  }
  return ''
}

/**
 * Find the last external user prompt from the tail of a JSONL file.
 * Skips tool_result messages (those are automated responses, not user prompts).
 */
function extractLastPrompt(filePath: string): string {
  const tail = readFileTail(filePath)
  if (!tail) return ''
  const lines = tail.split('\n').filter(Boolean)
  // Walk backwards to find the last real user message (not a tool_result)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed.type === 'user' && parsed.userType === 'external') {
        const text = extractUserText(parsed.message?.content)
        if (text) return text
        // Empty text means tool_result only, keep searching
      }
    } catch {
      // Skip partial lines
    }
  }
  return ''
}

/**
 * Extract basic metadata from the first few lines of a JSONL file.
 */
function extractFromJSONL(filePath: string, sessionId: string, dirName: string): ClaudeSessionEntry | null {
  try {
    const stat = statSync(filePath)
    const head = readFileHead(filePath)
    if (!head) return null

    const lines = head.split('\n').filter(Boolean)

    let firstPrompt = ''
    let projectPath = ''
    let created = ''
    let gitBranch = ''
    let isSidechain = false

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (parsed.type === 'file-history-snapshot' || parsed.type === 'queue-operation') continue
        if (parsed.type === 'progress') continue

        if (!projectPath && parsed.cwd) projectPath = parsed.cwd
        if (!gitBranch && parsed.gitBranch) gitBranch = parsed.gitBranch
        if (!created && parsed.timestamp) created = parsed.timestamp
        if (parsed.isSidechain) isSidechain = true

        if (!firstPrompt && parsed.type === 'user' && parsed.userType === 'external') {
          const content = parsed.message?.content
          if (typeof content === 'string') {
            firstPrompt = content
          } else if (Array.isArray(content)) {
            const textBlock = content.find((b: { type: string }) => b.type === 'text')
            if (textBlock?.text) firstPrompt = textBlock.text
          }
        }

        if (firstPrompt && projectPath) break
      } catch {
        // Partial JSON line at the end of the buffer, skip
      }
    }

    if (!firstPrompt && !projectPath) return null

    const lastPrompt = extractLastPrompt(filePath)

    return {
      sessionId,
      fullPath: filePath,
      fileMtime: stat.mtimeMs,
      firstPrompt: firstPrompt || '(no prompt)',
      lastPrompt: lastPrompt || firstPrompt || '(no prompt)',
      messageCount: 0,
      created: created || stat.birthtime.toISOString(),
      modified: new Date(stat.mtimeMs).toISOString(),
      gitBranch: gitBranch || '',
      projectPath: projectPath || decodeProjectDir(dirName),
      isSidechain,
    }
  } catch {
    return null
  }
}

/**
 * Scan all sessions across ~/.claude/projects/.
 * Reads sessions-index.json where available, and discovers
 * JSONL files not in any index by reading their first few KB.
 * Results are cached for 10 seconds.
 */
export function scanAllSessions(): ClaudeSessionEntry[] {
  const now = Date.now()
  if (cachedEntries && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedEntries
  }

  if (!existsSync(CLAUDE_PROJECTS_DIR)) return []

  const allEntries: ClaudeSessionEntry[] = []
  const indexedIds = new Set<string>()

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR)

    // Pass 1: Read all sessions-index.json files
    for (const dir of projectDirs) {
      const indexPath = join(CLAUDE_PROJECTS_DIR, dir, 'sessions-index.json')
      if (!existsSync(indexPath)) continue

      try {
        const raw = readFileSync(indexPath, 'utf-8')
        const index: SessionsIndex = JSON.parse(raw)
        if (index.entries) {
          for (const entry of index.entries) {
            if (!entry.isSidechain) {
              allEntries.push(entry)
              indexedIds.add(entry.sessionId)
            }
          }
        }
      } catch {
        // Skip corrupted index files
      }
    }

    // Pass 2: Find JSONL files not in any index
    for (const dir of projectDirs) {
      const dirPath = join(CLAUDE_PROJECTS_DIR, dir)
      try {
        const files = readdirSync(dirPath)
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue
          const sessionId = file.replace('.jsonl', '')
          if (indexedIds.has(sessionId)) continue

          const entry = extractFromJSONL(join(dirPath, file), sessionId, dir)
          if (entry && !entry.isSidechain) {
            allEntries.push(entry)
          }
        }
      } catch {
        // Skip dirs we can't read
      }
    }
  } catch {
    // Can't read projects dir
  }

  // Sort by modified date, most recent first
  const sorted = allEntries.sort((a, b) =>
    new Date(b.modified).getTime() - new Date(a.modified).getTime()
  )

  cachedEntries = sorted
  cacheTimestamp = now

  return sorted
}

/**
 * Find a specific session by ID across all project directories.
 */
export function findSession(sessionId: string): ClaudeSessionEntry | undefined {
  const all = scanAllSessions()
  return all.find((e) => e.sessionId === sessionId)
}

/**
 * Decode the project directory name back to a path.
 * e.g. "-home-user-my-project" -> "/home/user/my-project"
 */
export function decodeProjectDir(dirName: string): string {
  return dirName.replace(/-/g, '/')
}

/**
 * Get the JSONL file path for a session.
 * Searches across all project directories.
 */
export function getSessionJSONLPath(sessionId: string): string | null {
  if (!existsSync(CLAUDE_PROJECTS_DIR)) return null

  try {
    const projectDirs = readdirSync(CLAUDE_PROJECTS_DIR)
    for (const dir of projectDirs) {
      const jsonlPath = join(CLAUDE_PROJECTS_DIR, dir, `${sessionId}.jsonl`)
      if (existsSync(jsonlPath)) return jsonlPath
    }
  } catch {
    // ignore
  }

  return null
}

/**
 * Convert a ClaudeSessionEntry to the SessionMeta format CCC uses.
 */
export function entryToSessionMeta(entry: ClaudeSessionEntry) {
  return {
    id: entry.sessionId,
    projectPath: entry.projectPath,
    projectName: basename(entry.projectPath),
    machineName: '',
    status: 'completed' as const,
    permissionMode: '',
    model: '',
    createdAt: entry.created,
    updatedAt: entry.modified,
    turnCount: entry.messageCount,
    totalCostUsd: 0,
    firstPrompt: entry.firstPrompt,
    lastPrompt: entry.lastPrompt || entry.firstPrompt,
  }
}
