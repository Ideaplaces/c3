import { sessionManager } from '@/lib/sdk/session-manager'
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

  const prompt = loadPromptTemplate(trigger.prompt, {
    schedule: schedule || trigger.schedule,
    timestamp: timestamp || new Date().toISOString(),
    triggerName: trigger.name,
  })

  const sessionId = await sessionManager.startSession({
    projectPath: trigger.projectPath,
    prompt,
    permissionMode: trigger.permissionMode || 'bypassPermissions',
    model: trigger.model || 'claude-opus-4-6',
  })

  console.log(`[Cron Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)

  return Response.json({ sessionId, trigger: trigger.name, status: 'started' })
}
