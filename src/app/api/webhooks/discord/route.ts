import { sessionManager } from '@/lib/sdk/session-manager'
import { runPrecheck } from '@/lib/triggers/precheck'
import { recordSkippedRun } from '@/lib/usage'
import { DEFAULT_MODEL } from '@/lib/models'
import { getChannelTrigger, loadPromptTemplate } from '@/lib/triggers/config'
import { detectSessionFailure } from '@/lib/webhooks/failure-detector'
import { followUpPrompt, linkThread, sessionForThread } from '@/lib/webhooks/discord-threads'
import { getSession } from '@/lib/store/sessions'
import { getSessionJSONLPath } from '@/lib/claude-sessions/scanner'
import { postDiscordMessage } from '@/lib/webhooks/discord-mirror'
import { getInboxConfig } from '@/lib/inbox/config'
import { markAnswered } from '@/lib/inbox/store'
import { mirrorPostToInbox } from '@/lib/inbox/discord'
import { nonceFor } from '@/lib/inbox/mirror'

// Threads with a request between "received" and "session linked or resumed". A
// second message in the same thread meanwhile (a quick reply during the first
// message's precheck, two replies at once) is told the thread is busy instead of
// starting a second session that would overwrite the link.
const busyThreads = new Set<string>()

export async function POST(request: Request) {
  // Verify shared secret
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { channelId, message, author, messageId, threadId, followUp } = body as {
    channelId?: string; message?: string; author?: string; messageId?: string; threadId?: string
    callbackUrl?: string
    /** A reply inside a thread: the person's new message alone, for resuming the thread's session. */
    followUp?: string
  }

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

  const threadKey = trigger.thread && threadId ? threadId : null
  if (threadKey && busyThreads.has(threadKey)) {
    return Response.json({ trigger: trigger.name, status: 'busy' }, { status: 409 })
  }
  const inbox = getInboxConfig()
  const isInbox = inbox?.trigger === trigger.name
  const handle = async (): Promise<Response> => {

  // Chip answered an item in his inbox: it stops counting as open, so the same ask is posted
  // again as a new line if an agent still needs it.
  if (isInbox && threadId && followUp) markAnswered(threadId)

  // Build prompt from template + message context
  const prompt = loadPromptTemplate(trigger.prompt, {
    message,
    author: author || 'unknown',
    channel: trigger.name,
    channelId,
    messageId: messageId || '',
    threadId: threadId || '',
    timestamp: new Date().toISOString(),
  })

  // Start Claude Code session
  if (trigger.precheck) {
    const check = await runPrecheck(trigger.precheck, trigger.projectPath, {
      C3_MESSAGE: String(message ?? ''),
      C3_CHANNEL_ID: String(trigger.channelId ?? ''),
      C3_MESSAGE_TS: String(messageId || ''),
      C3_AUTHOR: String(author ?? ''),
    })
    if (!check.proceed) {
      console.log(`[Discord Webhook] Precheck skipped "${trigger.name}" (exit ${check.exitCode}): ${check.reason}`)
      recordSkippedRun(`discord:${trigger.name}`, trigger.projectPath, check.reason)
      return Response.json({ trigger: trigger.name, status: 'skipped', reason: check.reason })
    }
  }

  // A thread is one conversation and one session: a reply resumes the session the
  // thread's first message started. With no live link (a thread a person opened,
  // a session that is gone) it starts a new one from the composed thread text.
  const label = `discord:${trigger.name}`
  const reply = typeof followUp === 'string' && followUp.trim() ? followUp : null
  const linked = trigger.thread && threadId && reply ? sessionForThread(threadId) : null
  // Gone means gone: the overlay entry outlives the SDK transcript, and resuming a
  // session with no transcript fails every reply in the thread.
  const resumable = linked && linked.trigger === trigger.name && getSession(linked.sessionId) && getSessionJSONLPath(linked.sessionId)
    ? linked.sessionId
    : null
  if (resumable && sessionManager.isSessionActive(resumable)) {
    return Response.json({ trigger: trigger.name, status: 'busy', sessionId: resumable }, { status: 409 })
  }

  let sessionId: string
  if (resumable) {
    sessionId = resumable
    await sessionManager.resumeSession(sessionId, followUpPrompt(author || 'someone', reply!), {
      label,
      maxDurationMs: trigger.maxDurationMs,
      model: trigger.model || DEFAULT_MODEL,
    })
    console.log(`[Webhook] Resumed session ${sessionId} for a reply in thread ${threadId} ("${trigger.name}")`)
  } else {
    sessionId = await sessionManager.startSession({
      projectPath: trigger.projectPath,
      prompt,
      permissionMode: trigger.permissionMode || 'bypassPermissions',
      model: trigger.model || DEFAULT_MODEL,
      label,
      maxDurationMs: trigger.maxDurationMs,
    })
    if (trigger.thread && threadId) linkThread(threadId, sessionId, trigger.name)
    console.log(`[Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)
  }

  // Set up completion callback: post reply to Discord and/or call external URL.
  // A trigger served by another bot identity carries its own token; the reply
  // has to come from the bot that is actually a member of that server.
  const discordBotToken = trigger.discordBotToken || process.env.DISCORD_BOT_TOKEN
  const callbackUrl = body.callbackUrl

  const onSessionEnded = async (sid: string, reason: string) => {
    if (sid !== sessionId) return
    sessionManager.removeListener('session_ended', onSessionEnded)
    console.log(`[Webhook] Session ${sessionId} ended (${reason})`)

    // This run only: a resumed session's buffer also holds every earlier answer.
    const events = sessionManager.getRunEvents(sessionId)
    const failure = detectSessionFailure(events, reason)

    // Extract summary from buffered events
    const summary = extractSummary(events, reason)

    // Reply in Discord directly
    if (discordBotToken && messageId) {
      const baseUrl = process.env.C3_BASE_URL || 'http://localhost:8347'
      const resumeCommand = `cd ${trigger.projectPath} && claude --resume ${sessionId} --dangerously-skip-permissions`
      const replyContent = failure.failed
        ? [
            `:warning: **Agent session failed** (\`${sessionId.slice(0, 8)}\`)`,
            '',
            `**Reason:** ${failure.reason.length > 1500 ? failure.reason.slice(0, 1500) + '...' : failure.reason}`,
            '',
            `**Take over this session:**`,
            `Browser: ${baseUrl}/sessions/${sessionId}`,
            `Resume in terminal:`,
            '```',
            resumeCommand,
            '```',
          ].join('\n')
        : [
            `**Session completed** (\`${sessionId.slice(0, 8)}\`)`,
            '',
            summary.length > 1800 ? summary.slice(0, 1800) + '...' : summary,
            '',
            `View full session: ${baseUrl}/sessions/${sessionId}`,
            `Resume in terminal:`,
            '```',
            resumeCommand,
            '```',
          ].join('\n')

      // Into the thread the bot opened, or as a reply to the original message
      const target = threadId || channelId
      // The nonce is this run's: a retry after a lost answer cannot post the report twice.
      const posted = await postDiscordMessage(discordBotToken, target, replyContent, threadId ? undefined : messageId, undefined, nonceFor(`${sessionId}:${messageId}`))
      if (!posted) {
        console.error(`[Webhook] Discord reply failed for session ${sessionId}`)
      } else {
        console.log(`[Webhook] Discord reply sent for session ${sessionId}`)
        // A report that asks Chip for something, or says the run broke, also lands in his inbox.
        // Not for the inbox's own threads: that answer is already in front of him.
        if (!isInbox) {
          await mirrorPostToInbox({
            sourceChannelId: channelId,
            sourceThreadId: threadId || undefined,
            sourceMessageId: posted,
            text: failure.failed ? `Run failed: ${failure.reason.slice(0, 200)}` : summary,
            agent: label,
            sessionId,
          })
        }
      }
    }

    // Also call external callback if provided. `replied` tells the bot the
    // completion notice is already posted, so it does not post a second one.
    if (callbackUrl) {
      fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          reason,
          summary,
          projectPath: trigger.projectPath,
          failed: failure.failed,
          failureReason: failure.failed ? failure.reason : undefined,
          replied: Boolean(discordBotToken && messageId),
        }),
      }).catch(err => console.error(`[Webhook] External callback failed:`, err))
    }
  }

  sessionManager.on('session_ended', onSessionEnded)

  return Response.json({ sessionId, trigger: trigger.name, status: resumable ? 'resumed' : 'started' })
  }

  if (threadKey) busyThreads.add(threadKey)
  try {
    return await handle()
  } finally {
    if (threadKey) busyThreads.delete(threadKey)
  }
}

function extractSummary(events: { message: unknown }[], reason: string): string {

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
