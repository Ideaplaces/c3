import { sessionManager } from '@/lib/sdk/session-manager'
import { runPrecheck } from '@/lib/triggers/precheck'
import { recordSkippedRun } from '@/lib/usage'
import { getChannelTrigger, loadPromptTemplate } from '@/lib/triggers/config'
import { detectSessionFailure } from '@/lib/webhooks/failure-detector'
import { archiveThread, shouldArchiveThread } from '@/lib/webhooks/discord-threads'
import { extractSessionSummary, resumeOrStart, withThreadLock } from '@/lib/webhooks/thread-session'
import { postDiscordMessage } from '@/lib/webhooks/discord-mirror'
import { getInboxConfig } from '@/lib/inbox/config'
import { markAnswered } from '@/lib/inbox/store'
import { mirrorPostToInbox } from '@/lib/inbox/discord'
import { nonceFor } from '@/lib/inbox/mirror'

export async function POST(request: Request) {
  // Verify shared secret
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { channelId, message, author, messageId, threadId, threadCreated, followUp } = body as {
    channelId?: string; message?: string; author?: string; messageId?: string; threadId?: string; threadCreated?: boolean
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
  const handle = async (): Promise<Response> => {
  const inbox = getInboxConfig()
  const isInbox = inbox?.trigger === trigger.name

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
      // The bot opened this thread for this message; a skipped run leaves it empty, and nothing in it
      // is for Chip. A thread it reused (a replay) holds an earlier report and stays as it is.
      const token = trigger.discordBotToken || process.env.DISCORD_BOT_TOKEN
      if (token && threadId && threadCreated === true && !followUp && !isInbox && trigger.thread && trigger.webhookId) await archiveThread(token, threadId)
      return Response.json({ trigger: trigger.name, status: 'skipped', reason: check.reason })
    }
  }

  const label = `discord:${trigger.name}`
  const reply = typeof followUp === 'string' && followUp.trim() ? followUp : null
  const { sessionId, status } = await resumeOrStart({
    key: threadKey, trigger, platform: 'Discord', author: author || 'someone', reply, prompt,
  })
  if (status === 'busy') {
    return Response.json({ trigger: trigger.name, status, sessionId }, { status: 409 })
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
    const summary = extractSessionSummary(events, reason, 1500)

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
        const mirror = isInbox
          ? null
          : await mirrorPostToInbox({
              sourceChannelId: channelId,
              sourceThreadId: threadId || undefined,
              sourceMessageId: posted,
              text: failure.failed ? `Run failed: ${failure.reason.slice(0, 200)}` : summary,
              agent: label,
              sessionId,
            })
        if (threadId && shouldArchiveThread({ threadId, webhookTrigger: Boolean(trigger.webhookId), isInbox, failed: failure.failed, mirror })) {
          await archiveThread(discordBotToken, threadId)
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

  return Response.json({ sessionId, trigger: trigger.name, status })
  }

  return await withThreadLock(threadKey, handle, () => Response.json({ trigger: trigger.name, status: 'busy' }, { status: 409 }))
}
