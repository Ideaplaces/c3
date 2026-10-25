import fs from 'fs'
import path from 'path'

// When the chain last gave each trigger its turn: a chain fire whose run
// finished its job, or whose precheck found nothing to do. Read by the
// fallback clock, so it survives a c3 restart.

const HOME = process.env.HOME || '/tmp'

function file(): string {
  return path.join(process.env.C3_STATE_DIR || path.join(HOME, '.c3', 'state'), 'chain-turns.json')
}

function readAll(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file(), 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    // A missing file is the first run. Anything else means every chained
    // fallback runs again until the next turn rewrites the file, so say so.
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.error(`[Cron] Could not read ${file()}; chained fallbacks will run:`, err)
    }
    return {}
  }
}

export function lastChainTurn(trigger: string): Date | null {
  const at = readAll()[trigger]
  return at ? new Date(at) : null
}

export function recordChainTurn(trigger: string, firedAt: Date): void {
  const all = readAll()
  all[trigger] = firedAt.toISOString()
  const target = file()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + '\n')
  fs.renameSync(tmp, target)
}
