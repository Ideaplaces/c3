import { sessionManager } from '@/lib/sdk/session-manager'
import { getSlackTrigger, loadPromptTemplate } from '@/lib/triggers/config'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { channelId, channelName, message, author, messageTs } = body

  if (!channelId || !message) {
    return Response.json({ error: 'Missing channelId or message' }, { status: 400 })
  }

  const trigger = getSlackTrigger(channelId)
  if (!trigger) {
    console.log(`[Slack Webhook] No trigger configured for channel ${channelId} (${channelName})`)
    return Response.json({ error: 'Channel not configured' }, { status: 404 })
  }

  console.log(`[Slack Webhook] Trigger "${trigger.name}" fired in #${channelName}`)

  const prompt = loadPromptTemplate(trigger.prompt, {
    message,
    author: author || 'unknown',
    channel: channelName || trigger.name,
    channelId,
    messageTs: messageTs || '',
    timestamp: new Date().toISOString(),
  })

  const sessionId = await sessionManager.startSession({
    projectPath: trigger.projectPath,
    prompt,
    permissionMode: trigger.permissionMode || 'bypassPermissions',
    model: trigger.model || 'claude-sonnet-4-6',
  })

  console.log(`[Slack Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)

  // On completion: reply to the Slack thread
  const slackBotToken = trigger.slackBotToken || process.env.SLACK_BOT_TOKEN
  if (slackBotToken && messageTs) {
    const onSessionEnded = (sid: string, reason: string) => {
      if (sid !== sessionId) return
      sessionManager.removeListener('session_ended', onSessionEnded)
      console.log(`[Slack Webhook] Session ${sessionId} ended (${reason}), replying to Slack`)

      const summary = extractSummary(sessionId, reason)
      const baseUrl = process.env.CCC_PUBLIC_URL || process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:8347'

      const slackMessage = [
        `*Agent Investigation Complete* (\`${sessionId.slice(0, 8)}\`)`,
        '',
        summary.length > 2800 ? summary.slice(0, 2800) + '...' : summary,
        '',
        `View full session: ${baseUrl}/sessions/${sessionId}`,
      ].join('\n')

      // Reply in thread
      fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackBotToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId,
          thread_ts: messageTs,
          text: slackMessage,
          unfurl_links: false,
        }),
      })
        .then(res => res.json())
        .then((data: Record<string, unknown>) => {
          if (data.ok) {
            console.log(`[Slack Webhook] Replied in Slack thread for session ${sessionId}`)
          } else {
            console.error(`[Slack Webhook] Slack reply failed:`, data.error)
          }
        })
        .catch(err => console.error(`[Slack Webhook] Slack reply error:`, err))
    }

    sessionManager.on('session_ended', onSessionEnded)
  }

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
        if (textParts) return textParts.slice(0, 3000)
      } else if (typeof content === 'string' && content) {
        return content.slice(0, 3000)
      }
    }
  }

  return `Session completed (${reason})`
}
