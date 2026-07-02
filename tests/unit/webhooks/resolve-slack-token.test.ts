import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { resolveSlackToken } from '@/lib/webhooks/resolve-slack-token'

describe('resolveSlackToken', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('returns a normal token as-is', () => {
    expect(resolveSlackToken('xoxb-123-456-abc')).toBe('xoxb-123-456-abc')
  })

  it('falls back to SLACK_BOT_TOKEN when trigger token is undefined', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-fallback'
    expect(resolveSlackToken(undefined)).toBe('xoxb-fallback')
  })

  it('returns undefined when no token is available', () => {
    delete process.env.SLACK_BOT_TOKEN
    expect(resolveSlackToken(undefined)).toBeUndefined()
  })

  it('re-expands an unexpanded ${VAR} from process.env', () => {
    process.env.ELI_SLACK_BOT_TOKEN = 'xoxb-eli-real-token'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = resolveSlackToken('${ELI_SLACK_BOT_TOKEN}')

    expect(result).toBe('xoxb-eli-real-token')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Re-expanded ${ELI_SLACK_BOT_TOKEN}'),
    )
  })

  it('returns undefined and logs error when env var is not set', () => {
    delete process.env.MISSING_TOKEN
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = resolveSlackToken('${MISSING_TOKEN}')

    expect(result).toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('unexpanded env var ${MISSING_TOKEN}'),
    )
  })

  it('falls back to custom env key', () => {
    process.env.CUSTOM_TOKEN = 'xoxb-custom'
    expect(resolveSlackToken(undefined, 'CUSTOM_TOKEN')).toBe('xoxb-custom')
  })

  it('prefers trigger token over fallback env', () => {
    process.env.SLACK_BOT_TOKEN = 'xoxb-fallback'
    expect(resolveSlackToken('xoxb-explicit')).toBe('xoxb-explicit')
  })
})
