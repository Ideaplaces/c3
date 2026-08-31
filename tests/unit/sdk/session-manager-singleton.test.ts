import { describe, it, expect, vi } from 'vitest'

// Minimal mocks so importing the module does not touch disk or spawn the SDK.
vi.mock('fs', () => ({
  appendFileSync: vi.fn(),
  readFileSync: vi.fn(() => {
    throw new Error('ENOENT')
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}))

vi.mock('os', () => ({
  hostname: vi.fn(() => 'test-host'),
  homedir: vi.fn(() => '/tmp/test-ccc'),
}))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}))

vi.mock('@/lib/claude-sessions/scanner', () => ({
  scanAllSessions: vi.fn(() => []),
  findSession: vi.fn(() => undefined),
  getSessionJSONLPath: vi.fn(() => null),
  getSessionLastActivityMs: vi.fn(() => null),
  entryToSessionMeta: vi.fn(),
}))

vi.mock('@/lib/claude-sessions/reader', () => ({
  readSessionJSONL: vi.fn(() => []),
}))

describe('sessionManager singleton', () => {
  it('resolves to one shared instance across separate module graphs', async () => {
    // The c3 process loads this module twice: once through the tsx graph
    // (server.ts and the ws handler) and once through the webpack bundle
    // (.next webhook routes). Before the globalThis registration each graph
    // built its own SessionManager, so web sessions and cron/Slack/Discord
    // sessions lived in different activeSessions maps and the browser could
    // never see or stop a webhook-started session. resetModules simulates the
    // second graph: a fresh evaluation of the module must hand back the same
    // instance, not a new one.
    const first = await import('@/lib/sdk/session-manager')
    vi.resetModules()
    const second = await import('@/lib/sdk/session-manager')

    expect(second.sessionManager).toBe(first.sessionManager)
    expect(second).not.toBe(first)
  })
})
