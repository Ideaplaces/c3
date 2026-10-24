import { describe, it, expect } from 'vitest'
import { agentEnv } from './agent-env.js'

describe('agentEnv', () => {
  const base = { PATH: '/usr/bin', CLAUDECODE: '1', ANTHROPIC_API_KEY: 'k', SLACK_BOT_TOKEN: 's', DISCORD_BOT_TOKEN: 'd', C3_TRIGGER_SESSION_ID: 'stale', C3_TRIGGER_NAME: 'stale' }

  it('marks a run a cron or Slack trigger started with its own session id', () => {
    expect(agentEnv(base, 'abc', 'cron:tour-help').C3_TRIGGER_SESSION_ID).toBe('abc')
    expect(agentEnv(base, 'abc', 'slack:mentorly-prod-error').C3_TRIGGER_SESSION_ID).toBe('abc')
  })

  it('never marks a session a person drives, and drops an inherited mark', () => {
    expect(agentEnv(base, 'abc', 'web')).toEqual({ PATH: '/usr/bin', C3_TRIGGER_NAME: 'web' })
    expect(agentEnv(base, 'abc', 'discord:superfan-tour-calls')).toEqual({ PATH: '/usr/bin', C3_TRIGGER_NAME: 'discord:superfan-tour-calls' })
    expect(agentEnv(base, 'abc')).toEqual({ PATH: '/usr/bin' })
  })

  it('names the agent a session runs as, so its posts can say who asked', () => {
    expect(agentEnv(base, 'abc', 'cron:plusgrade-pr-review').C3_TRIGGER_NAME).toBe('cron:plusgrade-pr-review')
  })
})
