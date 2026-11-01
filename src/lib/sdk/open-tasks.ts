/**
 * The tasks a session still has running: sub-agents, shells and monitors, read from
 * the SDK's own task events.
 *
 * A session waiting on one writes nothing and emits nothing, which is what a hung
 * iterator looks like from outside. On 2026-10-25 the Pulse run ended its turn to wait
 * for test-gate, whose unit run was silent for two minutes. The watchdog ended the run,
 * and its data and its CI gate were lost.
 */
export type OpenTasks = ReadonlyMap<string, string>

type TaskEvent = {
  type?: string
  subtype?: string
  task_id?: string
  task_type?: string
  ambient?: boolean
  skip_transcript?: boolean
}

export function nextOpenTasks(open: OpenTasks, message: TaskEvent): OpenTasks {
  if (message.type !== 'system' || !message.task_id) return open
  if (message.subtype === 'task_started' && !message.ambient && !message.skip_transcript) {
    return new Map(open).set(message.task_id, message.task_type ?? 'unknown')
  }
  if (message.subtype === 'task_notification' && open.has(message.task_id)) {
    const next = new Map(open)
    next.delete(message.task_id)
    return next
  }
  return open
}

/**
 * A silent session is waiting, not hung, while a task it depends on is open. A shell
 * alone gets a shorter budget than an agent: a run can leave one behind for good (a dev
 * server), and holding that run to its cap would refuse its trigger's next ticks. A
 * foreground shell keeps emitting progress, so this silence only ever measures a
 * background one.
 */
export function isWaitingOnTask(open: OpenTasks, silentMs: number, shellBudgetMs: number): boolean {
  if (open.size === 0) return false
  const types = [...open.values()]
  return types.some((type) => type !== 'local_bash') || silentMs <= shellBudgetMs
}
