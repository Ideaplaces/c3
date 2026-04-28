import { randomUUID } from 'crypto'
import { sessionManager } from '@/lib/sdk/session-manager'
import { getSlackTrigger, loadPromptTemplate } from '@/lib/triggers/config'
import { slackifyMarkdown } from 'slackify-markdown'
import { detectSessionFailure } from '@/lib/webhooks/failure-detector'

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

  // Generate the session ID up front so we can interpolate it into the prompt.
  // Agents that need to self-link (e.g. in a DM) can use {{sessionId}},
  // {{sessionUrl}}, and {{resumeCommand}} in their template.
  const sessionId = randomUUID()
  const baseUrl = process.env.C3_BASE_URL || 'http://localhost:8347'
  const sessionUrl = `${baseUrl}/sessions/${sessionId}`
  const resumeCommand = `cd ${trigger.projectPath} && claude --resume ${sessionId} --dangerously-skip-permissions`

  const prompt = loadPromptTemplate(trigger.prompt, {
    message,
    author: author || 'unknown',
    channel: channelName || trigger.name,
    channelId,
    messageTs: messageTs || '',
    timestamp: new Date().toISOString(),
    sessionId,
    sessionUrl,
    resumeCommand,
  })

  await sessionManager.startSession({
    sessionId,
    projectPath: trigger.projectPath,
    prompt,
    permissionMode: trigger.permissionMode || 'bypassPermissions',
    model: trigger.model || 'claude-opus-4-6',
  })

  console.log(`[Slack Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)

  const slackBotToken = trigger.slackBotToken || process.env.SLACK_BOT_TOKEN
  const replyInThread = trigger.replyInThread !== false

  // Immediately notify: session started (reply in thread)
  if (slackBotToken && messageTs && replyInThread) {
    const startMessage = [
      `:robot_face: *Session started* (\`${sessionId.slice(0, 8)}\`)`,
      `Watch live: ${baseUrl}/sessions/${sessionId}`,
    ].join('\n')

    fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${slackBotToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: channelId,
        thread_ts: messageTs,
        reply_broadcast: false,
        text: startMessage,
        unfurl_links: false,
      }),
    })
      .then(res => res.json())
      .then((data: Record<string, unknown>) => {
        if (data.ok) {
          console.log(`[Slack Webhook] Session start notification sent for ${sessionId}`)
        } else {
          console.error(`[Slack Webhook] Start notification failed:`, data.error)
        }
      })
      .catch(err => console.error(`[Slack Webhook] Start notification error:`, err))
  }

  // On completion: reply to the Slack thread with findings, OR with a failure
  // notice if the session died before producing meaningful output. The failure
  // notice ALWAYS posts (even when replyInThread is false) so a silent agent
  // crash never goes unseen — Chip will not silently fail.
  if (slackBotToken && messageTs) {
    const onSessionEnded = (sid: string, reason: string) => {
      if (sid !== sessionId) return
      sessionManager.removeListener('session_ended', onSessionEnded)
      console.log(`[Slack Webhook] Session ${sessionId} ended (${reason})`)

      const events = sessionManager.getBufferedEvents(sessionId)
      const failure = detectSessionFailure(events, reason)

      if (!failure.failed && !replyInThread) {
        // Trigger handles its own DM; nothing to post here.
        return
      }

      let slackMessage: string
      if (failure.failed) {
        const reasonText = failure.reason.length > 1500
          ? failure.reason.slice(0, 1500) + '...'
          : failure.reason
        slackMessage = [
          `:warning: *Agent session failed* (\`${sessionId.slice(0, 8)}\`)`,
          '',
          `*Reason:* ${reasonText}`,
          '',
          `*Take over this session:*`,
          `Browser: ${baseUrl}/sessions/${sessionId}`,
          `Resume in terminal:`,
          '```',
          resumeCommand,
          '```',
        ].join('\n')
      } else {
        const summary = extractSummary(sessionId, reason)
        const slackSummary = slackifyMarkdown(
          summary.length > 2500 ? summary.slice(0, 2500) + '...' : summary
        )
        slackMessage = [
          `*Agent Investigation Complete* (\`${sessionId.slice(0, 8)}\`)`,
          '',
          slackSummary,
          '',
          `*Continue this conversation:*`,
          `Browser: ${baseUrl}/sessions/${sessionId}`,
          `Resume in terminal:`,
          '```',
          resumeCommand,
          '```',
        ].join('\n')
      }

      console.log(`[Slack Webhook] Replying in thread: channel=${channelId} thread_ts=${messageTs} failed=${failure.failed}`)
      fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${slackBotToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: channelId,
          thread_ts: messageTs,
          reply_broadcast: false,
          text: slackMessage,
          unfurl_links: false,
        }),
      })
        .then(res => res.json())
        .then((data: Record<string, unknown>) => {
          if (data.ok) {
            console.log(`[Slack Webhook] Replied in Slack thread for session ${sessionId} (thread_ts=${messageTs}, failed=${failure.failed})`)
          } else {
            console.error(`[Slack Webhook] Slack reply failed:`, data.error, `thread_ts=${messageTs}`)
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

