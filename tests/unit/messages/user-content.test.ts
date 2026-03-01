import { describe, it, expect } from 'vitest'
import { extractUserMessageText } from '@/lib/messages/user-content'

describe('extractUserMessageText', () => {
  it('returns string content directly', () => {
    expect(extractUserMessageText('hello world')).toBe('hello world')
  })

  it('returns empty string for empty string content', () => {
    expect(extractUserMessageText('')).toBe('')
  })

  it('extracts text from array of text blocks', () => {
    const content = [{ type: 'text', text: 'Hello world' }]
    expect(extractUserMessageText(content)).toBe('Hello world')
  })

  it('joins multiple text blocks with newline', () => {
    const content = [
      { type: 'text', text: 'Line 1' },
      { type: 'text', text: 'Line 2' },
    ]
    expect(extractUserMessageText(content)).toBe('Line 1\nLine 2')
  })

  it('returns null for tool_result content', () => {
    const content = [{ type: 'tool_result', tool_use_id: 'abc', content: 'result' }]
    expect(extractUserMessageText(content)).toBeNull()
  })

  it('returns null for mixed content with tool_result', () => {
    const content = [
      { type: 'text', text: 'some text' },
      { type: 'tool_result', tool_use_id: 'abc', content: 'result' },
    ]
    expect(extractUserMessageText(content)).toBeNull()
  })

  it('filters out non-text blocks', () => {
    const content = [
      { type: 'image', source: {} },
      { type: 'text', text: 'Visible text' },
    ]
    expect(extractUserMessageText(content)).toBe('Visible text')
  })

  it('returns empty string for array with no text blocks', () => {
    const content = [{ type: 'image', source: {} }]
    expect(extractUserMessageText(content)).toBe('')
  })

  it('returns empty string for empty array', () => {
    expect(extractUserMessageText([])).toBe('')
  })

  it('handles non-string non-array content via String()', () => {
    expect(extractUserMessageText(42 as unknown as string)).toBe('42')
  })
})
