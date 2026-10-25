import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/**
 * A trigger can run after another one (`after` in triggers.json), so the
 * TourCockpit content chain (spec keeper, help, judge, translations, What's new,
 * clips) runs in order on completion instead of on clock offsets that let one
 * agent read another's half-finished work. Chip, 2026-10-24.
 */

const { startSession, runningSessionWithLabel, runPrecheck, runPostcheck, recordSkippedRun, sessionEvents, triggers, statuses, dependentsBroken, turns } = vi.hoisted(() => ({
  dependentsBroken: { current: false },
  turns: new Map<string, Date>(),
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
vi.mock('@/lib/triggers/chain-turns', () => ({
  lastChainTurn: (name: string) => turns.get(name) ?? null,
  recordChainTurn: (name: string, at: Date) => turns.set(name, at),
}))
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
    turns.clear()
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
    turns.clear()
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

describe('the fallback clock of a chained trigger', () => {
  // Saturday 2026-10-24, Eastern: the chain runs from 05:15, help's fallback is 06:30.
  const at = (iso: string) => vi.setSystemTime(new Date(iso))

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    sessionEvents.removeAllListeners()
    statuses.clear()
    turns.clear()
    runningSessionWithLabel.mockReturnValue(null)
    runPrecheck.mockResolvedValue({ proceed: true, exitCode: 0, reason: 'work' })
    triggers.current = {
      'spec-keeper': { schedule: '15 5 * * *', precheck: 'p' },
      help: { schedule: '30 6 * * *', precheck: 'p', after: ['spec-keeper'] },
    }
  })
  afterEach(() => vi.useRealTimers())

  async function chainReachesHelp(helpEnds: string) {
    at('2026-10-24T09:15:00Z')
    await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [] })
    at('2026-10-24T09:20:00Z')
    end('completed')
    await flush()
    at('2026-10-24T09:38:00Z')
    end(helpEnds)
    await flush()
  }

  it('skips the tick when the chain already got the trigger through its turn, so it does not re-read the chain\'s own commits', async () => {
    await chainReachesHelp('completed')
    at('2026-10-24T10:30:10Z')
    const res = await fireCronTrigger('help', { kind: 'clock', chain: [], schedule: '30 6 * * *' })
    expect(res.body.status).toBe('skipped')
    expect(runPrecheck).toHaveBeenCalledTimes(2)
    expect(started()).toEqual(['cron:spec-keeper', 'cron:help'])
  })

  it('runs the tick when the chain-fired run failed, which is what the fallback is for', async () => {
    await chainReachesHelp('error')
    at('2026-10-24T10:30:10Z')
    await fireCronTrigger('help', { kind: 'clock', chain: [], schedule: '30 6 * * *' })
    expect(started()).toEqual(['cron:spec-keeper', 'cron:help', 'cron:help'])
  })

  it('runs the tick when the chain last reached the trigger before its previous tick', async () => {
    turns.set('help', new Date('2026-10-23T09:20:00Z'))
    at('2026-10-24T10:30:10Z')
    await fireCronTrigger('help', { kind: 'clock', chain: [], schedule: '30 6 * * *' })
    expect(started()).toEqual(['cron:help'])
  })

  it('runs the fallback of a schedule that has not come round in eight days, whatever turn is recorded', async () => {
    triggers.current = { monthly: { schedule: '0 9 1 * *', after: ['x'] } }
    turns.set('monthly', new Date('2026-10-20T12:00:00Z'))
    at('2026-11-01T14:00:05Z')
    await fireCronTrigger('monthly', { kind: 'clock', chain: [], timestamp: '2026-11-01T14:00:05Z' })
    expect(started()).toEqual(['cron:monthly'])
  })

  it('skips only the tick right after the chain on a fifteen-minute schedule', async () => {
    triggers.current = { translate: { schedule: '*/15 * * * *', after: ['judge'] } }
    turns.set('translate', new Date('2026-10-24T09:57:00Z'))
    at('2026-10-24T10:00:20Z')
    expect((await fireCronTrigger('translate', { kind: 'clock', chain: [], timestamp: '2026-10-24T10:00:20Z' })).body.status).toBe('skipped')
    at('2026-10-24T10:15:20Z')
    expect((await fireCronTrigger('translate', { kind: 'clock', chain: [], timestamp: '2026-10-24T10:15:20Z' })).body.status).toBe('started')
  })

  it('measures from the tick the scheduler matched, even when the request arrives a minute late', async () => {
    await chainReachesHelp('completed')
    at('2026-10-24T10:31:10Z')
    const res = await fireCronTrigger('help', { kind: 'clock', chain: [], timestamp: '2026-10-24T10:30:25Z' })
    expect(res.body.status).toBe('skipped')
  })

  it('counts a chain fire whose precheck found nothing to do as the turn', async () => {
    runPrecheck.mockResolvedValueOnce({ proceed: true, exitCode: 0, reason: 'work' }).mockResolvedValueOnce({ proceed: false, exitCode: 3, reason: 'unchanged' })
    at('2026-10-24T09:15:00Z')
    await fireCronTrigger('spec-keeper', { kind: 'clock', chain: [] })
    at('2026-10-24T09:20:00Z')
    end('completed')
    await flush()
    expect(turns.get('help')?.toISOString()).toBe('2026-10-24T09:20:00.000Z')
  })
})

describe('the weekday of a weekly link is Eastern', () => {
  it('reads Thursday night in Toronto as Thursday, though it is already Friday in UTC', () => {
    // 2026-10-23 01:30 UTC is Thursday 2026-10-22 21:30 in Toronto.
    expect(torontoWeekday(new Date('2026-10-23T01:30:00Z'))).toBe(4)
    expect(torontoWeekday(new Date('2026-10-23T12:00:00Z'))).toBe(5)
  })
})
