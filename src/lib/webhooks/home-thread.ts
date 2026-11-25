import { sessionManager } from '@/lib/sdk/session-manager'
import { getCronTrigger, getSlackTriggerByName } from '@/lib/triggers/config'
import { runningCronSession } from '@/lib/triggers/fire'
import { nonceFor, postDiscordMessage } from './discord-mirror'
import { isHomeThreadLabel, linkThread, recordHomeThreadReply, sessionForThread, type ThreadLink } from './discord-threads'
import { resumeOnly, withThreadLock } from './thread-session'

export function linkHomeThread(messageId: string, sessionId: string, label: `cron:${string}` | `slack:${string}`): 'linked' | 'already' | 'conflict' {
  const existing = sessionForThread(messageId)
  if (existing && isHomeThreadLabel(existing.trigger)) {
    if (existing.sessionId === sessionId) return 'already'
    console.warn(`[Discord Home Thread] Refused to relink ${messageId} from ${existing.sessionId} to ${sessionId}`)
    return 'conflict'
  }
  linkThread(messageId, sessionId, label)
  console.log(`[Discord Home Thread] Linked ${messageId} to ${sessionId} (${label})`)
  return 'linked'
}

export async function handleHomeReply(options: {
  threadId: string
  link: ThreadLink
  messageId: string
  reply: string
  author: string
  token?: string
  onEnded: (sessionId: string, reason: string, projectPath: string) => void
}): Promise<Response> {
  const { threadId, link, messageId, reply, author, token, onEnded } = options
  const { sessionId, trigger: label } = link
  const busy = () => Response.json({ status: 'busy', sessionId, trigger: label }, { status: 409 })

  return await withThreadLock(threadId, async () => {
    const receipt = link.discordReplies?.[messageId]
    if (receipt === 'resumed') return Response.json({ status: 'already' })
    if (receipt === 'pending') {
      if (sessionManager.isSessionActive(sessionId)) return busy()
      return Response.json({ error: 'Previous reply delivery is unknown' }, { status: 503 })
    }

    const name = label.slice(label.indexOf(':') + 1)
    const isCron = label.startsWith('cron:')
    const trigger = isCron ? getCronTrigger(name) : getSlackTriggerByName(name)
    let status: Awaited<ReturnType<typeof resumeOnly>>
    let recorded = false
    try {
      status = await resumeOnly({
        link, author, reply, model: trigger?.model, maxDurationMs: trigger?.maxDurationMs, onEnded,
        isTriggerBusy: () => isCron && Boolean(runningCronSession(label)),
        beforeResume: () => {
          recordHomeThreadReply(threadId, link, messageId, 'pending')
          recorded = true
        },
      })
    } catch (err) {
      console.error(`[Discord Home Thread] Could not resume ${sessionId} in ${threadId}:`, err)
      if (recorded && !sessionManager.isSessionActive(sessionId)) {
        try {
          recordHomeThreadReply(threadId, link, messageId)
        } catch (writeError) {
          console.error(`[Discord Home Thread] Could not clear the receipt for ${messageId}:`, writeError)
        }
      }
      return Response.json({ error: 'Could not resume the report session' }, { status: 502 })
    }
    if (status === 'busy') return busy()
    if (status === 'unavailable') {
      const baseUrl = (process.env.C3_BASE_URL || 'http://localhost:8347').replace(/\/$/, '')
      const note = `This report's session can no longer be resumed from Discord. View the original session: ${baseUrl}/sessions/${sessionId}`
      const posted = token && await postDiscordMessage(token, threadId, note, undefined, undefined,
        nonceFor(`${threadId}:${messageId}:unavailable`))
      if (!posted) {
        console.error(`[Discord Home Thread] Could not post the unavailable-session note in ${threadId}`)
        return Response.json({ error: 'Could not post the session link in Discord' }, { status: 502 })
      }
      return Response.json({ status })
    }
    try {
      recordHomeThreadReply(threadId, link, messageId, 'resumed')
    } catch (err) {
      console.error(`[Discord Home Thread] Could not confirm the receipt for ${messageId}:`, err)
    }
    console.log(`[Discord Home Thread] Resumed ${sessionId} in ${threadId} (${label})`)
    return Response.json({ status, sessionId, trigger: label })
  }, busy)
}
