import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { sessionManager } from '@/lib/sdk/session-manager'
import { loadPromptTemplate, type SlackTrigger } from '@/lib/triggers/config'
import { recordSlackThreadReply, sessionForThread } from './discord-threads'
import { detectSessionFailure } from './failure-detector'
import { resolveSlackToken } from './resolve-slack-token'
import { deliveryDigest, readSlackDelivery, sendSlackDeliveryPart, slackDeliveryFile } from './slack-delivery'
import { formatSlackReport, SlackApiError, slackReportChunks, slackThreadKey } from './slack-message'
import { extractSessionSummary, resumeOrStart, withThreadLock } from './thread-session'

interface SlackThreadReply {
  threadTs: string
  messageTs?: string
  message: string
  author?: string
  followUp: string
}

export async function handleSlackThreadReply(trigger: SlackTrigger, reply: SlackThreadReply): Promise<Response> {
  const { threadTs, messageTs, message, author, followUp } = reply
  const { channelId } = trigger
  const key = slackThreadKey(channelId, threadTs)

  async function handle() {
    const existing = sessionForThread(key)
    const accepted = messageTs && existing?.trigger === trigger.name && existing.slackReplies?.[messageTs]
    if (accepted) {
      return Response.json({ ...accepted, trigger: trigger.name })
    }

    const token = resolveSlackToken(trigger.slackBotToken)
    if (!token) return Response.json({ error: 'missing_slack_token' }, { status: 502 })
    const startId = randomUUID()

    const result = await resumeOrStart({
      key, trigger, platform: 'Slack', author: author || 'someone', reply: followUp, startId,
      prompt: () => [
        loadPromptTemplate(trigger.prompt, {
          message, author: author || 'unknown', channel: trigger.name, channelId, threadTs,
          messageTs: messageTs || '', sessionId: startId, sessionUrl: '', resumeCommand: '',
          timestamp: new Date().toISOString(),
        }),
        'Answer the Slack thread in your final message. C3 will deliver it. Keep session URLs out of the answer.',
      ].join('\n\n'),
      onEnded: (id, reason) => void postAnswer(token, channelId, threadTs, messageTs || startId, id, reason),
    })
    const { sessionId, status } = result
    if (status === 'busy') return Response.json({ ...result, trigger: trigger.name }, { status: 409 })
    if (messageTs) recordSlackThreadReply(key, trigger.name, messageTs, { sessionId, status }, existing)
    return Response.json({ ...result, trigger: trigger.name })
  }

  return await withThreadLock(key, handle, () => Response.json({ trigger: trigger.name, status: 'busy' }, { status: 409 }))
}

async function postAnswer(token: string, channelId: string, threadTs: string, replyId: string, sessionId: string, reason: string) {
  try {
    const events = sessionManager.getRunEvents(sessionId)
    const failure = detectSessionFailure(events, reason)
    const summary = failure.failed ? `**Agent session failed**\n\n${failure.reason}` : extractSessionSummary(events, reason, 12000)
    const chunks = slackReportChunks(formatSlackReport(summary) || 'Session completed.')
    const file = slackDeliveryFile()
    const key = deliveryDigest(['answer', channelId, threadTs, replyId])
    const fingerprint = deliveryDigest(chunks)
    const state = readSlackDelivery(file, key) ?? { fingerprint, chunksPosted: 0 }
    if (state.fingerprint !== fingerprint) throw new Error('Slack answer changed after its first delivery attempt')
    for (const text of chunks.slice(state.chunksPosted)) {
      await sendAnswerPart({ file, key, state, token, channelId, text, threadTs })
    }
    console.log(`[Slack Webhook] Delivered session ${sessionId} answer in ${channelId}:${threadTs}`)
  } catch (err) {
    console.error(`[Slack Webhook] Thread answer failed for session ${sessionId} in ${channelId}:${threadTs}:`, err)
  }
}

async function sendAnswerPart(part: Parameters<typeof sendSlackDeliveryPart>[0]) {
  try {
    await sendSlackDeliveryPart(part)
  } catch (err) {
    if (!(err instanceof SlackApiError) || err.retryAfterMs === undefined || err.retryAfterMs > 60_000) throw err
    if (err.retryAfterMs > 0) await delay(err.retryAfterMs)
    await sendSlackDeliveryPart(part)
  }
}
