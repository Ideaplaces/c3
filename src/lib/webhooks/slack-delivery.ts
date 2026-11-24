import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { threadsFile } from './discord-threads'
import { postSlackReportMessage, SlackApiError } from './slack-message'

export interface SlackDelivery {
  fingerprint: string
  ts?: string
  permalink?: string
  chunksPosted: number
  sending?: boolean
  createdAt?: number
  updatedAt?: number
  retryAt?: number
}

const DELIVERY_RETENTION_MS = 30 * 86_400_000

export function slackDeliveryFile(): string {
  return join(dirname(threadsFile()), 'slack-reports.json')
}

export function deliveryDigest(values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

export function readSlackDeliveries<T extends SlackDelivery = SlackDelivery>(file: string, prune = false): Record<string, T> {
  try {
    const values = JSON.parse(readFileSync(file, 'utf-8'))
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Invalid Slack delivery ledger')
    const now = Date.now()
    const legacyTimestamp = Object.values(values).some(state => (state as T).updatedAt === undefined)
      ? statSync(file).mtimeMs
      : now
    const entries = Object.entries(values)
    const retained = entries.flatMap(([key, value]): [string, T][] => {
      const state = value as T
      state.updatedAt ??= legacyTimestamp
      return (state.createdAt ?? state.updatedAt) >= now - DELIVERY_RETENTION_MS ? [[key, state]] : []
    })
    const deliveries = Object.fromEntries(retained)
    if (prune && retained.length < entries.length) writeSlackDeliveries(file, deliveries)
    return deliveries
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

export function readSlackDelivery<T extends SlackDelivery = SlackDelivery>(file: string, key: string): T | undefined {
  return readSlackDeliveries<T>(file)[key]
}

export function saveSlackDelivery(file: string, key: string, state: SlackDelivery): void {
  const deliveries = readSlackDeliveries(file)
  state.updatedAt = Date.now()
  deliveries[key] = state
  writeSlackDeliveries(file, deliveries)
}

export function writeSlackDeliveries(file: string, deliveries: Record<string, SlackDelivery>): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(deliveries, null, 1)}\n`)
  renameSync(tmp, file)
}

/** Reserve the write before Slack sees it. A missing receipt may mean Slack accepted it. */
export async function sendSlackDeliveryPart(options: {
  file: string; key: string; state: SlackDelivery; token: string; channelId: string; text: string; threadTs?: string
  retryDelayMs?: number
}): Promise<string> {
  const { file, key, state, token, channelId, text, threadTs, retryDelayMs } = options
  if (state.sending) throw new SlackApiError('slack_delivery_unknown', true)
  state.sending = true
  saveSlackDelivery(file, key, state)
  let ts: string
  try {
    ts = await postSlackReportMessage(token, channelId, text, threadTs)
    if (threadTs) state.chunksPosted++
    else state.ts = ts
  } catch (err) {
    if (err instanceof SlackApiError && !err.deliveryUnknown) {
      state.sending = false
      if (retryDelayMs !== undefined) state.retryAt = Date.now() + (err.retryAfterMs ?? retryDelayMs)
      saveSlackDelivery(file, key, state)
    }
    throw err
  }
  state.sending = false
  delete state.retryAt
  saveSlackDelivery(file, key, state)
  return ts
}
