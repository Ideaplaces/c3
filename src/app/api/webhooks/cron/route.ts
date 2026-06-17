import { randomUUID } from 'crypto'
import { sessionManager } from '@/lib/sdk/session-manager'
import { DEFAULT_MODEL } from '@/lib/models'
import { getCronTrigger, loadPromptTemplate } from '@/lib/triggers/config'

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

  // Pre-generate the sessionId so it can be substituted into the prompt
  // template. This lets cron-triggered prompts (which post their own
  // Discord/Slack messages) include a "resume in terminal" command that
  // points at the right session.
  const sessionId = randomUUID()

  const prompt = loadPromptTemplate(trigger.prompt, {
    schedule: schedule || trigger.schedule,
    timestamp: timestamp || new Date().toISOString(),
    triggerName: trigger.name,
    sessionId,
    projectPath: trigger.projectPath,
  })

  await sessionManager.startSession({
    sessionId,
    projectPath: trigger.projectPath,
    prompt,
    permissionMode: trigger.permissionMode || 'bypassPermissions',
    model: trigger.model || DEFAULT_MODEL,
  })

  console.log(`[Cron Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)

  return Response.json({ sessionId, trigger: trigger.name, status: 'started' })
}
