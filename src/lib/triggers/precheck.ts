import { execFile } from 'child_process'

export interface PrecheckResult {
  proceed: boolean
  exitCode: number
  reason: string
}

const PRECHECK_TIMEOUT_MS = parseInt(process.env.C3_PRECHECK_TIMEOUT_MS || '120000', 10)

/**
 * Run a trigger's precheck. Exit 0 means "there is work, start the session".
 * Anything else means skip; the last line of stdout (or stderr) is the reason.
 * A precheck that cannot run (timeout, missing binary) skips too: silently
 * starting a session on a broken gate would defeat the gate.
 */
export function runPrecheck(command: string, cwd: string): Promise<PrecheckResult> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['-lc', command],
      { cwd: cwd.replace(/^~/, process.env.HOME || ''), timeout: PRECHECK_TIMEOUT_MS, maxBuffer: 1 << 20 },
      (err, stdout, stderr) => {
        const lastLine = (text: string) => text.trim().split('\n').filter(Boolean).pop() || ''
        const reason = lastLine(stdout) || lastLine(stderr)
        if (!err) return resolve({ proceed: true, exitCode: 0, reason })
        const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1
        resolve({ proceed: false, exitCode: code, reason: reason || err.message })
      },
    )
  })
}
