import { getSlackTriggerByName } from '@/lib/triggers/config'
import { publishSlackReport, type SlackReport } from '@/lib/webhooks/slack-report'

function isReport(value: unknown): value is SlackReport {
  if (!value || typeof value !== 'object') return false
  const { trigger, sessionId, head, body, idempotencyKey } = value as Partial<SlackReport>
  return [trigger, sessionId, head, idempotencyKey].every(field => typeof field === 'string' && field.trim())
    && (body === undefined || typeof body === 'string')
}

export async function POST(request: Request) {
  const secret = process.env.CCC_WEBHOOK_SECRET
  if (!secret || request.headers.get('Authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let report: unknown
  try {
    report = await request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (!isReport(report)) return Response.json({ error: 'Invalid Slack report' }, { status: 400 })

  const trigger = getSlackTriggerByName(report.trigger)
  if (!trigger) return Response.json({ error: 'Slack trigger not configured' }, { status: 404 })
  if (trigger.threadsOnly !== true) return Response.json({ error: 'Slack trigger must be threads-only' }, { status: 400 })

  try {
    const { body, status } = await publishSlackReport(trigger, report)
    return Response.json(body, { status })
  } catch (err) {
    console.error(`[Slack Report] Failed to save or link the report for ${report.sessionId}:`, err)
    return Response.json({ error: 'Slack report state unavailable' }, { status: 500 })
  }
}
