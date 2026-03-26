import { sessionManager } from '@/lib/sdk/session-manager'
import { getChannelTrigger, loadPromptTemplate } from '@/lib/triggers/config'

export async function POST(request: Request) {
  // Verify shared secret
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { channelId, message, author, messageId } = body

  if (!channelId || !message) {
    return Response.json({ error: 'Missing channelId or message' }, { status: 400 })
  }

  // Look up channel config
  const trigger = getChannelTrigger(channelId)
  if (!trigger) {
    console.log(`[Webhook] No trigger configured for channel ${channelId}`)
    return Response.json({ error: 'Channel not configured' }, { status: 404 })
  }

  console.log(`[Webhook] Trigger "${trigger.name}" fired by ${author} in channel ${channelId}`)

  // Build prompt from template + message context
  const prompt = loadPromptTemplate(trigger.prompt, {
    message,
    author: author || 'unknown',
    channel: trigger.name,
    channelId,
    messageId: messageId || '',
    timestamp: new Date().toISOString(),
  })

  // Start Claude Code session
  const sessionId = await sessionManager.startSession({
    projectPath: trigger.projectPath,
    prompt,
    permissionMode: trigger.permissionMode || 'bypassPermissions',
    model: trigger.model || 'claude-sonnet-4-6',
  })

  console.log(`[Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)

  // Set up completion callback: post reply to Discord and/or call external URL
  const discordBotToken = process.env.DISCORD_BOT_TOKEN
  const callbackUrl = body.callbackUrl

  const onSessionEnded = (sid: string, reason: string) => {
    if (sid !== sessionId) return
    sessionManager.removeListener('session_ended', onSessionEnded)
    console.log(`[Webhook] Session ${sessionId} ended (${reason})`)

    // Extract summary from buffered events
    const summary = extractSummary(sessionId, reason)

    // Reply in Discord directly
    if (discordBotToken && messageId) {
      const baseUrl = process.env.CCC_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:8347'
      const replyContent = [
        `**Session completed** (\`${sessionId.slice(0, 8)}\`)`,
        '',
        summary.length > 1800 ? summary.slice(0, 1800) + '...' : summary,
        '',
        `View full session: ${baseUrl}/sessions/${sessionId}`,
      ].join('\n')

      // Reply to the original message
      fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bot ${discordBotToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: replyContent,
          message_reference: { message_id: messageId },
        }),
      })
        .then(() => console.log(`[Webhook] Discord reply sent for session ${sessionId}`))
        .catch(err => console.error(`[Webhook] Discord reply failed:`, err))
    }

    // Also call external callback if provided
    if (callbackUrl) {
      fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, reason, summary }),
      }).catch(err => console.error(`[Webhook] External callback failed:`, err))
    }
  }

  sessionManager.on('session_ended', onSessionEnded)

  return Response.json({ sessionId, trigger: trigger.name, status: 'started' })
}

function extractSummary(sessionId: string, reason: string): string {
  const events = sessionManager.getBufferedEvents(sessionId)

  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message as Record<string, unknown>
    if (msg.type === 'assistant' && msg.message) {
      const assistantMsg = msg.message as Record<string, unknown>
      const content = assistantMsg.content
      if (Array.isArray(content)) {
        const textParts = content
          .filter((c: Record<string, unknown>) => c.type === 'text')
          .map((c: Record<string, unknown>) => c.text)
          .join('\n')
        if (textParts) return textParts.slice(0, 1500)
      } else if (typeof content === 'string' && content) {
        return content.slice(0, 1500)
      }
    }
  }

  return `Session completed (${reason})`
}
