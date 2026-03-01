import { describe, it, expect } from 'vitest'
import { parseAssistantMessage, getToolSummary } from '@/lib/messages/parser'

describe('parseAssistantMessage', () => {
  it('extracts text blocks', () => {
    const msg = {
      type: 'assistant' as const,
      message: { role: 'assistant' as const, content: [{ type: 'text', text: 'Hello world' }] },
      session_id: 's1',
    }
    const blocks = parseAssistantMessage(msg as never)
    expect(blocks).toEqual([{ type: 'text', content: 'Hello world' }])
  })

  it('extracts thinking blocks', () => {
    const msg = {
      type: 'assistant' as const,
      message: { role: 'assistant' as const, content: [{ type: 'thinking', thinking: 'Let me think...' }] },
      session_id: 's1',
    }
    const blocks = parseAssistantMessage(msg as never)
    expect(blocks).toEqual([{ type: 'thinking', content: 'Let me think...' }])
  })

  it('extracts tool_use blocks', () => {
    const msg = {
      type: 'assistant' as const,
      message: {
        role: 'assistant' as const,
        content: [{ type: 'tool_use', name: 'Bash', id: 'tool-1', input: { command: 'ls' } }],
      },
      session_id: 's1',
    }
    const blocks = parseAssistantMessage(msg as never)
    expect(blocks).toEqual([{
      type: 'tool_use',
      toolName: 'Bash',
      toolId: 'tool-1',
      input: { command: 'ls' },
    }])
  })

  it('handles mixed content in order', () => {
    const msg = {
      type: 'assistant' as const,
      message: {
        role: 'assistant' as const,
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'text', text: 'Hello' },
          { type: 'tool_use', name: 'Read', id: 't1', input: { file_path: '/a.ts' } },
        ],
      },
      session_id: 's1',
    }
    const blocks = parseAssistantMessage(msg as never)
    expect(blocks).toHaveLength(3)
    expect(blocks[0].type).toBe('thinking')
    expect(blocks[1].type).toBe('text')
    expect(blocks[2].type).toBe('tool_use')
  })

  it('skips empty text blocks', () => {
    const msg = {
      type: 'assistant' as const,
      message: { role: 'assistant' as const, content: [{ type: 'text', text: '' }] },
      session_id: 's1',
    }
    const blocks = parseAssistantMessage(msg as never)
    expect(blocks).toEqual([])
  })

  it('returns empty array for non-assistant messages', () => {
    const msg = { type: 'user' as const, message: { role: 'user' as const, content: 'hi' }, session_id: 's1', parent_tool_use_id: null }
    expect(parseAssistantMessage(msg as never)).toEqual([])
  })

  it('returns empty array for null content', () => {
    const msg = {
      type: 'assistant' as const,
      message: { role: 'assistant' as const, content: null },
      session_id: 's1',
    }
    expect(parseAssistantMessage(msg as never)).toEqual([])
  })
})

describe('getToolSummary', () => {
  it('formats Bash commands', () => {
    expect(getToolSummary('Bash', { command: 'npm test' })).toBe('$ npm test')
  })

  it('truncates long Bash commands to 80 chars', () => {
    const longCmd = 'a'.repeat(100)
    const result = getToolSummary('Bash', { command: longCmd })
    expect(result).toBe(`$ ${'a'.repeat(80)}`)
  })

  it('formats Read tool', () => {
    expect(getToolSummary('Read', { file_path: '/src/index.ts' })).toBe('Read /src/index.ts')
  })

  it('formats Edit tool', () => {
    expect(getToolSummary('Edit', { file_path: '/src/app.tsx' })).toBe('Edit /src/app.tsx')
  })

  it('formats Write tool', () => {
    expect(getToolSummary('Write', { file_path: '/new-file.ts' })).toBe('Write /new-file.ts')
  })

  it('formats Grep tool', () => {
    expect(getToolSummary('Grep', { pattern: 'TODO' })).toBe('Search: "TODO"')
  })

  it('formats Glob tool', () => {
    expect(getToolSummary('Glob', { pattern: '**/*.ts' })).toBe('Glob: **/*.ts')
  })

  it('formats Task tool', () => {
    expect(getToolSummary('Task', { description: 'explore code' })).toBe('Task: explore code')
  })

  it('formats WebFetch tool', () => {
    expect(getToolSummary('WebFetch', { url: 'https://example.com' })).toBe('Fetch: https://example.com')
  })

  it('formats WebSearch tool', () => {
    expect(getToolSummary('WebSearch', { query: 'react hooks' })).toBe('Search: "react hooks"')
  })

  it('returns tool name for unknown tools', () => {
    expect(getToolSummary('CustomTool', { foo: 'bar' })).toBe('CustomTool')
  })
})
