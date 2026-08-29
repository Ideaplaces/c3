/**
 * Token usage ledger: one line per finished session, and the two questions
 * Chip asked of it. "How much did that run cost?" is answered on every run,
 * into a local file. "Is one of my agents getting out of hand?" is answered
 * only when a run is an outlier for its own trigger, which is when a Discord
 * line is worth reading. The weekly rollup (scripts/usage-report.ts) carries
 * the totals.
 *
 * Numbers come from the SDK result message's modelUsage: every model call in
 * the query pipeline (main loop, subagents, compaction), an estimate rather
 * than a bill. contextTokens is input + cache creation + cache read summed
 * over every call, which is the figure that blew up to 5M on the ops brief.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { dirname } from 'path'

export interface UsageRecord {
  ts: string
  sessionId: string
  label: string
  projectPath: string
  model: string
  status: string
  turns: number
  durationMs: number
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  contextTokens: number
  costUsd: number
}

interface ModelUsageLike {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUSD: number
}

interface ResultLike {
  subtype: string
  num_turns: number
  duration_ms: number
  total_cost_usd: number
  modelUsage?: Record<string, ModelUsageLike>
}

export function recordFromResult(
  result: ResultLike,
  meta: { sessionId: string; label: string; projectPath: string; model: string; ts?: string },
): UsageRecord {
  const sum = { input: 0, create: 0, read: 0, output: 0 }
  for (const m of Object.values(result.modelUsage ?? {})) {
    sum.input += m.inputTokens || 0
    sum.create += m.cacheCreationInputTokens || 0
    sum.read += m.cacheReadInputTokens || 0
    sum.output += m.outputTokens || 0
  }
  return {
    ts: meta.ts ?? new Date().toISOString(),
    sessionId: meta.sessionId,
    label: meta.label,
    projectPath: meta.projectPath,
    model: meta.model,
    status: result.subtype,
    turns: result.num_turns,
    durationMs: result.duration_ms,
    inputTokens: sum.input,
    cacheCreationTokens: sum.create,
    cacheReadTokens: sum.read,
    outputTokens: sum.output,
    contextTokens: sum.input + sum.create + sum.read,
    costUsd: result.total_cost_usd,
  }
}

export function appendUsage(file: string, record: UsageRecord): void {
  const dir = dirname(file)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  appendFileSync(file, JSON.stringify(record) + '\n')
}

export function readUsage(file: string): UsageRecord[] {
  if (!existsSync(file)) return []
  const out: UsageRecord[] = []
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as UsageRecord)
    } catch {
      // a torn line from a crash mid-write is dropped, never fatal
    }
  }
  return out
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export interface OutlierVerdict {
  outlier: boolean
  medianContext: number
  sample: number
}

/**
 * A run is an outlier when its context tokens exceed `factor` times the
 * trailing median of the same label's last `window` runs. Below `floor`
 * nothing is ever an outlier: a 20K run that doubles to 40K is not news.
 * Fewer than `minSample` prior runs means no baseline, so no verdict.
 */
export function isOutlier(
  record: UsageRecord,
  history: UsageRecord[],
  opts: { factor?: number; floor?: number; window?: number; minSample?: number } = {},
): OutlierVerdict {
  const { factor = 2, floor = 300_000, window = 20, minSample = 3 } = opts
  const prior = history
    .filter((r) => r.label === record.label && r.sessionId !== record.sessionId)
    .slice(-window)
  const medianContext = median(prior.map((r) => r.contextTokens))
  if (prior.length < minSample) return { outlier: false, medianContext, sample: prior.length }
  const outlier = record.contextTokens >= floor && record.contextTokens > factor * medianContext
  return { outlier, medianContext, sample: prior.length }
}

export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

export function formatOutlier(record: UsageRecord, verdict: OutlierVerdict): string {
  const x = verdict.medianContext ? (record.contextTokens / verdict.medianContext).toFixed(1) : '?'
  return (
    `**C3 usage outlier** \`${record.label}\`: ${fmtTokens(record.contextTokens)} context tokens over ` +
    `${record.turns} turns, ${x}x its median of ${fmtTokens(verdict.medianContext)} ` +
    `(last ${verdict.sample} runs), $${record.costUsd.toFixed(2)} est., ` +
    `${Math.round(record.durationMs / 60000)} min. Session \`${record.sessionId}\`.`
  )
}

export interface LabelSummary {
  label: string
  runs: number
  medianTurns: number
  medianContext: number
  totalContext: number
  totalCost: number
  prevTotalContext: number
}

/** Per-label rollup of the last `days` days, with the previous window for comparison. */
export function summarizeUsage(records: UsageRecord[], now: Date, days = 7): LabelSummary[] {
  const end = now.getTime()
  const start = end - days * 86_400_000
  const prevStart = start - days * 86_400_000
  const inWindow = (r: UsageRecord, a: number, b: number) => {
    const t = Date.parse(r.ts)
    return t >= a && t < b
  }
  const labels = new Set(records.map((r) => r.label))
  const out: LabelSummary[] = []
  for (const label of labels) {
    const cur = records.filter((r) => r.label === label && inWindow(r, start, end))
    const prev = records.filter((r) => r.label === label && inWindow(r, prevStart, start))
    if (cur.length === 0 && prev.length === 0) continue
    out.push({
      label,
      runs: cur.length,
      medianTurns: median(cur.map((r) => r.turns)),
      medianContext: median(cur.map((r) => r.contextTokens)),
      totalContext: cur.reduce((s, r) => s + r.contextTokens, 0),
      totalCost: cur.reduce((s, r) => s + r.costUsd, 0),
      prevTotalContext: prev.reduce((s, r) => s + r.contextTokens, 0),
    })
  }
  return out.sort((a, b) => b.totalContext - a.totalContext)
}

export function formatSummary(rows: LabelSummary[], days: number, now: Date): string {
  const end = now.toISOString().slice(0, 10)
  const start = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
  const totalContext = rows.reduce((s, r) => s + r.totalContext, 0)
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0)
  const totalRuns = rows.reduce((s, r) => s + r.runs, 0)
  const lines = [
    `**C3 token usage, ${start} to ${end}**: ${totalRuns} runs, ${fmtTokens(totalContext)} context tokens, $${totalCost.toFixed(2)} est.`,
    '```',
    `${'trigger'.padEnd(34)} ${'runs'.padStart(4)} ${'med turns'.padStart(9)} ${'med ctx'.padStart(8)} ${'total ctx'.padStart(9)} ${'vs prev'.padStart(8)} ${'cost'.padStart(7)}`,
  ]
  for (const r of rows) {
    const delta = r.prevTotalContext
      ? `${r.totalContext >= r.prevTotalContext ? '+' : ''}${Math.round(((r.totalContext - r.prevTotalContext) / r.prevTotalContext) * 100)}%`
      : 'new'
    lines.push(
      `${r.label.slice(0, 34).padEnd(34)} ${String(r.runs).padStart(4)} ${String(Math.round(r.medianTurns)).padStart(9)} ` +
        `${fmtTokens(r.medianContext).padStart(8)} ${fmtTokens(r.totalContext).padStart(9)} ${delta.padStart(8)} ${('$' + r.totalCost.toFixed(2)).padStart(7)}`,
    )
  }
  lines.push('```')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Live tracking: the alert Chip can act on fires while the session is still
// running, not in the post-mortem. Every assistant turn carries a usage block;
// the running context total is compared against the trigger's own baseline
// and an alert goes out the moment it crosses, then again at every doubling
// so a runaway keeps announcing itself without spamming.
// ---------------------------------------------------------------------------

export interface RunningUsage {
  turns: number
  contextTokens: number
  outputTokens: number
  /** Context totals at which an alert has already been sent. */
  alertedAt: number[]
}

export interface Baseline {
  medianContext: number
  sample: number
}

export function newRunning(): RunningUsage {
  return { turns: 0, contextTokens: 0, outputTokens: 0, alertedAt: [] }
}

export function baselineFor(label: string, history: UsageRecord[], window = 20): Baseline {
  const prior = history.filter((r) => r.label === label).slice(-window)
  return { medianContext: median(prior.map((r) => r.contextTokens)), sample: prior.length }
}

export function addTurn(
  state: RunningUsage,
  usage: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number } | undefined,
): RunningUsage {
  if (!usage) return state
  return {
    ...state,
    turns: state.turns + 1,
    contextTokens:
      state.contextTokens + (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0),
    outputTokens: state.outputTokens + (usage.output_tokens || 0),
  }
}

/**
 * The line a running session must not cross quietly. With a baseline (three
 * or more prior runs of the same trigger) it is twice the median, never below
 * `floor`; without one it is `absolute`, the ceiling any single run should
 * justify to a human.
 */
export function alertThreshold(
  baseline: Baseline,
  opts: { factor?: number; floor?: number; absolute?: number; minSample?: number } = {},
): number {
  const { factor = 2, floor = 300_000, absolute = 3_000_000, minSample = 3 } = opts
  if (baseline.sample < minSample) return absolute
  return Math.max(floor, factor * baseline.medianContext)
}

/** Alert on the first crossing of the threshold, then at every doubling of the last alerted total. */
export function shouldAlert(state: RunningUsage, threshold: number): boolean {
  if (state.contextTokens < threshold) return false
  const last = state.alertedAt[state.alertedAt.length - 1]
  return last === undefined || state.contextTokens >= 2 * last
}

export function formatRunningAlert(
  label: string,
  state: RunningUsage,
  baseline: Baseline,
  threshold: number,
  sessionUrl: string,
): string {
  const vs = baseline.sample >= 3 ? `${(state.contextTokens / baseline.medianContext).toFixed(1)}x its median of ${fmtTokens(baseline.medianContext)}` : `above the ${fmtTokens(threshold)} ceiling, no baseline yet`
  const again = state.alertedAt.length ? ` (alert ${state.alertedAt.length + 1}, still running)` : ' and still running'
  return (
    `**C3 usage alert** \`${label}\`: ${fmtTokens(state.contextTokens)} context tokens over ${state.turns} turns${again}, ${vs}. ` +
    `Stop it from ${sessionUrl}`
  )
}

export function formatRunningClose(label: string, record: UsageRecord, alerts: number): string {
  return (
    `**C3 usage alert closed** \`${label}\`: finished at ${fmtTokens(record.contextTokens)} context tokens, ` +
    `${record.turns} turns, $${record.costUsd.toFixed(2)} est., ${Math.round(record.durationMs / 60000)} min, ${alerts} alert(s).`
  )
}
