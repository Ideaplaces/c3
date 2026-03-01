import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFs: Record<string, string> = {}

vi.mock('fs', () => ({
  existsSync: vi.fn((path: string) => path in mockFs),
  readFileSync: vi.fn((path: string) => {
    if (mockFs[path]) return mockFs[path]
    throw new Error('ENOENT')
  }),
}))

import { readSessionJSONL } from '@/lib/claude-sessions/reader'

describe('JSONL reader', () => {
  beforeEach(() => {
    Object.keys(mockFs).forEach((k) => delete mockFs[k])
  })

  it('returns empty array for non-existent file', () => {
    expect(readSessionJSONL('/no/such/file.jsonl')).toEqual([])
  })

  it('parses user and assistant messages', () => {
    const lines = [
      JSON.stringify({ type: 'user', sessionId: 's1', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'assistant', sessionId: 's1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
    ]
    mockFs['/test.jsonl'] = lines.join('\n')

    const events = readSessionJSONL('/test.jsonl')
    expect(events).toHaveLength(2)
    expect(events[0].sessionId).toBe('s1')
    expect((events[0].message as { type: string }).type).toBe('user')
    expect((events[1].message as { type: string }).type).toBe('assistant')
  })

  it('filters out non-conversation types', () => {
    const lines = [
      JSON.stringify({ type: 'file-history-snapshot', messageId: 'x' }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId: 's1' }),
      JSON.stringify({ type: 'user', sessionId: 's1', message: { role: 'user', content: 'hello' } }),
      JSON.stringify({ type: 'progress', data: { type: 'bash_progress' }, sessionId: 's1' }),
      JSON.stringify({ type: 'assistant', sessionId: 's1', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }),
    ]
    mockFs['/test.jsonl'] = lines.join('\n')

    const events = readSessionJSONL('/test.jsonl')
    expect(events).toHaveLength(2)
  })

  it('includes system messages with subtype', () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', sessionId: 's1', model: 'claude-sonnet-4-6' }),
      JSON.stringify({ type: 'system', subtype: 'turn_duration', sessionId: 's1', durationMs: 5000 }),
    ]
    mockFs['/test.jsonl'] = lines.join('\n')

    const events = readSessionJSONL('/test.jsonl')
    expect(events).toHaveLength(2)
  })

  it('skips malformed JSON lines', () => {
    const lines = [
      '{ broken json',
      JSON.stringify({ type: 'user', sessionId: 's1', message: { role: 'user', content: 'ok' } }),
    ]
    mockFs['/test.jsonl'] = lines.join('\n')

    const events = readSessionJSONL('/test.jsonl')
    expect(events).toHaveLength(1)
  })

  it('handles tool_result user messages', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 's1',
      message: {
        role: 'user',
        content: [{ tool_use_id: 'tool1', type: 'tool_result', content: 'result text', is_error: false }],
      },
    })
    mockFs['/test.jsonl'] = line

    const events = readSessionJSONL('/test.jsonl')
    expect(events).toHaveLength(1)
    const msg = events[0].message as { message: { content: unknown[] } }
    expect(Array.isArray(msg.message.content)).toBe(true)
  })

  it('handles empty file', () => {
    mockFs['/empty.jsonl'] = ''
    expect(readSessionJSONL('/empty.jsonl')).toEqual([])
  })
})
