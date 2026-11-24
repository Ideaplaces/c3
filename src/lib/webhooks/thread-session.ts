import { getSessionJSONLPath } from '@/lib/claude-sessions/scanner'
import { DEFAULT_MODEL } from '@/lib/models'
import { sessionManager } from '@/lib/sdk/session-manager'
import { getSession } from '@/lib/store/sessions'
import type { ChannelTrigger } from '@/lib/triggers/config'
import { followUpPrompt, linkThread, sessionForThread } from './discord-threads'

const busyThreads = new Set<string>()

/** Reserve the thread through precheck, session start or resume, and callback registration. */
export async function withThreadLock<T>(key: string | null, handle: () => Promise<T>, onBusy: () => T): Promise<T> {
  if (!key) return await handle()
  if (busyThreads.has(key)) return onBusy()
  busyThreads.add(key)
  try {
    return await handle()
  } finally {
    busyThreads.delete(key)
  }
}

export function resolveResumable(key: string, triggerName: string): string | null {
  const linked = sessionForThread(key)
  if (!linked || linked.trigger !== triggerName) return null
  const { sessionId } = linked
  // A live cron session can post its Slack report before its transcript is on disk.
  if (key.startsWith('slack:') && sessionManager.isSessionActive(sessionId)) return sessionId
  return getSession(sessionId) && getSessionJSONLPath(sessionId) ? sessionId : null
}

type SessionEndListener = (sessionId: string, reason: string) => void

export async function resumeOrStart(options: {
  key: string | null
  trigger: ChannelTrigger
  platform: 'Discord' | 'Slack'
  author: string
  reply?: string | null
  prompt: string | (() => string)
  startId?: string
  onEnded?: SessionEndListener
}): Promise<{ sessionId: string; status: 'busy' | 'resumed' | 'started' }> {
  const { key, trigger, platform, author, reply, prompt, startId, onEnded } = options
  const resumable = key && reply ? resolveResumable(key, trigger.name) : null
  if (resumable && sessionManager.isSessionActive(resumable)) return { sessionId: resumable, status: 'busy' }

  const label = `${platform.toLowerCase()}:${trigger.name}`
  const runOptions = { label, model: trigger.model || DEFAULT_MODEL, maxDurationMs: trigger.maxDurationMs }
  const expectedId = resumable || startId
  const onSessionEnded: SessionEndListener = (sessionId, reason) => {
    if (sessionId !== expectedId) return
    sessionManager.removeListener('session_ended', onSessionEnded)
    onEnded?.(sessionId, reason)
  }
  if (onEnded) sessionManager.on('session_ended', onSessionEnded)
  try {
    if (resumable && reply) {
      await sessionManager.resumeSession(resumable, followUpPrompt(author, reply, platform), runOptions)
      console.log(`[Webhook] Resumed session ${resumable} for a reply in thread ${key} ("${trigger.name}")`)
      return { sessionId: resumable, status: 'resumed' }
    }

    const sessionId = await sessionManager.startSession({
      ...runOptions,
      ...(startId ? { sessionId: startId } : {}),
      projectPath: trigger.projectPath,
      prompt: typeof prompt === 'function' ? prompt() : prompt,
      permissionMode: trigger.permissionMode || 'bypassPermissions',
    })
    if (key) linkThread(key, sessionId, trigger.name)
    console.log(`[Webhook] Started session ${sessionId} for trigger "${trigger.name}"`)
    return { sessionId, status: 'started' }
  } catch (err) {
    if (onEnded) sessionManager.removeListener('session_ended', onSessionEnded)
    throw err
  }
}

export function extractSessionSummary(events: { message: unknown }[], reason: string, maxChars: number): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const msg = events[i].message as { type?: string; message?: { content?: unknown } }
    if (msg.type !== 'assistant' || !msg.message) continue
    const { content } = msg.message
    if (typeof content === 'string' && content) return content.slice(0, maxChars)
    if (Array.isArray(content)) {
      const text = content.filter(part => part.type === 'text').map(part => part.text).join('\n')
      if (text) return text.slice(0, maxChars)
    }
  }
  return `Session completed (${reason})`
}
