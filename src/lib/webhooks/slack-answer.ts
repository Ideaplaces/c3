import { dirname, join } from 'node:path'
import { readSessionJSONL } from '@/lib/claude-sessions/reader'
import { getSessionJSONLPath } from '@/lib/claude-sessions/scanner'
import { sessionManager } from '@/lib/sdk/session-manager'
import { getSession } from '@/lib/store/sessions'
import { getSlackTrigger, type SlackTrigger } from '@/lib/triggers/config'
import { detectSessionFailure, type BufferedSessionEvent } from './failure-detector'
import { resolveSlackToken } from './resolve-slack-token'
import {
  deliveryDigest, readSlackDeliveries, saveSlackDelivery, sendSlackDeliveryPart, slackDeliveryFile,
  writeSlackDeliveries, type SlackDelivery,
} from './slack-delivery'
import { formatSlackReport, SlackApiError, slackReportChunks } from './slack-message'
import { extractSessionSummary } from './thread-session'

interface SlackAnswer extends SlackDelivery {
  sessionId: string
  status: 'started' | 'resumed'
  trigger: string
  channelId: string
  threadTs: string
  replyId: string
  createdAt: number
  chunks?: string[]
  delivered?: boolean
  unknownLogged?: boolean
}

const POLL_INTERVAL_MS = 15_000
const DEFAULT_RETRY_MS = 60_000

// The custom server and the Next.js route run in separate module graphs in the same process.
const shared = globalThis as typeof globalThis & { c3SlackAnswersInFlight?: Map<string, Promise<void>> }
const inFlight = shared.c3SlackAnswersInFlight ??= new Map()

function slackAnswerFile(): string {
  return join(dirname(slackDeliveryFile()), 'slack-answers.json')
}

export function slackAnswerKey(channelId: string, threadTs: string, replyId: string): string {
  return deliveryDigest(['answer', channelId, threadTs, replyId])
}

export function slackAnswersForThread(trigger: Pick<SlackTrigger, 'name' | 'channelId'>, threadTs: string): SlackAnswer[] {
  return Object.values(readSlackDeliveries<SlackAnswer>(slackAnswerFile())).filter(answer =>
    answer.trigger === trigger.name && answer.channelId === trigger.channelId && answer.threadTs === threadTs,
  )
}

export function queueSlackAnswer(key: string, prompt: string, reply: Pick<
  SlackAnswer, 'sessionId' | 'status' | 'trigger' | 'channelId' | 'threadTs' | 'replyId'
>): void {
  const state: SlackAnswer = { ...reply, fingerprint: deliveryDigest([prompt]), createdAt: Date.now(), chunksPosted: 0 }
  saveSlackDelivery(slackAnswerFile(), key, state)
}

export function discardRejectedSlackAnswer(key: string): void {
  try {
    const file = slackAnswerFile()
    const answers = readSlackDeliveries<SlackAnswer>(file)
    const answer = answers[key]
    if (!answer || answer.chunks || answer.delivered) return
    delete answers[key]
    writeSlackDeliveries(file, answers)
  } catch (err) {
    console.error(`[Slack Answer] Could not discard rejected launch for ${key}:`, err)
  }
}

interface TranscriptMessage {
  type?: string
  timestamp?: string
  isSidechain?: boolean
  isMeta?: boolean
  isCompactSummary?: boolean
  is_error?: boolean
  errors?: string[]
  message?: { content?: unknown; stop_reason?: string }
}

function userPrompt(event: TranscriptMessage): string | undefined {
  if (event.type !== 'user' || event.isSidechain || event.isMeta || event.isCompactSummary) return
  const content = event.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content) && content.every(part => part.type === 'text')) {
    return content.map(part => part.text).join('')
  }
}

function recoverTurn(answer: SlackAnswer): { events: BufferedSessionEvent[]; reason: string } {
  const path = getSessionJSONLPath(answer.sessionId)
  const transcript = path ? readSessionJSONL(path) : []
  const start = transcript.findIndex(({ message }) => {
    const entry = message as TranscriptMessage
    const prompt = userPrompt(entry)
    return prompt !== undefined && Date.parse(entry.timestamp || '') >= answer.createdAt
      && deliveryDigest([prompt]) === answer.fingerprint
  })
  const interrupted = 'Session interrupted before completing this Slack reply'
  if (start < 0) return { events: [], reason: interrupted }

  const next = transcript.findIndex(({ message }, i) => i > start && userPrompt(message as TranscriptMessage) !== undefined)
  const events = transcript.slice(start + 1, next < 0 ? undefined : next)
    .filter(({ message }) => !(message as TranscriptMessage).isSidechain)
  const meta = next < 0 ? getSession(answer.sessionId) : undefined
  const currentRun = meta && (!meta.lastPrompt || deliveryDigest([meta.lastPrompt]) === answer.fingerprint)
  if (currentRun && meta.status === 'error') return { events, reason: meta.errorMessage || 'Session failed' }

  const messages = events.map(({ message }) => message as TranscriptMessage)
  const result = messages.findLast(message => message.type === 'result')
  if (result?.is_error) return { events, reason: result.errors?.join('\n') || 'Session failed' }
  const lastAssistant = messages.findLast(message => message.type === 'assistant')
  const complete = (currentRun && (meta.status === 'completed' || meta.status === 'idle'))
    || result?.is_error === false || lastAssistant?.message?.stop_reason === 'end_turn'
  return { events, reason: complete ? 'completed' : interrupted }
}

async function attemptDelivery(
  file: string, key: string, live?: { trigger: SlackTrigger; reason: string },
): Promise<void> {
  try {
    const answer = readSlackDeliveries<SlackAnswer>(file)[key]
    if (!answer || answer.delivered || (answer.retryAt ?? 0) > Date.now()) return
    if (answer.sending) {
      if (!answer.unknownLogged) {
        console.error(`[Slack Answer] Slack delivery unknown for ${answer.channelId}:${answer.threadTs} reply ${answer.replyId}`)
        answer.unknownLogged = true
        saveSlackDelivery(file, key, answer)
      }
      return
    }
    if (!answer.chunks && !live && sessionManager.isSessionActive(answer.sessionId)) return
    const trigger = live?.trigger ?? getSlackTrigger(answer.channelId)
    if (!trigger || trigger.name !== answer.trigger) {
      console.error(`[Slack Answer] Trigger ${answer.trigger} unavailable for reply ${answer.replyId}`)
      return
    }

    if (!answer.chunks) {
      const run = live
        ? { events: sessionManager.getRunEvents(answer.sessionId), reason: live.reason }
        : recoverTurn(answer)
      const meta = live && getSession(answer.sessionId)
      const reason = meta && meta.status === 'error' && run.reason === 'completed'
        ? meta.errorMessage || 'Session failed'
        : run.reason
      const failure = detectSessionFailure(run.events, reason)
      const summary = failure.failed
        ? `**Agent session failed**\n\n${failure.reason}`
        : extractSessionSummary(run.events, reason, 12_000)
      answer.chunks = slackReportChunks(formatSlackReport(summary, trigger) || 'Session completed.')
      saveSlackDelivery(file, key, answer)
    }

    const token = resolveSlackToken(trigger.slackBotToken)
    if (!token) {
      console.error(`[Slack Answer] Missing bot token for ${answer.trigger} reply ${answer.replyId}`)
      return
    }
    const { channelId, threadTs } = answer
    for (const text of answer.chunks.slice(answer.chunksPosted)) {
      const part = { file, key, state: answer, token, channelId, threadTs, text, retryDelayMs: DEFAULT_RETRY_MS }
      try {
        await sendSlackDeliveryPart(part)
      } catch (err) {
        if (!(err instanceof SlackApiError) || err.retryAfterMs !== 0) throw err
        await sendSlackDeliveryPart(part)
      }
    }
    answer.delivered = true
    delete answer.chunks
    saveSlackDelivery(file, key, answer)
    console.log(`[Slack Answer] Delivered session ${answer.sessionId} answer to ${channelId}:${threadTs} for ${answer.replyId}`)
  } catch (err) {
    console.error(`[Slack Answer] Delivery failed for ${key}:`, err)
  }
}

async function deliverAnswer(file: string, key: string, live?: { trigger: SlackTrigger; reason: string }): Promise<void> {
  const lock = `${file}:${key}`
  const previous = inFlight.get(lock)
  if (previous) return await previous
  const attempt = attemptDelivery(file, key, live)
  inFlight.set(lock, attempt)
  try {
    await attempt
  } finally {
    inFlight.delete(lock)
  }
}

export function finishSlackAnswer(key: string, trigger: SlackTrigger, reason: string): void {
  void deliverAnswer(slackAnswerFile(), key, { trigger, reason })
}

export async function drainSlackAnswers(): Promise<void> {
  try {
    const file = slackAnswerFile()
    const pending = Object.entries(readSlackDeliveries<SlackAnswer>(file, true))
      .filter(([, answer]) => !answer.delivered && (answer.chunks || !sessionManager.isSessionActive(answer.sessionId)))
    await Promise.all(pending.map(([key]) => deliverAnswer(file, key)))
  } catch (err) {
    console.error('[Slack Answer] Could not read pending answers:', err)
  }
}

export function startSlackAnswerRecovery(): void {
  void drainSlackAnswers()
  setInterval(() => void drainSlackAnswers(), POLL_INTERVAL_MS).unref()
}
