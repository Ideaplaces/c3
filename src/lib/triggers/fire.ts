import { randomUUID } from 'crypto'
import { sessionManager } from '@/lib/sdk/session-manager'
import { DEFAULT_MODEL } from '@/lib/models'
import { getCronDependents, getCronTrigger, loadPromptTemplate } from '@/lib/triggers/config'
import { runPrecheck } from '@/lib/triggers/precheck'
import { runPostcheck } from '@/lib/triggers/postcheck'
import { recordSkippedRun } from '@/lib/usage'
import { getSession } from '@/lib/store/sessions'

/**
 * How a run was started: by its own schedule, or by the end of a trigger it
 * runs after. `chain` lists the triggers that led here, oldest first, so a
 * cycle in the config stops at the second visit instead of looping.
 */
export interface FireCause {
  kind: 'clock' | 'chain'
  chain: string[]
  schedule?: string
  timestamp?: string
}

export interface FireResult {
  status: number
  body: Record<string, unknown>
}

// Longer than any chain we run (spec keeper, help, judge, translate, clips is
// five), short enough that a config mistake costs a handful of prechecks.
const MAX_CHAIN = 8

// Labels between the busy check and their session being registered. The
// precheck is awaited in between, so without this a chain fire and a clock tick
// of the same trigger could both pass the check and start two runs on one
// worktree, which is what the busy refusal exists to stop (2026-09-14).
const firing = new Set<string>()

export async function fireCronTrigger(name: string, cause: FireCause): Promise<FireResult> {
  const trigger = getCronTrigger(name)
  if (!trigger) {
    console.log(`[Cron] No trigger configured for "${name}"`)
    return { status: 404, body: { error: 'Trigger not configured' } }
  }

  const label = `cron:${trigger.name}`
  const via = cause.kind === 'chain' ? `after ${cause.chain[cause.chain.length - 1]}` : `schedule: ${cause.schedule}`
  console.log(`[Cron] Trigger "${trigger.name}" fired (${via})`)

  if (cause.chain.includes(trigger.name) || cause.chain.length >= MAX_CHAIN) {
    const reason = `chain ${[...cause.chain, trigger.name].join(' > ')} is a cycle or too long`
    console.error(`[Cron] Refused "${trigger.name}": ${reason}`)
    recordSkippedRun(label, trigger.projectPath, reason)
    return { status: 409, body: { trigger: trigger.name, status: 'refused', reason } }
  }

  // One driver per trigger. A run that is still going owns the trigger's
  // watermarks, its checkout and its branch; a second one started beside it
  // races all three. Refused before the precheck, which may itself reset a
  // worktree the running session is using.
  const running = sessionManager.runningSessionWithLabel(label) ?? (firing.has(label) ? 'starting' : null)
  if (running) {
    const reason = `previous run ${running} still going`
    console.log(`[Cron] Refused "${trigger.name}": ${reason}`)
    recordSkippedRun(label, trigger.projectPath, reason)
    return { status: 409, body: { trigger: trigger.name, status: 'busy', sessionId: running, reason } }
  }

  firing.add(label)
  try {
    return await startRun(trigger, label, cause)
  } finally {
    firing.delete(label)
  }
}

async function startRun(
  trigger: NonNullable<ReturnType<typeof getCronTrigger>>,
  label: string,
  cause: FireCause,
): Promise<FireResult> {
  if (trigger.precheck) {
    const check = await runPrecheck(trigger.precheck, trigger.projectPath)
    if (!check.proceed) {
      console.log(`[Cron] Precheck skipped "${trigger.name}" (exit ${check.exitCode}): ${check.reason}`)
      recordSkippedRun(label, trigger.projectPath, check.reason)
      // Nothing to do here means the next link can start: its input is as
      // final as it will get. Except on a dependent's own fallback tick, which
      // would otherwise wake the rest of the chain every time it found nothing
      // (tour-translate ticks every fifteen minutes).
      if (cause.kind === 'chain' || !trigger.after?.length) followOn(trigger.name, cause)
      return { status: 200, body: { trigger: trigger.name, status: 'skipped', reason: check.reason } }
    }
  }

  // Pre-generate the sessionId so it can be substituted into the prompt
  // template. This lets cron-triggered prompts (which post their own
  // Discord/Slack messages) include a "resume in terminal" command that
  // points at the right session.
  const sessionId = randomUUID()
  const baseUrl = (process.env.C3_BASE_URL || 'http://localhost:8347').replace(/\/$/, '')
  const sessionUrl = `${baseUrl}/sessions/${sessionId}`
  const resumeCommand = `cd ${trigger.projectPath} && claude --resume ${sessionId} --dangerously-skip-permissions`

  const prompt = loadPromptTemplate(trigger.prompt, {
    schedule: cause.schedule || trigger.schedule,
    timestamp: cause.timestamp || new Date().toISOString(),
    triggerName: trigger.name,
    sessionId,
    sessionUrl,
    projectPath: trigger.projectPath,
    resumeCommand,
  })

  const startedAt = new Date().toISOString()
  const stopWatching = watchForEnding(sessionId, reason => {
    if (trigger.postcheck) {
      const events = sessionManager.getBufferedEvents(sessionId)
      // Fire-and-forget: nothing waits on the postcheck. A failing postcheck alerts itself; only a throw lands here.
      runPostcheck(label, trigger.postcheck, trigger.projectPath, {
        sessionId,
        sessionUrl,
        startedAt,
        endReason: reason,
        events,
      }).catch(err => console.error(`[Cron] Postcheck error for ${sessionId}:`, err))
    }
    // Only a run that finished its job hands on: its stored status is
    // `completed` only after a success result (and, rarely, for a hung run that
    // never exits after its abort). A run that hit its turn limit also ends the
    // generator normally, but with an error result, and a stalled, stopped or
    // over-time run may have left its work half written. Those wait for the
    // next link's clock.
    if (getSession(sessionId)?.status === 'completed') followOn(trigger.name, cause)
  })

  try {
    await sessionManager.startSession({
      sessionId,
      projectPath: trigger.projectPath,
      prompt,
      permissionMode: trigger.permissionMode || 'bypassPermissions',
      model: trigger.model || DEFAULT_MODEL,
      label,
      maxDurationMs: trigger.maxDurationMs,
    })
  } catch (err) {
    stopWatching()
    throw err
  }

  console.log(`[Cron] Started session ${sessionId} for trigger "${trigger.name}"`)
  return { status: 200, body: { sessionId, trigger: trigger.name, status: 'started' } }
}

// Registered before the session starts, so a run that dies in its first seconds
// is still seen. Returns the unsubscribe for a session that never started.
function watchForEnding(sessionId: string, onEnd: (reason: string) => void): () => void {
  const onEnded = (sid: string, reason: string) => {
    if (sid !== sessionId) return
    sessionManager.removeListener('session_ended', onEnded)
    onEnd(reason)
  }
  sessionManager.on('session_ended', onEnded)
  return () => sessionManager.removeListener('session_ended', onEnded)
}

// Runs inside the session manager's session_ended emit, so nothing may throw out
// of it: a throw there would mark the finished session as failed.
function followOn(name: string, cause: FireCause): void {
  let dependents: string[]
  try {
    dependents = getCronDependents(name, torontoWeekday(new Date()))
  } catch (err) {
    console.error(`[Cron] Could not read the triggers that run after "${name}":`, err)
    return
  }
  if (dependents.length === 0) return
  fireDependents(name, dependents, [...cause.chain, name]).catch(err =>
    console.error(`[Cron] Chain after "${name}" failed:`, err),
  )
}

async function fireDependents(name: string, dependents: string[], chain: string[]): Promise<void> {
  for (const dependent of dependents) {
    console.log(`[Cron] "${name}" handed on to "${dependent}"`)
    try {
      await fireCronTrigger(dependent, { kind: 'chain', chain })
    } catch (err) {
      console.error(`[Cron] Could not fire "${dependent}" after "${name}":`, err)
    }
  }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// The schedules are Eastern, so the day a weekly link follows on is too,
// whatever zone the process runs in.
export function torontoWeekday(date: Date): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Toronto', weekday: 'short' }).format(date)
  return WEEKDAYS.indexOf(short)
}
