import { describe, it, expect, vi } from 'vitest'
import { runPrecheck, PRECHECK_NOTHING_TO_DO } from './precheck.js'

describe('runPrecheck protocol', () => {
  it('exit 0 starts the session and carries the last output line as the reason', async () => {
    const r = await runPrecheck('echo one; echo 38 new turns', '/tmp')
    expect(r).toEqual({ proceed: true, exitCode: 0, reason: '38 new turns' })
  })

  it('exit 3 is the only quiet skip', async () => {
    const r = await runPrecheck('echo nothing new; exit 3', '/tmp')
    expect(r).toEqual({ proceed: false, exitCode: PRECHECK_NOTHING_TO_DO, reason: 'nothing new' })
  })

  it('a crashing gate starts the session and says so', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runPrecheck('echo "FileNotFoundError: gcloud" >&2; exit 1', '/tmp')
    expect(r.proceed).toBe(true)
    expect(r.broken).toBe(true)
    expect(r.exitCode).toBe(1)
    expect(r.reason).toBe('FileNotFoundError: gcloud')
    expect(spy).toHaveBeenCalledOnce()
    spy.mockRestore()
  })

  it('a missing binary is a broken gate, not a quiet day', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await runPrecheck('definitely-not-a-real-binary-xyz --check', '/tmp')
    expect(r.proceed).toBe(true)
    expect(r.broken).toBe(true)
    spy.mockRestore()
  })

  it('a gate killed on the timeout says it timed out, not exit -1', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.env.C3_PRECHECK_TIMEOUT_MS = '300'
    vi.resetModules()
    const { runPrecheck: withShortTimeout } = await import('./precheck.js')
    const r = await withShortTimeout('echo looking at origin; sleep 5', '/tmp')
    delete process.env.C3_PRECHECK_TIMEOUT_MS
    expect(r.proceed).toBe(true)
    expect(r.broken).toBe(true)
    expect(r.timedOut).toBe(true)
    // What the old message lost: how long it ran, the signal, and the last
    // thing the gate printed, which is what names the command that hung.
    expect(r.reason).toMatch(/^timed out after \d+s \(SIGTERM\), last output: looking at origin$/)
    expect(spy.mock.calls[0][0]).toContain('timed out after')
    expect(spy.mock.calls[0][0]).not.toContain('exit -1')
    spy.mockRestore()
  })
})
