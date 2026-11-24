import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { threadsFile } from './discord-threads'
import { postSlackReportMessage, SlackApiError } from './slack-message'

export interface SlackDelivery {
  fingerprint: string
  ts?: string
  permalink?: string
  chunksPosted: number
  sending?: boolean
}

export function slackDeliveryFile(): string {
  return join(dirname(threadsFile()), 'slack-reports.json')
}

export function deliveryDigest(values: string[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex')
}

function readDeliveries(file: string): Record<string, SlackDelivery> {
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
}

export function readSlackDelivery(file: string, key: string): SlackDelivery | undefined {
  return readDeliveries(file)[key]
}

export function saveSlackDelivery(file: string, key: string, state: SlackDelivery): void {
  const deliveries = readDeliveries(file)
  deliveries[key] = state
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, `${JSON.stringify(deliveries, null, 1)}\n`)
  renameSync(tmp, file)
}

/** Reserve the write before Slack sees it. A missing receipt may mean Slack accepted it. */
export async function sendSlackDeliveryPart(options: {
  file: string; key: string; state: SlackDelivery; token: string; channelId: string; text: string; threadTs?: string
}): Promise<string> {
  const { file, key, state, token, channelId, text, threadTs } = options
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
      saveSlackDelivery(file, key, state)
    }
    throw err
  }
  state.sending = false
  saveSlackDelivery(file, key, state)
  return ts
}
