/**
 * One-time backfill of ~/.c3/state/usage.jsonl from session transcripts, so
 * the outlier baseline and the first weekly rollup have history on day one.
 *
 *   npx tsx scripts/usage-backfill.ts --days 14
 *
 * Reads "Started session <id> for trigger "<name>"" lines from ~/.c3/logs
 * and sums every assistant record's usage in the matching .jsonl under
 * ~/.claude/projects. Idempotent: a session already in the ledger is skipped.
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { appendUsage, readUsage, type UsageRecord } from '../src/lib/usage/ledger'
import { usageLedgerPath } from '../src/lib/usage'

const HOME = process.env.HOME || '/tmp'
const LOGS = join(process.env.C3_CONFIG_DIR || join(HOME, '.c3'), 'logs')
const PROJECTS = join(HOME, '.claude', 'projects')

function findTranscript(sessionId: string): string | null {
  if (!existsSync(PROJECTS)) return null
  for (const dir of readdirSync(PROJECTS)) {
    const f = join(PROJECTS, dir, `${sessionId}.jsonl`)
    if (existsSync(f)) return f
  }
  return null
}

function fromTranscript(file: string, sessionId: string, label: string, ts: string): UsageRecord | null {
  let turns = 0, input = 0, create = 0, read = 0, output = 0, model = '', first = 0, last = 0, cwd = ''
  for (const line of readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue
    let r: any
    try { r = JSON.parse(line) } catch { continue }
    if (r.cwd && !cwd) cwd = r.cwd
    if (r.timestamp) {
      const t = Date.parse(r.timestamp)
      if (!first) first = t
      last = t
    }
    if (r.type !== 'assistant') continue
    turns++
    const u = r.message?.usage || {}
    input += u.input_tokens || 0
    create += u.cache_creation_input_tokens || 0
    read += u.cache_read_input_tokens || 0
    output += u.output_tokens || 0
    if (r.message?.model) model = r.message.model
  }
  if (!turns) return null
  return {
    ts, sessionId, label, projectPath: cwd, model, status: 'backfill', turns,
    durationMs: Math.max(0, last - first),
    inputTokens: input, cacheCreationTokens: create, cacheReadTokens: read, outputTokens: output,
    contextTokens: input + create + read, costUsd: 0,
  }
}

function main() {
  const args = process.argv.slice(2)
  const days = Number(args[args.indexOf('--days') + 1]) || 14
  const since = Date.now() - days * 86_400_000
  const file = usageLedgerPath()
  const known = new Set(readUsage(file).map((r) => r.sessionId))
  const re = /^(\S+): \[[^\]]+\] Started session ([0-9a-f-]{36}) for trigger "([^"]+)"/
  let added = 0, skipped = 0, missing = 0
  for (const name of ['c3-out.log']) {
    const log = join(LOGS, name)
    if (!existsSync(log)) continue
    for (const line of readFileSync(log, 'utf-8').split('\n')) {
      const m = re.exec(line)
      if (!m) continue
      const [, ts, sessionId, trigger] = m
      if (Date.parse(ts) < since) continue
      if (known.has(sessionId)) { skipped++; continue }
      const f = findTranscript(sessionId)
      if (!f) { missing++; continue }
      const rec = fromTranscript(f, sessionId, `cron:${trigger}`, new Date(ts).toISOString())
      if (!rec) { missing++; continue }
      appendUsage(file, rec)
      known.add(sessionId)
      added++
    }
  }
  console.log(`backfill: added ${added}, already present ${skipped}, no transcript ${missing} -> ${file}`)
}

main()
