import { postDiscordMessage } from '@/lib/webhooks/discord-mirror'
import { linkThread } from '@/lib/webhooks/discord-threads'
import { getInboxConfig } from './config'
import { mirrorToInbox, type MirrorDeps, type MirrorInput, type MirrorResult } from './mirror'

/** Seven days: an ask Chip has not answered in a week is still findable without unarchiving. */
const THREAD_ARCHIVE_MINUTES = 10080
/** Discord's "a thread has already been created for this message": the earlier attempt worked. */
const THREAD_EXISTS = 160004

const names = new Map<string, string>()

export function discordInboxDeps(token = process.env.DISCORD_BOT_TOKEN || ''): MirrorDeps {
  const headers = { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' }
  return {
    post: (channelId, content, nonce) => postDiscordMessage(token, channelId, content, undefined, undefined, nonce),
    openThread: async (channelId, messageId, name) => {
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ name, auto_archive_duration: THREAD_ARCHIVE_MINUTES }),
        })
        if (res.ok) return true
        const body = (await res.json().catch(() => ({}))) as { code?: number }
        return body.code === THREAD_EXISTS
      } catch (err) {
        console.error(`[Inbox] Thread on ${messageId} failed:`, err)
        return false
      }
    },
    channelName: async (channelId) => {
      const known = names.get(channelId)
      if (known) return known
      try {
        const res = await fetch(`https://discord.com/api/v10/channels/${channelId}`, { headers })
        const data = (await res.json()) as { name?: string }
        if (res.ok && data.name) {
          names.set(channelId, data.name)
          return data.name
        }
      } catch (err) {
        console.error(`[Inbox] Name of channel ${channelId} unknown:`, err)
      }
      return channelId
    },
    link: (threadId, sessionId, trigger) => linkThread(threadId, sessionId, trigger),
    now: () => new Date(),
  }
}

/**
 * The server's own posts (a session's completion, an investigation report) go through here. The
 * report has already landed, so a failure to copy it is logged and never thrown at the caller.
 */
export async function mirrorPostToInbox(input: MirrorInput): Promise<MirrorResult> {
  try {
    const result = await mirrorToInbox(input, getInboxConfig(), discordInboxDeps())
    if (result.status === 'posted' || result.status === 'failed') {
      console.log(`[Inbox] ${input.sourceMessageId}: ${result.status}`)
    }
    return result
  } catch (err) {
    console.error(`[Inbox] Copy of ${input.sourceMessageId} failed:`, err)
    return { status: 'failed', reason: String(err) }
  }
}
