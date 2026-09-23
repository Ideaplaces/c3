import { randomUUID } from 'crypto'
import { sessionManager } from '@/lib/sdk/session-manager'
import { DEFAULT_MODEL } from '@/lib/models'
import { getCronTrigger, loadPromptTemplate } from '@/lib/triggers/config'
import { runPrecheck } from '@/lib/triggers/precheck'
import { recordSkippedRun } from '@/lib/usage'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { triggerName, schedule, timestamp } = body

  if (!triggerName) {
    return Response.json({ error: 'Missing triggerName' }, { status: 400 })
  }

  const trigger = getCronTrigger(triggerName)
  if (!trigger) {
    console.log(`[Cron Webhook] No trigger configured for "${triggerName}"`)
    return Response.json({ error: 'Trigger not configured' }, { status: 404 })
  }

  console.log(`[Cron Webhook] Trigger "${trigger.name}" fired (schedule: ${schedule})`)

  // One driver per trigger. A run that is still going owns the trigger's
  // watermarks, its checkout and its branch; a second one started beside it
  // races all three. Refused before the precheck, which may itself reset a
  // worktree the running session is using.
  const label = `cron:${trigger.name}`
  const running = sessionManager.runningSessionWithLabel(label)
  if (running) {
    const reason = `previous run ${running} still going`
    console.log(`[Cron Webhook] Refused "${trigger.name}": ${reason}`)
    recordSkippedRun(label, trigger.projectPath, reason)
    return Response.json({ trigger: trigger.name, status: 'busy', sessionId: running, reason }, { status: 409 })
  }

  if (trigger.precheck) {
    const check = await runPrecheck(trigger.precheck, trigger.projectPath)
    if (!check.proceed) {
      console.log(
        `[Cron Webhook] Precheck skipped "${trigger.name}" (exit ${check.exitCode}): ${check.reason}`,
      )
      recordSkippedRun(`cron:${trigger.name}`, trigger.projectPath, check.reason)
      return Response.json({ trigger: trigger.name, status: 'skipped', reason: check.reason })
    }
  }

  // Pre-generate the sessionId so it can be substituted into the prompt
  // template. This lets cron-triggered prompts (which post their own
  // Discord/Slack messages) include a "resume in terminal" command that
  // points at the right session.
  const sessionId = randomUUID()
  const resumeCommand = `cd ${trigger.projectPath} && claude --resume ${sessionId} --dangerously-skip-permissions`

  const prompt = loadPromptTemplate(trigger.prompt, {
    schedule: schedule || trigger.schedule,
    timestamp: timestamp || new Date().toISOString(),
    triggerName: trigger.name,
    sessionId,
    projectPath: trigger.projectPath,
    resumeCommand,
  })

  await sessionManager.startSession({
    sessionId,
    projectPath: trigger.projectPath,
    prompt,
    permissionMode: trigger.permissionMode || 'bypassPermissions',
    model: trigger.model || DEFAULT_MODEL,
    label,
    maxDurationMs: trigger.maxDurationMs,
  })

  console.log(`[Cron Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)

  return Response.json({ sessionId, trigger: trigger.name, status: 'started' })
}
