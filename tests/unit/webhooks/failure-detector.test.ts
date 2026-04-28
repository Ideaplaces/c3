import { describe, it, expect } from 'vitest'
import { detectSessionFailure, type BufferedSessionEvent } from '@/lib/webhooks/failure-detector'

const ev = (message: unknown): BufferedSessionEvent => ({ sessionId: 's', message })

const assistantText = (text: string, extra: Record<string, unknown> = {}) =>
  ev({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...extra,
  })

const successfulResult = ev({ type: 'result', subtype: 'success' })

describe('detectSessionFailure', () => {
  it('flags rate_limit synthetic message even when reason is "completed"', () => {
    const events = [
      assistantText("You've hit your limit · resets 5:30pm (UTC)", {
        error: 'rate_limit',
        isApiErrorMessage: true,
      }),
    ]
    const result = detectSessionFailure(events, 'completed')
    expect(result.failed).toBe(true)
    expect(result.reason).toContain('rate_limit')
    expect(result.reason).toContain("hit your limit")
  })

  it('flags isApiErrorMessage even without an error label', () => {
    const events = [
      assistantText('Something broke', { isApiErrorMessage: true }),
    ]
    const result = detectSessionFailure(events, 'completed')
    expect(result.failed).toBe(true)
    expect(result.reason).toContain('Something broke')
  })

  it('flags stalled sessions', () => {
    const result = detectSessionFailure([], 'stalled')
    expect(result.failed).toBe(true)
    expect(result.reason).toContain('stalled')
  })

  it('flags max-duration-exceeded sessions', () => {
    const result = detectSessionFailure([], 'max-duration-exceeded')
    expect(result.failed).toBe(true)
  })

  it('flags arbitrary error reasons from the SDK', () => {
    const result = detectSessionFailure([], 'connection refused')
    expect(result.failed).toBe(true)
    expect(result.reason).toBe('connection refused')
  })

  it('flags sessions that produced no assistant output', () => {
    const result = detectSessionFailure([], 'completed')
    expect(result.failed).toBe(true)
    expect(result.reason).toContain('no assistant output')
  })

  it('does not flag a normal completed session with assistant output', () => {
    const events = [assistantText('Investigation complete: root cause is X.'), successfulResult]
    const result = detectSessionFailure(events, 'completed')
    expect(result.failed).toBe(false)
  })

  it('does not flag hung-iterator-recovered when assistant output exists', () => {
    const events = [assistantText('Final findings here.'), successfulResult]
    const result = detectSessionFailure(events, 'hung-iterator-recovered')
    expect(result.failed).toBe(false)
  })

  it('treats hung-iterator-recovered with no output as failed', () => {
    const result = detectSessionFailure([], 'hung-iterator-recovered')
    expect(result.failed).toBe(true)
  })

  it('ignores empty-text assistant blocks when checking for output', () => {
    const events = [assistantText('   ')]
    const result = detectSessionFailure(events, 'completed')
    expect(result.failed).toBe(true)
  })

  it('does not falsely flag when only result event has subtype error but assistant output exists', () => {
    // If there is real assistant output but also an api error somewhere, we still flag
    // because the api error is the more important signal (partial completion).
    const events = [
      assistantText('Some intermediate text.'),
      assistantText('Rate limited', { isApiErrorMessage: true, error: 'rate_limit' }),
    ]
    const result = detectSessionFailure(events, 'completed')
    expect(result.failed).toBe(true)
    expect(result.reason).toContain('rate_limit')
  })
})
