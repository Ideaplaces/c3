import { join } from 'path'
import { postDiscordMessage } from '@/lib/webhooks/discord-mirror'
import { appendUsage, formatOutlier, isOutlier, readUsage, recordFromResult } from './ledger'

const HOME = process.env.HOME || '/tmp'

export function usageLedgerPath(): string {
  const dir = process.env.C3_CONFIG_DIR || join(HOME, '.c3')
  return join(dir, 'state', 'usage.jsonl')
}

/** Where outlier lines go: the same channel as the weekly cloud-cost report. */
export const USAGE_CHANNEL_ID = process.env.C3_USAGE_CHANNEL_ID || '1492594841266294835'

/**
 * Record a finished session. Best effort by design: a ledger failure must
 * never break session handling, and Discord is only asked for outliers.
 */
export async function recordSessionUsage(
  result: Parameters<typeof recordFromResult>[0],
  meta: Parameters<typeof recordFromResult>[1],
): Promise<void> {
  try {
    const file = usageLedgerPath()
    const record = recordFromResult(result, meta)
    const history = readUsage(file)
    appendUsage(file, record)
    const verdict = isOutlier(record, history)
    console.log(
      `[Usage] ${record.label}: ${record.turns} turns, ${record.contextTokens} context tokens, ` +
        `$${record.costUsd.toFixed(2)}${verdict.outlier ? ' OUTLIER' : ''}`,
    )
    if (!verdict.outlier) return
    const token = process.env.DISCORD_BOT_TOKEN
    if (!token) {
      console.warn('[Usage] outlier detected but DISCORD_BOT_TOKEN is unset; not posted')
      return
    }
    await postDiscordMessage(token, USAGE_CHANNEL_ID, formatOutlier(record, verdict))
  } catch (err) {
    console.error('[Usage] could not record session usage:', err)
  }
}
