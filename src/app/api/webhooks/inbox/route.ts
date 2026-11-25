import { sessionManager } from '@/lib/sdk/session-manager'
import { isHomeThreadLabel } from '@/lib/webhooks/discord-threads'
import { linkHomeThread } from '@/lib/webhooks/home-thread'

/**
 * The shared Discord poster calls this after posting a report, before a thread
 * exists. A thread opened on that report has the same ID as the source message.
 */
export async function POST(request: Request) {
  const expected = process.env.CCC_WEBHOOK_SECRET
  if (!expected || request.headers.get('Authorization') !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body is not JSON' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return Response.json({ error: 'Expected a report object' }, { status: 400 })
  }
  const { sourceChannelId, sourceMessageId, text, sessionId } = body as Record<string, unknown>
  const nonempty = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim())
  if (!nonempty(sourceChannelId) || !nonempty(sourceMessageId) || !nonempty(text)) {
    return Response.json({ error: 'sourceChannelId, sourceMessageId and text are required' }, { status: 400 })
  }
  if (sessionId !== undefined && !nonempty(sessionId)) {
    return Response.json({ error: 'sessionId must be a nonempty string' }, { status: 400 })
  }

  try {
    const label = sessionId ? sessionManager.getActiveSession(sessionId)?.label : undefined
    if (!sessionId || !isHomeThreadLabel(label)) return Response.json({ status: 'not-a-trigger-run' })
    const status = linkHomeThread(sourceMessageId, sessionId, label)
    return Response.json({ status }, { status: status === 'conflict' ? 409 : 200 })
  } catch (err) {
    console.error(`[Discord Home Thread] Could not link report ${sourceMessageId}:`, err)
    return Response.json({ error: 'Could not link report' }, { status: 502 })
  }
}
