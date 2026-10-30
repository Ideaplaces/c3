// The same five-field cron the scheduler (cron-scheduler.ts) fires on, read in
// America/Toronto as it is, so C3 can ask when a trigger's clock last came round.

const ZONE = 'America/Toronto'

function parseCronField(field: string, min: number, max: number): number[] {
  const values: number[] = []
  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.push(i)
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      const start = range === '*' ? min : parseInt(range, 10)
      for (let i = start; i <= max; i += step) values.push(i)
    } else if (part.includes('-')) {
      const [startStr, endStr] = part.split('-')
      for (let i = parseInt(startStr, 10); i <= parseInt(endStr, 10); i++) values.push(i)
    } else {
      values.push(parseInt(part, 10))
    }
  }
  return values
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  hourCycle: 'h23',
  weekday: 'short',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
})

function easternParts(date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]))
  return {
    minute: Number(parts.minute),
    hour: Number(parts.hour),
    dom: Number(parts.day),
    month: Number(parts.month),
    dow: WEEKDAYS.indexOf(parts.weekday),
  }
}

export function cronMatches(expression: string, date: Date): boolean {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) return false
  const [minField, hourField, domField, monthField, dowField] = fields
  const t = easternParts(date)
  return (
    parseCronField(minField, 0, 59).includes(t.minute) &&
    parseCronField(hourField, 0, 23).includes(t.hour) &&
    parseCronField(domField, 1, 31).includes(t.dom) &&
    parseCronField(monthField, 1, 12).includes(t.month) &&
    parseCronField(dowField, 0, 6).includes(t.dow)
  )
}

const MINUTE = 60_000
// Long enough for a weekly schedule; a monthly one that has not come round in
// that time is treated as never, which only means its fallback runs.
const LOOKBACK_MINUTES = 8 * 24 * 60

/**
 * The last minute strictly before `now` at which `expression` matched, or null
 * when it did not match in the last eight days.
 */
export function previousOccurrence(expression: string, now: Date): Date | null {
  let t = Math.floor(now.getTime() / MINUTE) * MINUTE - MINUTE
  for (let i = 0; i < LOOKBACK_MINUTES; i++, t -= MINUTE) {
    const date = new Date(t)
    if (cronMatches(expression, date)) return date
  }
  return null
}

/**
 * The triggers due on this tick, judged against one clock reading for the whole
 * list and never twice in the same minute. The scheduler fires them one after
 * the other and each firing waits on its precheck, so a clock read per trigger
 * let the minute run out before the last ones were judged: on 30 October 2026
 * at 0:00 Eastern the every-5, every-10 and every-15-minute prechecks took the
 * whole minute and `machine-health` (every 30 minutes, last in the file) was read
 * at 0:01 and never fired.
 */
export function dueAt<T extends { name: string; schedule: string }>(
  triggers: T[],
  now: Date,
  lastFired: Map<string, number>,
): T[] {
  const minute = Math.floor(now.getTime() / MINUTE) * MINUTE
  return triggers.filter(t => {
    if (!cronMatches(t.schedule, now)) return false
    const last = lastFired.get(t.name)
    if (last !== undefined && last >= minute) return false
    lastFired.set(t.name, minute)
    return true
  })
}
