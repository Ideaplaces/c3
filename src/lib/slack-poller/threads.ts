import type { SlackTrigger } from '../triggers/config.js'
import { composeThreadText } from '../discord-bot/logic.js'
import { resolveSlackToken } from '../webhooks/resolve-slack-token.js'
import { forwardToC3, getBotUserId, getMessageAuthor, markAsProcessed, slackConversationMessages } from './client.js'
import { extractFullText, oldestReportThread, repliesToForward, threadsWithNewReplies, type SlackMessage } from './logic.js'

export async function pollSlackThreads(trigger: SlackTrigger, token: string, lastReplySeen: Record<string, string>): Promise<boolean> {
  const now = Date.now()
  const oldest = oldestReportThread(now)
  const parents = await slackConversationMessages(token, 'history', {
    channel: trigger.channelId, oldest: String(oldest), limit: '100',
  })
  let changed = false
  for (const parentTs of Object.keys(lastReplySeen)) {
    if (Number(parentTs) >= oldest) continue
    delete lastReplySeen[parentTs]
    changed = true
  }
  const threads = threadsWithNewReplies(parents, lastReplySeen, now)
  if (!threads.length) return changed
  const botUserId = await getBotUserId(token)
  const readToken = trigger.slackThreadReadToken ? resolveSlackToken(trigger.slackThreadReadToken) : token
  if (!readToken) throw new Error(`No thread read token for ${trigger.name}`)

  for (const parent of threads) {
    try {
      if (!await forwardThreadReplies(trigger, token, readToken, botUserId, parent)) continue
      lastReplySeen[parent.ts] = parent.latest_reply
      changed = true
    } catch (err) {
      console.error(`[Slack Poller] Error polling ${trigger.name} thread ${parent.ts}:`, err)
    }
  }
  return changed
}

function threadText(message: SlackMessage, author: string): string {
  const files = (message.files || []).map(file => `(${author} attached a file: ${file.name || file.permalink || 'unnamed file'})`)
  return [extractFullText(message).trim(), ...files].filter(Boolean).join('\n')
}

async function forwardThreadReplies(trigger: SlackTrigger, token: string, readToken: string, botUserId: string, parent: SlackMessage): Promise<boolean> {
  const { channelId, name } = trigger
  const replies = await slackConversationMessages(readToken, 'replies', { channel: channelId, ts: parent.ts, limit: '100' })
  const history = replies.filter(message => message.thread_ts === parent.ts && message.ts !== parent.ts)
    .sort((a, b) => Number(a.ts) - Number(b.ts))
  const asLine = (message: SlackMessage) => ({
    author: message.user || 'unknown',
    isBot: Boolean(message.bot_id || message.user === botUserId || message.subtype === 'bot_message'),
    content: threadText(message, message.user || 'someone'),
  })
  for (const reply of repliesToForward(history, botUserId)) {
    if (!extractFullText(reply).trim() && !reply.files?.length) continue
    const author = await getMessageAuthor(token, reply.user)
    const followUp = threadText(reply, author)
    const result = await forwardToC3({
      channelId, channelName: name, threadTs: parent.ts, messageTs: reply.ts, author, followUp,
      message: composeThreadText(asLine(parent), history.filter(message => Number(message.ts) < Number(reply.ts)).map(asLine), author, followUp),
    })
    if (!result.ok) {
      console.log(`[Slack Poller] ${name} reply ${reply.ts} will retry (HTTP ${result.status})`)
      return false
    }
    try {
      if (!await markAsProcessed(token, channelId, reply.ts)) {
        console.error(`[Slack Poller] ${name} accepted reply ${reply.ts} but could not mark it processed`)
      }
    } catch (err) {
      console.error(`[Slack Poller] ${name} could not mark accepted reply ${reply.ts} processed:`, err)
    }
  }
  return replies.some(reply => reply.ts === parent.latest_reply)
}
