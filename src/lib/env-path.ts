import os from 'os'
import path from 'path'

/**
 * The directories every c3 process and everything it spawns (prechecks, agent
 * sessions, their Bash tools) must be able to find on PATH, whoever restarted
 * pm2 and from whatever shell.
 *
 * The failure this exists to stop: prechecks run with the PATH the c3 process
 * inherited, and that PATH is whatever the shell that last restarted pm2 had.
 * A restart from the weekly agent-sdk cron (PATH = node + /usr/bin:/bin) or from
 * an agent's own Bash tool drops google-cloud-sdk, and from then on every
 * precheck that shells out to gcloud dies with "No such file or directory". The
 * digby-review trigger skipped six mornings in a row that way, Sep 3 to Sep 8
 * 2026, with nothing but a line in the scheduler log to show for it.
 *
 * A login shell does not repair it: ~/.bashrc returns for non-interactive shells
 * before it reaches the google-cloud-sdk line, so `bash -lc` sees the same PATH
 * the process had.
 */
export function toolDirs(home: string = os.homedir(), execPath: string = process.execPath): string[] {
  return [
    path.dirname(execPath),
    path.join(home, 'google-cloud-sdk', 'bin'),
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
}

/** `current` with every tool dir present exactly once, missing ones prepended in order. */
export function withToolDirs(current: string | undefined, dirs: string[] = toolDirs()): string {
  const existing = (current || '').split(path.delimiter).filter(Boolean)
  const present = new Set(existing)
  const prepend = dirs.filter((d) => !present.has(d))
  return [...prepend, ...existing].join(path.delimiter)
}

/** Apply to this process. Call once at the top of every entry point. */
export function ensureToolPath(): string {
  process.env.PATH = withToolDirs(process.env.PATH)
  return process.env.PATH
}
