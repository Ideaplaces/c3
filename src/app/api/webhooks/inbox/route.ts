import { mirrorPostToInbox } from '@/lib/inbox/discord'

/**
 * Hand a post that landed in Discord to the #needs-chip inbox. Called by the shared poster
 * (`~/.c3/scripts/discord/post.py`) after an agent's report is accepted; the server owns the
 * inbox so the thread links and the item store have one writer. A 502 means "try again with the
 * same body": the poster keeps the record in its outbox until it gets a 2xx. It lives under
 * /api/webhooks/ so the sign-in middleware lets the shared secret through.
 */
export async function POST(request: Request) {
  const expected = process.env.CCC_WEBHOOK_SECRET
  if (!expected || request.headers.get('Authorization') !== `Bearer ${expected}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'Body is not JSON' }, { status: 400 })
  }
  const str = (k: string) => (typeof body[k] === 'string' && body[k] ? (body[k] as string) : undefined)
  const sourceChannelId = str('sourceChannelId')
  const sourceMessageId = str('sourceMessageId')
  const text = str('text')
  if (!sourceChannelId || !sourceMessageId || !text) {
    return Response.json({ error: 'sourceChannelId, sourceMessageId and text are required' }, { status: 400 })
  }

  const result = await mirrorPostToInbox({
    sourceChannelId,
    sourceMessageId,
    sourceThreadId: str('sourceThreadId'),
    text,
    agent: str('agent'),
    sessionId: str('sessionId'),
  })
  return Response.json(result, { status: result.status === 'failed' ? 502 : 200 })
}
