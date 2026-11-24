import { sessionManager } from '@/lib/sdk/session-manager'
import type { SlackTrigger } from '@/lib/triggers/config'
import { linkThread } from './discord-threads'
import { resolveSlackToken } from './resolve-slack-token'
import {
  deliveryDigest, readSlackDelivery, saveSlackDelivery, sendSlackDeliveryPart, slackDeliveryFile, type SlackDelivery,
} from './slack-delivery'
import {
  formatSlackReport, getSlackReportPermalink, SlackApiError, slackReportChunks, slackThreadKey,
} from './slack-message'
import { withThreadLock } from './thread-session'

export interface SlackReport {
  trigger: string
  sessionId: string
  head: string
  body?: string
  idempotencyKey: string
}

interface ReportDelivery extends SlackDelivery {
  linked?: boolean
  formatted?: { head: string; chunks: string[] }
}

type Result = { status: 200; body: { ts: string; permalink: string } }
  | { status: number; body: { error: string } }

const inFlight = new Map<string, { fingerprint: string; result: Promise<Result> }>()
const conflict: Result = { status: 409, body: { error: 'idempotency_key_conflict' } }

export async function publishSlackReport(trigger: SlackTrigger, report: SlackReport): Promise<Result> {
  const file = slackDeliveryFile()
  const key = deliveryDigest(['report', trigger.channelId, report.idempotencyKey])
  const fingerprint = deliveryDigest([trigger.name, report.sessionId, report.head, report.body || ''])
  const inFlightKey = `${file}:${key}`
  const previous = inFlight.get(inFlightKey)
  if (previous) return previous.fingerprint === fingerprint ? await previous.result : conflict

  const result = publish(file, key, fingerprint, trigger, report)
  inFlight.set(inFlightKey, { fingerprint, result })
  try {
    return await result
  } finally {
    inFlight.delete(inFlightKey)
  }
}

async function publish(file: string, key: string, fingerprint: string, trigger: SlackTrigger, report: SlackReport): Promise<Result> {
  const saved = readSlackDelivery<ReportDelivery>(file, key)
  const state: ReportDelivery = saved ?? { fingerprint, chunksPosted: 0 }
  if (state.fingerprint !== fingerprint) return conflict
  if (state.ts && state.permalink) return { status: 200, body: { ts: state.ts, permalink: state.permalink } }
  if (state.sending || (state.chunksPosted > 0 && !state.formatted)) {
    return { status: 502, body: { error: 'slack_delivery_unknown' } }
  }

  if (!saved) {
    // A live run of a cron trigger or of a Slack trigger (an alert channel) on the allowlist, never
    // a session of the destination itself.
    const agent = /^(?:cron|slack):(.+)$/.exec(sessionManager.getActiveSession(report.sessionId)?.label ?? '')?.[1]
    if (!agent || agent === trigger.name || !Array.isArray(trigger.reportAgents) || !trigger.reportAgents.includes(agent)) {
      console.warn(`[Slack Report] Session ${report.sessionId} cannot report to ${trigger.name}`)
      return { status: 403, body: { error: 'Session is not an allowed live run' } }
    }
  }

  const token = resolveSlackToken(trigger.slackBotToken)
  if (!token) return { status: 502, body: { error: 'missing_slack_token' } }

  const head = state.formatted?.head ?? formatSlackReport(report.head, trigger)
  if (!head || head.length > 4000) return { status: 400, body: { error: 'Report head must be 1 to 4000 formatted characters' } }
  const chunks = state.formatted?.chunks ?? slackReportChunks(formatSlackReport(report.body || '', trigger))
  state.formatted = { head, chunks }
  const { channelId } = trigger
  const delivery = { file, key, state, token, channelId }

  try {
    const ts = state.ts || await sendSlackDeliveryPart({ ...delivery, text: head })
    const threadKey = slackThreadKey(channelId, ts)
    async function finishReport(): Promise<Result> {
      if (!state.linked) {
        linkThread(threadKey, report.sessionId, trigger.name)
        state.linked = true
        saveSlackDelivery(file, key, state)
      }
      for (const text of chunks.slice(state.chunksPosted)) {
        await sendSlackDeliveryPart({ ...delivery, text, threadTs: ts })
      }
      const permalink = await getSlackReportPermalink(delivery.token, channelId, ts)
      state.permalink = permalink
      delete state.formatted
      saveSlackDelivery(file, key, state)
      console.log(`[Slack Report] Posted ${trigger.name} for session ${report.sessionId} in ${channelId}:${ts}`)
      return { status: 200, body: { ts, permalink } }
    }
    return await withThreadLock(threadKey, finishReport, () => ({ status: 409, body: { error: 'thread_busy' } }))
  } catch (err) {
    if (!(err instanceof SlackApiError)) throw err
    console.error(`[Slack Report] Slack refused or did not confirm ${trigger.name} for ${report.sessionId}: ${err.message}`)
    return { status: 502, body: { error: state.sending ? 'slack_delivery_unknown' : err.message } }
  }
}
