import { describe, it, expect } from 'vitest'
import { isWaitingOnTask, nextOpenTasks, type OpenTasks } from '@/lib/sdk/open-tasks'

const system = (subtype: string, task_id: string, extra: object = {}) => ({ type: 'system', subtype, task_id, ...extra })

describe('nextOpenTasks', () => {
  it('opens on task_started and closes on task_notification, per task', () => {
    let open: OpenTasks = new Map()
    open = nextOpenTasks(open, system('task_started', 'a', { task_type: 'local_agent' }))
    open = nextOpenTasks(open, system('task_started', 'b', { task_type: 'local_bash' }))
    open = nextOpenTasks(open, system('task_notification', 'a'))
    expect([...open]).toEqual([['b', 'local_bash']])
  })

  it('does not count housekeeping tasks as work', () => {
    expect(nextOpenTasks(new Map(), system('task_started', 'a', { ambient: true })).size).toBe(0)
    expect(nextOpenTasks(new Map(), system('task_started', 'a', { skip_transcript: true })).size).toBe(0)
  })

  it('ignores every other message', () => {
    const open: OpenTasks = new Map([['a', 'local_agent']])
    expect(nextOpenTasks(open, { type: 'assistant', subtype: 'task_notification', task_id: 'a' })).toBe(open)
    expect(nextOpenTasks(open, system('task_progress', 'a'))).toBe(open)
    expect(nextOpenTasks(open, system('task_notification', 'other'))).toBe(open)
  })
})

describe('isWaitingOnTask', () => {
  const shell = new Map([['s', 'local_bash']])
  const agent = new Map([['a', 'local_agent']])

  it('is false with nothing open', () => {
    expect(isWaitingOnTask(new Map(), 0, 900)).toBe(false)
  })
  it('holds a shell only inside its budget', () => {
    expect(isWaitingOnTask(shell, 900, 900)).toBe(true)
    expect(isWaitingOnTask(shell, 901, 900)).toBe(false)
  })
  it('holds anything else however long the silence, even beside a stale shell', () => {
    expect(isWaitingOnTask(agent, 10_000, 900)).toBe(true)
    expect(isWaitingOnTask(new Map([...shell, ...agent]), 10_000, 900)).toBe(true)
  })
})
