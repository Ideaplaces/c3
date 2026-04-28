export interface BufferedSessionEvent {
  sessionId: string
  message: unknown
}

export interface FailureCheck {
  failed: boolean
  reason: string
}

const NORMAL_END_REASONS = new Set(['completed', 'hung-iterator-recovered'])
const KNOWN_FAILURE_REASONS = new Set(['stalled', 'max-duration-exceeded', 'stopped'])

function extractAssistantText(message: Record<string, unknown>): string {
  const inner = message.message as Record<string, unknown> | undefined
  if (!inner) return ''
  const content = inner.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(c => (c as Record<string, unknown>).type === 'text')
      .map(c => String((c as Record<string, unknown>).text || ''))
      .join(' ')
      .trim()
  }
  return ''
}

function hasMeaningfulAssistantOutput(events: BufferedSessionEvent[]): boolean {
  for (const ev of events) {
    const m = ev.message as Record<string, unknown>
    if (m.type !== 'assistant') continue
    if (m.isApiErrorMessage === true) continue
    if (extractAssistantText(m).length > 0) return true
  }
  return false
}

export function detectSessionFailure(
  events: BufferedSessionEvent[],
  endReason: string,
): FailureCheck {
  if (KNOWN_FAILURE_REASONS.has(endReason)) {
    return { failed: true, reason: `Session ${endReason}` }
  }
  if (!NORMAL_END_REASONS.has(endReason)) {
    return { failed: true, reason: endReason || 'unknown error' }
  }

  for (const ev of events) {
    const m = ev.message as Record<string, unknown>
    if (m.isApiErrorMessage === true || m.error === 'rate_limit') {
      const text = m.type === 'assistant' ? extractAssistantText(m) : ''
      const errLabel = typeof m.error === 'string' && m.error ? m.error : 'api_error'
      const reason = text ? `${errLabel}: ${text}` : errLabel
      return { failed: true, reason }
    }
  }

  if (!hasMeaningfulAssistantOutput(events)) {
    return { failed: true, reason: 'Session produced no assistant output' }
  }

  return { failed: false, reason: '' }
}
