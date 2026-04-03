import { describe, it, expect } from 'vitest'
import { groupMessages, extractToolResults, getSessionStatus, type DisplayGroup } from '@/lib/sessions/message-grouping'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

// Helper to build SDK messages for testing
function userMsg(text: string): SDKMessage {
  return { type: 'user', message: { role: 'user', content: text } } as SDKMessage
}

function assistantTextMsg(text: string): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  } as SDKMessage
}

function assistantToolMsg(toolName: string, toolId: string): SDKMessage {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'tool_use', id: toolId, name: toolName, input: {} }] },
  } as SDKMessage
}

function toolResultMsg(toolId: string, content: string, isError = false): SDKMessage {
  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: toolId, content, is_error: isError }],
    },
  } as SDKMessage
}

function systemMsg(): SDKMessage {
  return { type: 'system', subtype: 'init', cwd: '/test' } as unknown as SDKMessage
}

function resultMsg(text: string): SDKMessage {
  return { type: 'result', subtype: 'success', result: text } as unknown as SDKMessage
}

describe('groupMessages', () => {
  it('returns empty array for empty input', () => {
    expect(groupMessages([])).toEqual([])
  })

  it('groups a simple user message', () => {
    const groups = groupMessages([userMsg('hello')])
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('user')
  })

  it('groups an assistant text message separately', () => {
    const groups = groupMessages([userMsg('hi'), assistantTextMsg('hello!')])
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('user')
    expect(groups[1].type).toBe('assistant-text')
  })

  it('groups consecutive tool calls into a single activity group', () => {
    const msgs = [
      assistantToolMsg('Read', 'tool-1'),
      toolResultMsg('tool-1', 'file contents'),
      assistantToolMsg('Edit', 'tool-2'),
      toolResultMsg('tool-2', 'edited'),
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('activity')
    expect(groups[0].messages).toHaveLength(4)
  })

  it('flushes activity before a text message', () => {
    const msgs = [
      assistantToolMsg('Read', 'tool-1'),
      toolResultMsg('tool-1', 'contents'),
      assistantTextMsg('Here is what I found'),
    ]
    const groups = groupMessages(msgs)
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('activity')
    expect(groups[1].type).toBe('assistant-text')
  })

  it('handles system messages', () => {
    const groups = groupMessages([systemMsg(), userMsg('hi')])
    expect(groups).toHaveLength(2)
    expect(groups[0].type).toBe('system')
    expect(groups[1].type).toBe('user')
  })

  it('handles result messages', () => {
    const groups = groupMessages([assistantTextMsg('done'), resultMsg('success')])
    expect(groups).toHaveLength(2)
    expect(groups[1].type).toBe('result')
  })

  it('captures tool summaries in activity groups', () => {
    const msgs = [
      assistantToolMsg('Read', 'tool-1'),
      toolResultMsg('tool-1', 'contents'),
    ]
    const groups = groupMessages(msgs)
    expect(groups[0].toolSummaries).toBeDefined()
    expect(groups[0].toolSummaries!.length).toBe(1)
  })

  it('handles interleaved text and tool calls correctly', () => {
    const msgs = [
      userMsg('fix the bug'),
      assistantToolMsg('Read', 't1'),
      toolResultMsg('t1', 'code'),
      assistantTextMsg('I see the issue'),
      assistantToolMsg('Edit', 't2'),
      toolResultMsg('t2', 'fixed'),
      assistantTextMsg('Done!'),
    ]
    const groups = groupMessages(msgs)
    expect(groups.map((g: DisplayGroup) => g.type)).toEqual([
      'user',
      'activity',
      'assistant-text',
      'activity',
      'assistant-text',
    ])
  })
})

describe('extractToolResults', () => {
  it('returns empty map for no messages', () => {
    expect(extractToolResults([]).size).toBe(0)
  })

  it('extracts string tool results', () => {
    const msgs = [toolResultMsg('tool-1', 'file contents')]
    const results = extractToolResults(msgs)
    expect(results.get('tool-1')).toEqual({ content: 'file contents', isError: false })
  })

  it('extracts error tool results', () => {
    const msgs = [toolResultMsg('tool-1', 'permission denied', true)]
    const results = extractToolResults(msgs)
    expect(results.get('tool-1')?.isError).toBe(true)
  })

  it('handles array content with text blocks', () => {
    const msg: SDKMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [{ type: 'text', text: 'line 1' }, { type: 'text', text: 'line 2' }],
        }],
      },
    } as unknown as SDKMessage
    const results = extractToolResults([msg])
    expect(results.get('tool-1')?.content).toBe('line 1\nline 2')
  })

  it('extracts multiple tool results from conversation', () => {
    const msgs = [
      toolResultMsg('t1', 'result 1'),
      toolResultMsg('t2', 'result 2'),
    ]
    const results = extractToolResults(msgs)
    expect(results.size).toBe(2)
  })

  it('ignores non-user messages', () => {
    const msgs = [assistantTextMsg('hello')]
    const results = extractToolResults(msgs)
    expect(results.size).toBe(0)
  })
})

describe('getSessionStatus', () => {
  it('returns not running for empty messages', () => {
    expect(getSessionStatus([]).isRunning).toBe(false)
  })

  it('returns running when session_started is most recent', () => {
    const msgs = [{ type: 'session_started' }]
    expect(getSessionStatus(msgs).isRunning).toBe(true)
  })

  it('returns not running when session_ended is most recent', () => {
    const msgs = [
      { type: 'session_started' },
      { type: 'sdk_event' },
      { type: 'session_ended' },
    ]
    expect(getSessionStatus(msgs).isRunning).toBe(false)
  })

  it('returns running when started after ended', () => {
    const msgs = [
      { type: 'session_started' },
      { type: 'session_ended' },
      { type: 'session_started' },
    ]
    expect(getSessionStatus(msgs).isRunning).toBe(true)
  })

  it('returns not running when ended after started', () => {
    const msgs = [
      { type: 'session_started' },
      { type: 'session_ended' },
      { type: 'session_started' },
      { type: 'sdk_event' },
      { type: 'session_ended' },
    ]
    expect(getSessionStatus(msgs).isRunning).toBe(false)
  })

  it('handles messages with no start or end events', () => {
    const msgs = [{ type: 'sdk_event' }, { type: 'sdk_event' }]
    expect(getSessionStatus(msgs).isRunning).toBe(false)
  })
})
