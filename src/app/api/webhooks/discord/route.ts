import { formatSessionResult } from '@/lib/discord-bot/logic'
import { sessionManager } from '@/lib/sdk/session-manager'
import { getChannelTrigger, loadPromptTemplate } from '@/lib/triggers/config'
import { runPrecheck } from '@/lib/triggers/precheck'
import { recordSkippedRun } from '@/lib/usage'
import { nonceFor, postDiscordMessage } from '@/lib/webhooks/discord-mirror'
import { archiveThread, isHomeThreadLabel, sessionForThread, shouldArchiveThread } from '@/lib/webhooks/discord-threads'
import { detectSessionFailure } from '@/lib/webhooks/failure-detector'
import { handleHomeReply } from '@/lib/webhooks/home-thread'
import { extractSessionSummary, resumeOrStart, withThreadLock } from '@/lib/webhooks/thread-session'

export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization')
  const expectedSecret = process.env.CCC_WEBHOOK_SECRET
  if (!expectedSecret || authHeader !== `Bearer ${expectedSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { channelId, message, author, messageId, threadId, threadCreated, followUp, homeThread, originReply, callbackUrl } = body as {
    channelId?: string; message?: string; author?: string; messageId?: string; threadId?: string; threadCreated?: boolean
    callbackUrl?: string
    /** The person's new message alone, the original session already has the context. */
    followUp?: string
    homeThread?: boolean
    /** The reply's own thread when a trigger is configured directly on it. */
    originReply?: { threadId: string; parentChannelId?: string | null; messageId: string; text: string }
  }
  const reply = typeof followUp === 'string' && followUp.trim() ? followUp : null
  const replyThreadId = originReply?.threadId || threadId
  const isThreadReply = replyThreadId && (homeThread === true || Boolean(originReply) || typeof followUp === 'string')
  if (!channelId || (!message && !isThreadReply)) {
    return Response.json({ error: 'Missing channelId or message' }, { status: 400 })
  }

  const trigger = getChannelTrigger(channelId)
  let parentTrigger = trigger
  if (originReply) parentTrigger = originReply.parentChannelId ? getChannelTrigger(originReply.parentChannelId) : null
  if (replyThreadId && isThreadReply && !parentTrigger?.thread) {
    const link = sessionForThread(replyThreadId)
    if (link && isHomeThreadLabel(link.trigger)) {
      const replyText = originReply?.text ?? reply
      if (!replyText?.trim()) return Response.json({ status: 'ignored' })
      const replyMessageId = originReply?.messageId ?? messageId
      if (typeof replyMessageId !== 'string' || !replyMessageId.trim()) {
        return Response.json({ error: 'Missing messageId for a linked reply' }, { status: 400 })
      }
      const configuredToken = homeThread === true && !originReply ? undefined : trigger?.discordBotToken
      const token = configuredToken || process.env.DISCORD_BOT_TOKEN
      return await handleHomeReply({
        threadId: replyThreadId, link, messageId: replyMessageId, reply: replyText, author: author || 'someone', token,
        onEnded: (sessionId, reason, projectPath) => postSessionResult({
          sessionId, reason, projectPath, channelId, threadId: replyThreadId, messageId: replyMessageId, callbackUrl,
          token, webhookTrigger: false,
        }),
      })
    }
  }
  if (homeThread === true) return Response.json({ status: 'ignored' })

  if (!trigger) {
    if (replyThreadId) return Response.json({ status: 'ignored' })
    console.log(`[Webhook] No trigger configured for channel ${channelId}`)
    return Response.json({ error: 'Channel not configured' }, { status: 404 })
  }
  if (!message) return Response.json({ error: 'Missing message' }, { status: 400 })

  console.log(`[Webhook] Trigger "${trigger.name}" fired by ${author} in channel ${channelId}`)

  const threadKey = trigger.thread && threadId ? threadId : null
  const token = trigger.discordBotToken || process.env.DISCORD_BOT_TOKEN
  const handle = async (): Promise<Response> => {
    const prompt = loadPromptTemplate(trigger.prompt, {
      message,
      author: author || 'unknown',
      channel: trigger.name,
      channelId,
      messageId: messageId || '',
      threadId: threadId || '',
      timestamp: new Date().toISOString(),
    })

    if (trigger.precheck) {
      const check = await runPrecheck(trigger.precheck, trigger.projectPath, {
        C3_MESSAGE: String(message),
        C3_CHANNEL_ID: String(trigger.channelId ?? ''),
        C3_MESSAGE_TS: messageId || '',
        C3_AUTHOR: author || '',
      })
      if (!check.proceed) {
        console.log(`[Discord Webhook] Precheck skipped "${trigger.name}" (exit ${check.exitCode}): ${check.reason}`)
        recordSkippedRun(`discord:${trigger.name}`, trigger.projectPath, check.reason)
        // Only an empty thread the bot just opened is safe to archive here.
        if (token && threadKey && threadCreated === true && !followUp && trigger.webhookId) await archiveThread(token, threadKey)
        return Response.json({ trigger: trigger.name, status: 'skipped', reason: check.reason })
      }
    }

    const { sessionId, status } = await resumeOrStart({
      key: threadKey, trigger, platform: 'Discord', author: author || 'someone', reply, prompt,
    })
    if (status === 'busy') {
      return Response.json({ trigger: trigger.name, status, sessionId }, { status: 409 })
    }

    const onSessionEnded = async (sid: string, reason: string) => {
      if (sid !== sessionId) return
      sessionManager.removeListener('session_ended', onSessionEnded)
      await postSessionResult({
        sessionId, reason, projectPath: trigger.projectPath, channelId, threadId, messageId, callbackUrl, token,
        webhookTrigger: Boolean(trigger.webhookId),
      })
    }
    sessionManager.on('session_ended', onSessionEnded)
    return Response.json({ sessionId, trigger: trigger.name, status })
  }

  return await withThreadLock(threadKey, handle, () => Response.json({ trigger: trigger.name, status: 'busy' }, { status: 409 }))
}

async function postSessionResult(options: {
  sessionId: string
  reason: string
  projectPath: string
  channelId: string
  threadId?: string
  messageId?: string
  callbackUrl?: string
  token?: string
  webhookTrigger: boolean
}): Promise<void> {
  const { sessionId, reason, projectPath, channelId, threadId, messageId, callbackUrl, token, webhookTrigger } = options
  console.log(`[Webhook] Session ${sessionId} ended (${reason})`)
  try {
    const events = sessionManager.getRunEvents(sessionId)
    const failure = detectSessionFailure(events, reason)
    const summary = extractSessionSummary(events, reason)
    const result = {
      sessionId, reason, summary: summary.slice(0, 1500), projectPath, failed: failure.failed,
      failureReason: failure.failed ? failure.reason : undefined,
    }

    const nonce = messageId ? nonceFor(`${sessionId}:${messageId}`) : undefined
    let replied = false
    if (token && (threadId || messageId)) {
      const baseUrl = process.env.C3_BASE_URL || 'http://localhost:8347'
      const content = formatSessionResult(result, baseUrl)
      const posted = await postDiscordMessage(token, threadId || channelId, content, threadId ? undefined : messageId, undefined, nonce)
      if (posted) {
        replied = true
        console.log(`[Webhook] Discord reply sent for session ${sessionId}`)
        if (threadId && shouldArchiveThread({ webhookTrigger, failed: failure.failed, summary })) {
          await archiveThread(token, threadId)
        }
      } else {
        console.error(`[Webhook] Discord reply failed for session ${sessionId}`)
      }
    }

    // The bot also receives the completion to clear its pending session.
    if (callbackUrl) {
      await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...result, replied, nonce, messageId }),
      })
    }
  } catch (err) {
    console.error(`[Webhook] Discord completion failed for session ${sessionId}:`, err)
  }
}
