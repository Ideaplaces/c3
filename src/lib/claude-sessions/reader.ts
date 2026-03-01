import { readFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs'

export interface BufferedEvent {
  sessionId: string
  message: unknown
}

export interface PaginatedResult {
  events: BufferedEvent[]
  cursor: number
  hasMore: boolean
}

const CHUNK_SIZE = 256 * 1024 // 256KB

/**
 * Check if a parsed JSONL line is a displayable conversation message.
 */
function isDisplayable(parsed: { type?: string; subtype?: string }): boolean {
  const type = parsed.type
  if (type === 'user' || type === 'assistant' || type === 'result') return true
  if (type === 'system' && parsed.subtype) return true
  return false
}

/**
 * Convert a parsed JSONL line to a BufferedEvent.
 */
function toEvent(parsed: { sessionId?: string; [key: string]: unknown }): BufferedEvent {
  return { sessionId: parsed.sessionId as string || '', message: parsed }
}

/**
 * Read a raw chunk of bytes from a file at a given position.
 */
function readChunk(filePath: string, start: number, length: number): string {
  const fd = openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const bytesRead = readSync(fd, buffer, 0, length, start)
    return buffer.toString('utf-8', 0, bytesRead)
  } finally {
    closeSync(fd)
  }
}

/**
 * Parse a chunk of text into filtered displayable events.
 * Returns events in file order (oldest first).
 * Skips the first line if `skipFirst` is true (partial line at chunk start).
 */
function parseChunkLines(chunk: string, skipFirst: boolean): BufferedEvent[] {
  const lines = chunk.split('\n').filter(Boolean)
  const start = skipFirst ? 1 : 0
  const events: BufferedEvent[] = []
  for (let i = start; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i])
      if (isDisplayable(parsed)) {
        events.push(toEvent(parsed))
      }
    } catch {
      // Skip malformed lines (partial JSON at boundaries)
    }
  }
  return events
}

/**
 * Read the last N displayable messages from a JSONL file.
 * Returns events in chronological order (oldest first), a cursor for loading
 * earlier messages, and whether more messages exist before the cursor.
 */
export function readSessionTail(filePath: string, limit = 50): PaginatedResult {
  if (!existsSync(filePath)) return { events: [], cursor: 0, hasMore: false }

  try {
    const fileSize = statSync(filePath).size
    if (fileSize === 0) return { events: [], cursor: 0, hasMore: false }

    const collectedEvents: BufferedEvent[] = []
    let currentEnd = fileSize

    // Read chunks from the end, collecting displayable events until we have enough
    while (collectedEvents.length < limit && currentEnd > 0) {
      const chunkStart = Math.max(0, currentEnd - CHUNK_SIZE)
      const chunkLength = currentEnd - chunkStart
      const chunk = readChunk(filePath, chunkStart, chunkLength)

      // If we're not reading from the start of the file, skip the first
      // (likely partial) line since we probably landed mid-line
      const skipFirst = chunkStart > 0
      const chunkEvents = parseChunkLines(chunk, skipFirst)

      // Prepend to collected events (chunk events are in file order)
      collectedEvents.unshift(...chunkEvents)
      currentEnd = chunkStart
    }

    // If we collected more than the limit, trim from the front
    if (collectedEvents.length > limit) {
      const excess = collectedEvents.length - limit
      collectedEvents.splice(0, excess)
    }

    // Cursor is the byte offset where we stopped reading backwards.
    // If currentEnd > 0, there are more messages before this point.
    return {
      events: collectedEvents,
      cursor: currentEnd,
      hasMore: currentEnd > 0,
    }
  } catch {
    return { events: [], cursor: 0, hasMore: false }
  }
}

/**
 * Read displayable messages before the given cursor position.
 * Returns events in chronological order with an updated cursor.
 */
export function readSessionBefore(filePath: string, cursor: number, limit = 50): PaginatedResult {
  if (!existsSync(filePath) || cursor <= 0) {
    return { events: [], cursor: 0, hasMore: false }
  }

  try {
    const collectedEvents: BufferedEvent[] = []
    let currentEnd = cursor

    while (collectedEvents.length < limit && currentEnd > 0) {
      const chunkStart = Math.max(0, currentEnd - CHUNK_SIZE)
      const chunkLength = currentEnd - chunkStart
      const chunk = readChunk(filePath, chunkStart, chunkLength)

      const skipFirst = chunkStart > 0
      const chunkEvents = parseChunkLines(chunk, skipFirst)

      collectedEvents.unshift(...chunkEvents)
      currentEnd = chunkStart
    }

    if (collectedEvents.length > limit) {
      const excess = collectedEvents.length - limit
      collectedEvents.splice(0, excess)
    }

    return {
      events: collectedEvents,
      cursor: currentEnd,
      hasMore: currentEnd > 0,
    }
  } catch {
    return { events: [], cursor: 0, hasMore: false }
  }
}

/**
 * Read a Claude Code JSONL session file and convert to buffered events
 * compatible with CCC's WebSocket replay format.
 *
 * Filters out non-conversation lines (file-history-snapshot, queue-operation, progress)
 * and keeps user, assistant, and system messages.
 */
export function readSessionJSONL(filePath: string): BufferedEvent[] {
  if (!existsSync(filePath)) return []

  try {
    const raw = readFileSync(filePath, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    const events: BufferedEvent[] = []

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line)
        if (isDisplayable(parsed)) {
          events.push(toEvent(parsed))
        }
      } catch {
        // Skip malformed lines
      }
    }

    return events
  } catch {
    return []
  }
}
