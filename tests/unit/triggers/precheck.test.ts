import { describe, it, expect } from 'vitest'
import { runPrecheck } from '@/lib/triggers/precheck'

describe('runPrecheck', () => {
  it('proceeds on exit 0 and carries the last stdout line as the reason', async () => {
    const r = await runPrecheck('echo "42 new messages"; exit 0', '/tmp')
    expect(r).toEqual({ proceed: true, exitCode: 0, reason: '42 new messages' })
  })

  it('skips on a non-zero exit with the last line as the reason', async () => {
    const r = await runPrecheck('echo checking; echo "nothing new since 297"; exit 3', '/tmp')
    expect(r.proceed).toBe(false)
    expect(r.exitCode).toBe(3)
    expect(r.reason).toBe('nothing new since 297')
  })

  it('skips when the command itself cannot run', async () => {
    const r = await runPrecheck('/definitely/not/a/binary', '/tmp')
    expect(r.proceed).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  it('runs in the trigger project path with ~ expanded', async () => {
    const r = await runPrecheck('pwd', '~')
    expect(r.proceed).toBe(true)
    expect(r.reason).toBe(process.env.HOME)
  })
})

describe('runPrecheck env', () => {
  it('hands the triggering message to the command through the environment', async () => {
    const r = await runPrecheck('echo "got: $C3_MESSAGE / $C3_CHANNEL_ID"', '/tmp', { C3_MESSAGE: 'disk full on api', C3_CHANNEL_ID: 'C123' })
    expect(r.proceed).toBe(true)
    expect(r.reason).toBe('got: disk full on api / C123')
  })
})
