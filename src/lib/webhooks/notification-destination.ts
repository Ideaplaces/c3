/**
 * Where C3's own session notifications (start, completion, failure) go.
 *
 * Triggers on shared alert channels run with `replyInThread: false`: the team
 * sees only the original alert, and the agent DMs its findings. C3's failure
 * notice used to ignore that and post into the alert channel thread anyway,
 * which put "Agent session failed" in front of the whole team. When a trigger
 * opts out of thread replies and names a user, every C3 notification for that
 * trigger goes to that user's DM instead.
 *
 * The thread fallback (no notifyUserId) is deliberate: a silent agent crash
 * must never go unseen, so with nowhere else to send it the notice still
 * lands in the thread.
 */
export type NotificationDestination =
  | { kind: 'thread' }
  | { kind: 'dm'; userId: string }

export function resolveNotificationDestination(opts: {
  replyInThread: boolean
  notifyUserId?: string
}): NotificationDestination {
  if (!opts.replyInThread && opts.notifyUserId) {
    return { kind: 'dm', userId: opts.notifyUserId }
  }
  return { kind: 'thread' }
}

/**
 * Open (or reuse) the IM channel with a user and return its channel ID.
 * Returns null when Slack refuses, so callers can fall back.
 */
export async function openDirectMessageChannel(
  botToken: string,
  userId: string,
): Promise<string | null> {
  try {
    const res = await fetch('https://slack.com/api/conversations.open', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ users: userId }),
    })
    const data = (await res.json()) as Record<string, unknown>
    if (!data.ok) {
      console.error(`[Slack Webhook] conversations.open failed for ${userId}:`, data.error)
      return null
    }
    const channel = data.channel as Record<string, unknown> | undefined
    const id = channel?.id
    return typeof id === 'string' ? id : null
  } catch (err) {
    console.error(`[Slack Webhook] conversations.open error for ${userId}:`, err)
    return null
  }
}
