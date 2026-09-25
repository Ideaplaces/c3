import { execFile } from 'child_process'

export interface PrecheckResult {
  proceed: boolean
  exitCode: number
  reason: string
  /** The gate itself failed (crash, missing binary, timeout); the session runs so the day is not lost. */
  broken?: boolean
  /** The gate ran past PRECHECK_TIMEOUT_MS and was killed, rather than exiting on its own. */
  timedOut?: boolean
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
 *
 * A gate we killed on the timeout is reported as a timeout, not as an unknown
 * exit. Node hands a killed child `code: null` and the bare message "Command
 * failed: bash -lc <command>", which this used to pass through as "exit -1":
 * on 2026-09-25 tour-translate's gate hung and the resulting alert said nothing
 * about why, and the 120 seconds only came out of matching scheduler
 * timestamps by hand. The elapsed time, the signal, and whatever the gate
 * printed before the kill are the clue to which command hung.
 */
export function runPrecheck(
  command: string,
  cwd: string,
  env: Record<string, string> = {},
): Promise<PrecheckResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
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
        // `killed` is set only when we sent the signal, which for execFile is
        // the timeout and nothing else. A gate killed from outside reports the
        // signal with `killed` false and stays an ordinary broken gate.
        const killed = (err as { killed?: boolean }).killed === true
        if (killed && code === -1) {
          const seconds = Math.round((Date.now() - startedAt) / 1000)
          const signal = (err as { signal?: string | null }).signal || 'SIGTERM'
          const trace = reason ? `last output: ${reason}` : 'no output before the kill'
          const detail = `timed out after ${seconds}s (${signal}), ${trace}`
          console.error(
            `[Precheck] gate ${detail}. Command: ${command}. ` +
              'Starting the session anyway; a broken gate must not read as a quiet day.',
          )
          return resolve({ proceed: true, exitCode: code, reason: detail, broken: true, timedOut: true })
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
