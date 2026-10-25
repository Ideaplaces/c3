import { describe, it, expect } from 'vitest'
import { cronMatches, previousOccurrence } from '@/lib/triggers/cron'

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
