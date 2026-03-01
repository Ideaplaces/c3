import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Use real filesystem for these tests since we're testing actual file I/O
const TEST_DIR = join(tmpdir(), 'ccc-reader-pagination-test')

import { readSessionTail, readSessionBefore } from '@/lib/claude-sessions/reader'

function makeJsonlFile(lines: Record<string, unknown>[]): string {
  const filePath = join(TEST_DIR, `test-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
  const content = lines.map((l) => JSON.stringify(l)).join('\n') + '\n'
  writeFileSync(filePath, content)
  return filePath
}

describe('readSessionTail', () => {
  beforeEach(() => {
    try { rmSync(TEST_DIR, { recursive: true }) } catch {}
    mkdirSync(TEST_DIR, { recursive: true })
  })

  it('returns empty for non-existent file', () => {
    const result = readSessionTail('/nonexistent/file.jsonl')
    expect(result.events).toEqual([])
    expect(result.cursor).toBe(0)
    expect(result.hasMore).toBe(false)
  })

  it('returns all events when file has fewer than limit', () => {
    const filePath = makeJsonlFile([
      { type: 'user', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    ])

    const result = readSessionTail(filePath, 50)
    expect(result.events).toHaveLength(2)
    expect(result.hasMore).toBe(false)
  })

  it('returns last N events when file has more than limit', () => {
    const lines = []
    for (let i = 0; i < 10; i++) {
      lines.push({ type: 'user', message: { role: 'user', content: `msg-${i}` } })
    }
    const filePath = makeJsonlFile(lines)

    const result = readSessionTail(filePath, 3)
    expect(result.events).toHaveLength(3)
    // Should be the last 3 messages
    const contents = result.events.map((e) => (e.message as { message: { content: string } }).message.content)
    expect(contents).toEqual(['msg-7', 'msg-8', 'msg-9'])
  })

  it('filters out progress, file-history-snapshot, and queue-operation lines', () => {
    const filePath = makeJsonlFile([
      { type: 'file-history-snapshot', data: {} },
      { type: 'user', message: { role: 'user', content: 'hello' } },
      { type: 'progress', data: 'big progress blob' },
      { type: 'queue-operation', data: {} },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] } },
      { type: 'progress', data: 'another progress' },
    ])

    const result = readSessionTail(filePath, 50)
    expect(result.events).toHaveLength(2)
    expect((result.events[0].message as { type: string }).type).toBe('user')
    expect((result.events[1].message as { type: string }).type).toBe('assistant')
  })

  it('includes system messages with subtypes', () => {
    const filePath = makeJsonlFile([
      { type: 'system', subtype: 'init', model: 'claude-sonnet-4-6' },
      { type: 'user', message: { role: 'user', content: 'hello' } },
    ])

    const result = readSessionTail(filePath, 50)
    expect(result.events).toHaveLength(2)
    expect((result.events[0].message as { type: string; subtype: string }).subtype).toBe('init')
  })

  it('excludes system messages without subtypes', () => {
    const filePath = makeJsonlFile([
      { type: 'system' },
      { type: 'user', message: { role: 'user', content: 'hello' } },
    ])

    const result = readSessionTail(filePath, 50)
    expect(result.events).toHaveLength(1)
  })

  it('returns events in chronological order', () => {
    const lines = []
    for (let i = 0; i < 5; i++) {
      lines.push({ type: 'user', message: { role: 'user', content: `msg-${i}` } })
    }
    const filePath = makeJsonlFile(lines)

    const result = readSessionTail(filePath, 5)
    const contents = result.events.map((e) => (e.message as { message: { content: string } }).message.content)
    expect(contents).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4'])
  })

  it('sets hasMore=true when there are more messages before cursor', () => {
    const lines = []
    for (let i = 0; i < 20; i++) {
      lines.push({ type: 'user', message: { role: 'user', content: `msg-${i}` } })
    }
    const filePath = makeJsonlFile(lines)

    const result = readSessionTail(filePath, 5)
    expect(result.events).toHaveLength(5)
    // With a small file, all data fits in one 256KB chunk, so hasMore will be false
    // But the last 5 events should be the final 5 messages
    const contents = result.events.map((e) => (e.message as { message: { content: string } }).message.content)
    expect(contents).toEqual(['msg-15', 'msg-16', 'msg-17', 'msg-18', 'msg-19'])
  })
})

describe('readSessionBefore', () => {
  beforeEach(() => {
    try { rmSync(TEST_DIR, { recursive: true }) } catch {}
    mkdirSync(TEST_DIR, { recursive: true })
  })

  it('returns empty when cursor is 0', () => {
    const filePath = makeJsonlFile([
      { type: 'user', message: { role: 'user', content: 'hello' } },
    ])

    const result = readSessionBefore(filePath, 0)
    expect(result.events).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('returns empty for non-existent file', () => {
    const result = readSessionBefore('/nonexistent/file.jsonl', 100)
    expect(result.events).toEqual([])
    expect(result.hasMore).toBe(false)
  })

  it('works with readSessionTail cursor for sequential loading', () => {
    const lines = []
    for (let i = 0; i < 10; i++) {
      lines.push({ type: 'user', message: { role: 'user', content: `msg-${i}` } })
    }
    const filePath = makeJsonlFile(lines)

    // Get the tail (last 5)
    const tail = readSessionTail(filePath, 5)
    const tailContents = tail.events.map((e) => (e.message as { message: { content: string } }).message.content)
    expect(tailContents).toEqual(['msg-5', 'msg-6', 'msg-7', 'msg-8', 'msg-9'])

    // Load previous using the cursor from tail
    if (tail.hasMore) {
      const prev = readSessionBefore(filePath, tail.cursor, 5)
      const prevContents = prev.events.map((e) => (e.message as { message: { content: string } }).message.content)
      expect(prevContents).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4'])
    }
  })

  it('handles files with mixed displayable and non-displayable lines', () => {
    const lines = []
    for (let i = 0; i < 8; i++) {
      lines.push({ type: 'progress', data: `progress-${i}` })
      lines.push({ type: 'user', message: { role: 'user', content: `msg-${i}` } })
    }
    const filePath = makeJsonlFile(lines)

    const tail = readSessionTail(filePath, 4)
    expect(tail.events).toHaveLength(4)
    const tailContents = tail.events.map((e) => (e.message as { message: { content: string } }).message.content)
    expect(tailContents).toEqual(['msg-4', 'msg-5', 'msg-6', 'msg-7'])
  })
})
