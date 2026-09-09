import { execFile } from 'child_process'

export interface PrecheckResult {
  proceed: boolean
  exitCode: number
  reason: string
  /** The gate itself failed (crash, missing binary, timeout); the session runs so the day is not lost. */
  broken?: boolean
}

const PRECHECK_TIMEOUT_MS = parseInt(process.env.C3_PRECHECK_TIMEOUT_MS || '120000', 10)

/** The one exit code that means "checked, and there is nothing to do". */
export const PRECHECK_NOTHING_TO_DO = 3

/**
 * Run a trigger's precheck. The protocol every precheck follows:
 *
 *   exit 0   there is work, start the session
 *   exit 3   checked, nothing new, skip quietly (the last line of output is the reason)
 *   other    the gate itself broke: a crash, a missing binary, a timeout
 *
 * A broken gate starts the session anyway, loudly. It used to skip, on the
 * argument that starting a session on a broken gate defeats the gate; what that
 * produced in practice was digby-review skipping six mornings in a row (Sep 3 to
 * Sep 8 2026) because `gcloud` had dropped off PATH, with one line per day in the
 * scheduler log and no DM. A wasted session costs a few dollars; a review that
 * silently stops running costs the week of wrong numbers nobody caught. The
 * skip is only ever earned by an explicit exit 3.
 */
export function runPrecheck(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<PrecheckResult> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['-lc', command],
      {
        cwd: cwd.replace(/^~/, process.env.HOME || ''),
        timeout: PRECHECK_TIMEOUT_MS,
        maxBuffer: 1 << 20,
        env: { ...process.env, ...env },
      },
      (err, stdout, stderr) => {
        const lastLine = (text: string) => text.trim().split('\n').filter(Boolean).pop() || ''
        const reason = lastLine(stdout) || lastLine(stderr)
        if (!err) return resolve({ proceed: true, exitCode: 0, reason })
        const code = typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : -1
        if (code === PRECHECK_NOTHING_TO_DO) {
          return resolve({ proceed: false, exitCode: code, reason: reason || err.message })
        }
        console.error(
          `[Precheck] gate broke (exit ${code}): ${reason || err.message}. Command: ${command}. ` +
            'Starting the session anyway; a broken gate must not read as a quiet day.',
        )
        resolve({ proceed: true, exitCode: code, reason: reason || err.message, broken: true })
      },
    )
  })
}
