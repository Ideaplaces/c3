import { PROCESSED_REACTION, type SlackMessage } from './logic.js'

interface ConversationPage {
  ok: boolean
  error?: string
  messages?: SlackMessage[]
  response_metadata?: { next_cursor?: string }
}

async function slackGet<T>(token: string, method: string, params: Record<string, string> = {}) {
  const response = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return await response.json() as T
}

export async function slackConversationPage(token: string, method: 'history' | 'replies', params: Record<string, string>) {
  return await slackGet<ConversationPage>(token, `conversations.${method}`, params)
}

export async function slackConversationMessages(token: string, method: 'history' | 'replies', params: Record<string, string>) {
  const messages: SlackMessage[] = []
  let cursor = ''
  do {
    const page = await slackConversationPage(token, method, { ...params, ...(cursor ? { cursor } : {}) })
    if (!page.ok) throw new Error(`conversations.${method}: ${page.error}`)
    messages.push(...(page.messages || []))
    cursor = page.response_metadata?.next_cursor || ''
  } while (cursor)
  return messages
}

const botUsers = new Map<string, string>()

export async function getBotUserId(token: string): Promise<string> {
  const cached = botUsers.get(token)
  if (cached) return cached
  const data = await slackGet<{ ok: boolean; user_id?: string; error?: string }>(token, 'auth.test')
  if (!data.ok || !data.user_id) throw new Error(`auth.test: ${data.error || 'missing user_id'}`)
  botUsers.set(token, data.user_id)
  return data.user_id
}

export async function getMessageAuthor(token: string, user?: string): Promise<string> {
  if (!user) return 'bot'
  try {
    const data = await slackGet<{ ok: boolean; user?: { real_name?: string; name?: string } }>(token, 'users.info', { user })
    if (data.ok && data.user) return data.user.real_name || data.user.name || user
    return user
  } catch {
    return user
  }
}

export async function hasBeenProcessed(token: string, channel: string, timestamp: string): Promise<boolean> {
  const data = await slackGet<{ ok: boolean; message?: { reactions?: { name: string }[] } }>(token, 'reactions.get', { channel, timestamp })
  return Boolean(data.ok && data.message?.reactions?.some(reaction => reaction.name === PROCESSED_REACTION))
}

export async function markAsProcessed(token: string, channel: string, timestamp: string): Promise<boolean> {
  const response = await fetch('https://slack.com/api/reactions.add', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, timestamp, name: PROCESSED_REACTION }),
  })
  const data = await response.json() as { ok: boolean; error?: string }
  if (data.ok || data.error === 'already_reacted') return true
  console.error(`[Slack Poller] Failed to add reaction: ${data.error}`)
  return false
}

export async function forwardToC3(payload: {
  channelId: string; channelName: string; message: string; author: string; messageTs: string
  threadTs?: string; followUp?: string
}): Promise<Response> {
  const url = process.env.CCC_URL || 'http://localhost:8347'
  return await fetch(`${url}/api/webhooks/slack`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.CCC_WEBHOOK_SECRET || ''}`,
    },
    body: JSON.stringify(payload),
  })
}
