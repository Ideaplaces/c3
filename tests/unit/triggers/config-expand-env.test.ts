import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { expandEnvVars } from '@/lib/triggers/config'

describe('expandEnvVars', () => {
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(() => {
    process.env.TEST_TOKEN = 'xoxb-real-token-value'
    process.env.ANOTHER_VAR = 'another-value'
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  it('expands a single env var in a string', () => {
    expect(expandEnvVars('${TEST_TOKEN}')).toBe('xoxb-real-token-value')
  })

  it('expands env vars embedded in a larger string', () => {
    expect(expandEnvVars('Bearer ${TEST_TOKEN}')).toBe('Bearer xoxb-real-token-value')
  })

  it('expands multiple env vars in one string', () => {
    expect(expandEnvVars('${TEST_TOKEN}:${ANOTHER_VAR}')).toBe('xoxb-real-token-value:another-value')
  })

  it('leaves unset env vars as the literal ${NAME}', () => {
    expect(expandEnvVars('${NONEXISTENT_VAR}')).toBe('${NONEXISTENT_VAR}')
  })

  it('returns non-string primitives unchanged', () => {
    expect(expandEnvVars(42)).toBe(42)
    expect(expandEnvVars(true)).toBe(true)
    expect(expandEnvVars(null)).toBe(null)
    expect(expandEnvVars(undefined)).toBe(undefined)
  })

  it('recurses into objects', () => {
    const input = {
      name: 'test-trigger',
      slackBotToken: '${TEST_TOKEN}',
      replyInThread: false,
    }
    const result = expandEnvVars(input) as Record<string, unknown>
    expect(result.name).toBe('test-trigger')
    expect(result.slackBotToken).toBe('xoxb-real-token-value')
    expect(result.replyInThread).toBe(false)
  })

  it('recurses into nested objects', () => {
    const input = {
      slack: {
        'eli-trigger': {
          slackBotToken: '${TEST_TOKEN}',
        },
      },
    }
    const result = expandEnvVars(input) as Record<string, Record<string, Record<string, string>>>
    expect(result.slack['eli-trigger'].slackBotToken).toBe('xoxb-real-token-value')
  })

  it('recurses into arrays', () => {
    const input = ['${TEST_TOKEN}', 'plain', '${ANOTHER_VAR}']
    const result = expandEnvVars(input) as string[]
    expect(result).toEqual(['xoxb-real-token-value', 'plain', 'another-value'])
  })

  it('handles a realistic triggers.json slack section', () => {
    const input = {
      slack: {
        'alerts-prod': {
          name: 'alerts-prod',
          channelId: 'C0AFVBX1BEY',
          slackBotToken: '${TEST_TOKEN}',
          replyInThread: false,
        },
        'alerts-dev': {
          name: 'alerts-dev',
          channelId: 'C0A807T3C5A',
        },
      },
    }
    const result = expandEnvVars(input) as Record<string, Record<string, Record<string, unknown>>>
    expect(result.slack['alerts-prod'].slackBotToken).toBe('xoxb-real-token-value')
    expect(result.slack['alerts-dev'].channelId).toBe('C0A807T3C5A')
  })
})
