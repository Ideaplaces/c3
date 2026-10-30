import { describe, it, expect } from 'vitest'
import { cronMatches, dueAt, previousOccurrence } from '@/lib/triggers/cron'

// Schedules are Eastern; the machine is UTC. 2026-10-24 is a Saturday, EDT (UTC-4).
describe('cron in America/Toronto', () => {
  it('matches an Eastern time, not the UTC one', () => {
    expect(cronMatches('30 6 * * *', new Date('2026-10-24T10:30:00Z'))).toBe(true)
    expect(cronMatches('30 6 * * *', new Date('2026-10-24T06:30:00Z'))).toBe(false)
  })

  it('finds the last time a daily schedule came round, strictly before now', () => {
    expect(previousOccurrence('30 6 * * *', new Date('2026-10-24T10:30:13Z'))?.toISOString()).toBe('2026-10-23T10:30:00.000Z')
    expect(previousOccurrence('30 6 * * *', new Date('2026-10-24T10:31:00Z'))?.toISOString()).toBe('2026-10-24T10:30:00.000Z')
  })

  it('handles a step and a weekday', () => {
    expect(previousOccurrence('*/15 * * * *', new Date('2026-10-24T10:15:05Z'))?.toISOString()).toBe('2026-10-24T10:00:00.000Z')
    // Friday 10:00 Eastern, asked on Saturday night Eastern, which is already Sunday in UTC.
    expect(previousOccurrence('0 10 * * 5', new Date('2026-10-25T01:00:00Z'))?.toISOString()).toBe('2026-10-23T14:00:00.000Z')
  })

  it('returns null for a schedule that has not come round in eight days', () => {
    expect(previousOccurrence('0 9 1 1 *', new Date('2026-10-24T12:00:00Z'))).toBeNull()
  })
})

// 2026-10-30T04:00:23Z is 0:00:23 Eastern, a busy minute: every step schedule matches it.
describe('dueAt: one clock reading for the whole list', () => {
  const triggers = [
    { name: 'every-five', schedule: '*/5 * * * *' },
    { name: 'daily-ops', schedule: '0 10 * * 1-5' },
    { name: 'machine-health', schedule: '*/30 * * * *' },
  ]
  const midnight = new Date('2026-10-30T04:00:23Z')

  it('judges every trigger on the tick, the last in the list included', () => {
    expect(dueAt(triggers, midnight, new Map()).map(t => t.name)).toEqual(['every-five', 'machine-health'])
    expect(dueAt(triggers, new Date('2026-10-30T04:01:00Z'), new Map())).toEqual([])
  })

  it('fires a trigger once per minute across the two ticks of that minute', () => {
    const fired = new Map<string, number>()
    expect(dueAt(triggers, midnight, fired).map(t => t.name)).toEqual(['every-five', 'machine-health'])
    expect(dueAt(triggers, new Date('2026-10-30T04:00:53Z'), fired)).toEqual([])
    expect(dueAt(triggers, new Date('2026-10-30T04:30:00Z'), fired).map(t => t.name)).toEqual(['every-five', 'machine-health'])
  })

  // Sunday 1 November 2026: 1:30 Eastern happens twice (05:30Z, then 06:30Z after the fall back).
  // Each is its own minute, so a step schedule runs through the repeated hour (the old
  // local-minute key dropped it), and a fixed 1:xx schedule fires twice that night.
  it('treats the repeated hour of the fall back as two hours', () => {
    const fired = new Map<string, number>()
    const both = [{ name: 'half-hourly', schedule: '*/30 * * * *' }, { name: 'one-thirty', schedule: '30 1 * * *' }]
    expect(dueAt(both, new Date('2026-11-01T05:30:05Z'), fired).map(t => t.name)).toEqual(['half-hourly', 'one-thirty'])
    expect(dueAt(both, new Date('2026-11-01T06:30:05Z'), fired).map(t => t.name)).toEqual(['half-hourly', 'one-thirty'])
  })
})
