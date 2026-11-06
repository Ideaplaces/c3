import { readFileSync, existsSync } from 'fs'
import { usageLedgerPath } from '@/lib/usage'
import type { DiscoveredProject } from './discover'

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export interface LedgerRun {
  ts: string
  projectPath: string
  label?: string
  status?: string
}

/**
 * Order the workspaces by use in the last 30 days: first the sessions started
 * from the page, then real agent runs (a precheck that skipped is not a run).
 * Scheduled agents fire thousands of times a month, so they only break ties
 * between folders started equally often by hand. A workspace with no runs
 * keeps its config order, so a new folder still shows up.
 */
export function rankWorkspaces(
  workspaces: DiscoveredProject[],
  runs: LedgerRun[],
  now: number = Date.now(),
): DiscoveredProject[] {
  const started = new Map<string, number>()
  const ran = new Map<string, number>()
  // Longest path first, so a run in a nested workspace counts for that one only.
  const byDepth = [...workspaces].sort((a, b) => b.path.length - a.path.length)

  for (const run of runs) {
    const at = Date.parse(run.ts)
    if (!Number.isFinite(at) || at > now || now - at > WINDOW_MS) continue
    if (run.status?.startsWith('skipped')) continue
    const owner = byDepth.find((w) => run.projectPath === w.path || run.projectPath?.startsWith(w.path + '/'))
    if (!owner) continue
    const tally = run.label === 'web' ? started : ran
    tally.set(owner.path, (tally.get(owner.path) ?? 0) + 1)
  }

  const count = (m: Map<string, number>, w: DiscoveredProject) => m.get(w.path) ?? 0
  return workspaces
    .map((w, i) => ({ w, i, s: count(started, w), r: count(ran, w) }))
    .sort((a, b) => b.s - a.s || b.r - a.r || a.i - b.i)
    .map(({ w }) => w)
}

/** The usage ledger's runs, for ranking. An unreadable ledger ranks nothing. */
export function readLedgerRuns(path: string = usageLedgerPath()): LedgerRun[] {
  if (!existsSync(path)) return []
  const runs: LedgerRun[] = []
  try {
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
      if (!line) continue
      try {
        const r = JSON.parse(line)
        if (typeof r.ts === 'string' && typeof r.projectPath === 'string') {
          runs.push({ ts: r.ts, projectPath: r.projectPath, label: r.label, status: r.status })
        }
      } catch {
        // A torn line is skipped, never fatal
      }
    }
  } catch (err) {
    console.error('[Projects] could not read the usage ledger:', err)
  }
  return runs
}
