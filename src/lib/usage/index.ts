import { join } from 'path'
import { postDiscordMessage } from '@/lib/webhooks/discord-mirror'
import {
  addTurn,
  alertThreshold,
  appendUsage,
  baselineFor,
  formatOutlier,
  formatRunningAlert,
  formatRunningClose,
  isOutlier,
  newRunning,
  readUsage,
  recordFromResult,
  shouldAlert,
  type Baseline,
  type RunningUsage,
} from './ledger'

const HOME = process.env.HOME || '/tmp'

export function usageLedgerPath(): string {
  const dir = process.env.C3_CONFIG_DIR || join(HOME, '.c3')
  return join(dir, 'state', 'usage.jsonl')
}

/** Where alerts and outliers go: the same channel as the weekly cloud-cost report. */
export const USAGE_CHANNEL_ID = process.env.C3_USAGE_CHANNEL_ID || '1492594841266294835'

function sessionUrl(sessionId: string): string {
  const base = (process.env.C3_BASE_URL || 'http://localhost:8347').replace(/\/$/, '')
  return `${base}/sessions/${sessionId}`
}

async function post(text: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN
  if (!token) {
    console.warn('[Usage] alert not posted, DISCORD_BOT_TOKEN is unset:', text)
    return
  }
  await postDiscordMessage(token, USAGE_CHANNEL_ID, text)
}

interface Tracked {
  label: string
  baseline: Baseline
  threshold: number
  state: RunningUsage
}

const tracked = new Map<string, Tracked>()

/** Called once per session start. Reads the ledger for the trigger's baseline. */
export function startUsageTracking(sessionId: string, label: string): void {
  try {
    const baseline = baselineFor(label, readUsage(usageLedgerPath()))
    tracked.set(sessionId, { label, baseline, threshold: alertThreshold(baseline), state: newRunning() })
  } catch (err) {
    console.error('[Usage] could not start tracking:', err)
  }
}

/** Called on every assistant message. Posts the moment the running total crosses the line. */
export async function trackAssistantUsage(
  sessionId: string,
  usage: Parameters<typeof addTurn>[1],
): Promise<void> {
  const t = tracked.get(sessionId)
  if (!t) return
  t.state = addTurn(t.state, usage)
  if (!shouldAlert(t.state, t.threshold)) return
  t.state.alertedAt.push(t.state.contextTokens)
  const text = formatRunningAlert(t.label, t.state, t.baseline, t.threshold, sessionUrl(sessionId))
  console.warn(`[Usage] ${text}`)
  try {
    await post(text)
  } catch (err) {
    console.error('[Usage] could not post the running alert:', err)
  }
}

/**
 * Record a finished session. Best effort by design: a ledger failure must
 * never break session handling. Discord hears about it only if the run was
 * already alerted mid-flight (a closing line) or ends up an outlier.
 */
export async function recordSessionUsage(
  result: Parameters<typeof recordFromResult>[0],
  meta: Parameters<typeof recordFromResult>[1],
): Promise<void> {
  const t = tracked.get(meta.sessionId)
  tracked.delete(meta.sessionId)
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
    if (t && t.state.alertedAt.length > 0) {
      await post(formatRunningClose(record.label, record, t.state.alertedAt.length))
    } else if (verdict.outlier) {
      await post(formatOutlier(record, verdict))
    }
  } catch (err) {
    console.error('[Usage] could not record session usage:', err)
  }
}

/** A precheck said there was nothing to do: one zero-token line, so the rollup shows the quiet days too. */
export function recordSkippedRun(label: string, projectPath: string, reason: string): void {
  try {
    appendUsage(usageLedgerPath(), {
      ts: new Date().toISOString(),
      sessionId: `skipped-${Date.now()}`,
      label,
      projectPath,
      model: '',
      status: `skipped: ${reason}`.slice(0, 200),
      turns: 0,
      durationMs: 0,
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    })
  } catch (err) {
    console.error('[Usage] could not record skipped run:', err)
  }
}
