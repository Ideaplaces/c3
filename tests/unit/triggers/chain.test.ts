import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * A trigger can run after another one (`after` in triggers.json), so the
 * TourCockpit content chain (spec keeper, help, judge, translations, What's new,
 * clips) runs in order on completion instead of on clock offsets that let one
 * agent read another's half-finished work. Chip, 2026-10-24.
 */

const { startSession, runningSessionWithLabel, runPrecheck, runPostcheck, recordSkippedRun, sessionEvents, triggers, statuses, dependentsBroken } = vi.hoisted(() => ({
  dependentsBroken: { current: false },
  runPostcheck: vi.fn().mockResolvedValue(undefined),
  statuses: new Map<string, string>(),
  sessionEvents: new (require('events').EventEmitter)(),
  startSession: vi.fn().mockResolvedValue(undefined),
  runningSessionWithLabel: vi.fn().mockReturnValue(null),
  runPrecheck: vi.fn(),
  recordSkippedRun: vi.fn(),
  triggers: { current: {} as Record<string, Record<string, unknown>> },
}))
vi.mock('@/lib/triggers/precheck', () => ({ runPrecheck }))
vi.mock('@/lib/triggers/postcheck', () => ({ runPostcheck }))
vi.mock('@/lib/usage', () => ({ recordSkippedRun }))
vi.mock('@/lib/models', () => ({ DEFAULT_MODEL: 'test-model' }))
vi.mock('@/lib/store/sessions', () => ({ getSession: (id: string) => (statuses.has(id) ? { status: statuses.get(id) } : null) }))
vi.mock('@/lib/sdk/session-manager', () => ({
  sessionManager: {
    startSession,
    runningSessionWithLabel,
    on: (e: string, fn: (...a: unknown[]) => void) => sessionEvents.on(e, fn),
    removeListener: (e: string, fn: (...a: unknown[]) => void) => sessionEvents.removeListener(e, fn),
    getBufferedEvents: () => [],
  },
}))
vi.mock('@/lib/triggers/config', () => {
  return {
    getCronTrigger: (name: string) => {
      const t = triggers.current[name]
      return t ? { schedule: '0 6 * * *', prompt: `${name}.md`, projectPath: '/tmp', permissionMode: 'p', model: 'm', ...t, name } : null
    },
    loadPromptTemplate: () => 'prompt',
    getCronDependents: (name: string, weekday: number) => {
      if (dependentsBroken.current) throw new Error('unreadable triggers.json')
      return Object.entries(triggers.current)
        .filter(([, t]) =>
          ((t.after as import('@/lib/triggers/config').ChainLink[]) ?? []).some(l =>
            typeof l === 'string' ? l === name : l.trigger === name && (!l.weekdays || l.weekdays.includes(weekday)),
          ),
        )
        .map(([k]) => k)
    },
  }
})

import { fireCronTrigger, torontoWeekday } from '@/lib/triggers/fire'

const flush = () => new Promise(r => setTimeout(r, 0))
const started = () => startSession.mock.calls.map(c => (c[0] as { label: string }).label)
const lastSessionId = () => (startSession.mock.calls.at(-1)![0] as { sessionId: string }).sessionId
// How the session manager ends a run: the stored status first, then the event.
function end(status: string, reason = 'completed') {
  const id = lastSessionId()
  statuses.set(id, status)
  sessionEvents.emit('session_ended', id, reason)
}

describe('chaining triggers on completion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionEvents.removeAllListeners()
    statuses.clear()
    runningSessionWithLabel.mockReturnValue(null)
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: 'work' })
    triggers.current = {
      'spec-keeper': { precheck: 'p' },
      help: { precheck: 'p', after: ['spec-keeper'] },
      judge: { precheck: 'p', after: ['help'] },
    }
  })

  it('starts the next link when a run ends completed, and the one after when that ends', async () => {
    await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [], schedule: '15 5 * * *' })
    expect(started()).toEqual(['cron:spec-keeper'])

    end('completed')
    await flush()
    expect(started()).toEqual(['cron:spec-keeper', 'cron:help'])

    end('completed')
    await flush()
    expect(started()).toEqual(['cron:spec-keeper', 'cron:help', 'cron:judge'])
  })

  it('does not hand on from a run that hit its turn limit, stalled, was stopped or ran over time', async () => {
    // A turn limit ends the generator normally, so the event says `completed`;
    // only the stored status knows the result was an error.
    for (const [status, reason] of [['error', 'completed'], ['idle', 'completed'], ['error', 'stalled'], ['idle', 'stopped'], ['error', 'max-duration-exceeded']]) {
      startSession.mockClear()
      await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [] })
      end(status, reason)
      await flush()
      expect(started()).toEqual(['cron:spec-keeper'])
    }
  })

  it('hands on whenever the stored status is completed, whatever the end reason (a hung run force-ended after its abort)', async () => {
    await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [] })
    end('completed', 'hung-iterator-recovered')
    await flush()
    expect(started()).toEqual(['cron:spec-keeper', 'cron:help'])
  })

  it('carries a quiet day through the middle of the chain: help had nothing, the judge still runs', async () => {
    runPrecheck.mockResolvedValueOnce({ proceed: true, exitCode: 0, reason: 'work' }).mockResolvedValueOnce({ proceed: false, exitCode: 3, reason: 'unchanged' })
    await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [] })
    end('completed')
    await flush()
    await flush()
    expect(started()).toEqual(['cron:spec-keeper', 'cron:judge'])
  })

  it('refuses a second fire of a trigger whose first is still in its precheck', async () => {
    let release!: (v: unknown) => void
    runPrecheck.mockReturnValueOnce(new Promise(r => (release = r)))
    const first = fireCronTrigger('judge', { kind: 'chain', chain: ['help'] })
    const second = await fireCronTrigger('judge', { kind: 'clock', chain: [] })
    expect(second.status).toBe(409)
    release({ proceed: true, exitCode: 0, reason: 'work' })
    expect((await first).status).toBe(200)
    expect(started()).toEqual(['cron:judge'])
  })

  it('hands on when the first link had nothing to do, so a quiet spec day still runs help', async () => {
    runPrecheck.mockResolvedValueOnce({ proceed: false, exitCode: 3, reason: 'develop unchanged' })
    await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [] })
    await flush()
    expect(started()).toEqual(['cron:help'])
  })

  it('stays quiet when a dependent finds nothing on its own fallback tick', async () => {
    runPrecheck.mockResolvedValueOnce({ proceed: false, exitCode: 3, reason: 'nothing pending' })
    await fireCronTrigger('help', { kind: 'clock', chain: [] })
    await flush()
    expect(started()).toEqual([])
  })

  it('does hand on from a dependent fallback tick that did work', async () => {
    await fireCronTrigger('help', { kind: 'clock', chain: [] })
    end('completed')
    await flush()
    expect(started()).toEqual(['cron:help', 'cron:judge'])
  })

  it('does not hand on from a busy refusal', async () => {
    runningSessionWithLabel.mockReturnValue('live')
    const res = await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [] })
    await flush()
    expect(res.status).toBe(409)
    expect(started()).toEqual([])
  })

  it('refuses a cycle at its second visit instead of looping', async () => {
    triggers.current = { a: { after: ['b'] }, b: { after: ['a'] } }
    await fireCronTrigger('a', { kind: 'clock', chain: [] })
    end('completed')
    await flush()
    end('completed')
    await flush()
    expect(started()).toEqual(['cron:a', 'cron:b'])
    expect(recordSkippedRun).toHaveBeenCalledWith('cron:a', '/tmp', expect.stringContaining('a > b > a'))
  })
})

describe('chain edges', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionEvents.removeAllListeners()
    statuses.clear()
    runningSessionWithLabel.mockReturnValue(null)
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: 'work' })
  })

  it('refuses a chain longer than eight links', async () => {
    triggers.current = { x: {} }
    const res = await fireCronTrigger('x', { kind: 'chain', chain: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
    expect(res.status).toBe(409)
    expect(started()).toEqual([])
  })

  it('follows a weekly link by the Eastern day: Thursday night in Toronto is not Friday', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      triggers.current = { judge: {}, week: { after: [{ trigger: 'judge', weekdays: [5] }] } }
      vi.setSystemTime(new Date('2026-10-23T01:30:00Z'))
      await fireCronTrigger('judge', { kind: 'clock', chain: [] })
      end('completed')
      await flush()
      expect(started()).toEqual(['cron:judge'])

      vi.setSystemTime(new Date('2026-10-23T12:00:00Z'))
      await fireCronTrigger('judge', { kind: 'clock', chain: [] })
      end('completed')
      await flush()
      expect(started()).toEqual(['cron:judge', 'cron:judge', 'cron:week'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts the other dependents when one of them fails to start', async () => {
    triggers.current = { judge: {}, week: { after: ['judge'] }, translate: { after: ['judge'] } }
    await fireCronTrigger('judge', { kind: 'clock', chain: [] })
    startSession.mockRejectedValueOnce(new Error('spawn failed'))
    end('completed')
    await flush()
    await flush()
    expect(started()).toEqual(['cron:judge', 'cron:week', 'cron:translate'])
  })

  it('never throws into the session manager when the triggers cannot be read at the end of a run', async () => {
    triggers.current = { judge: {}, week: { after: ['judge'] } }
    await fireCronTrigger('judge', { kind: 'clock', chain: [] })
    dependentsBroken.current = true
    try {
      expect(() => end('completed')).not.toThrow()
    } finally {
      dependentsBroken.current = false
    }
    await flush()
    expect(started()).toEqual(['cron:judge'])
  })

  it('still runs the postcheck of a run that does not hand on', async () => {
    triggers.current = { judge: { postcheck: 'python3 watchdog.py' }, week: { after: ['judge'] } }
    await fireCronTrigger('judge', { kind: 'clock', chain: [] })
    end('error', 'stalled')
    await flush()
    expect(runPostcheck).toHaveBeenCalledOnce()
    expect(runPostcheck.mock.calls[0][3]).toMatchObject({ endReason: 'stalled' })
    expect(started()).toEqual(['cron:judge'])
  })
})

describe('the weekday of a weekly link is Eastern', () => {
  it('reads Thursday night in Toronto as Thursday, though it is already Friday in UTC', () => {
    // 2026-10-23 01:30 UTC is Thursday 2026-10-22 21:30 in Toronto.
    expect(torontoWeekday(new Date('2026-10-23T01:30:00Z'))).toBe(4)
    expect(torontoWeekday(new Date('2026-10-23T12:00:00Z'))).toBe(5)
  })
})
