import { runPrecheck } from '@/lib/triggers/precheck'
import { USAGE_CHANNEL_ID } from '@/lib/usage'
import { postDiscordMessage } from '@/lib/webhooks/discord-mirror'
import { detectSessionFailure, type BufferedSessionEvent } from '@/lib/webhooks/failure-detector'

/**
 * The cron half of "a silent agent crash must never go unseen".
 *
 * Slack and Discord sessions get a failure notice from C3 when they die, because
 * C3 owns their reply. A cron session owns its own report: the prompt posts it as
 * the last step, so a run cut off before that step posts nothing, and a day it
 * died reads exactly like a quiet day. On 2026-10-08 iris-review died eight
 * minutes in on "You've hit your session limit" with two wrong answers in its
 * bundle, and nobody knew until it was found by hand that evening.
 *
 * A trigger with a `postcheck` gets that command run once its session ends,
 * however it ended, with what C3 knows about the ending in the environment. The
 * command decides what a missing report means for its trigger and where to say
 * so; C3 stays out of each trigger's channel and token.
 */
export interface CronRunEnding {
  sessionId: string
  sessionUrl: string
  startedAt: string
  endReason: string
  events: BufferedSessionEvent[]
}

export function postcheckEnv(ending: CronRunEnding): Record<string, string> {
  const failure = detectSessionFailure(ending.events, ending.endReason)
  return {
    C3_SESSION_ID: ending.sessionId,
    C3_SESSION_URL: ending.sessionUrl,
    C3_RUN_STARTED_AT: ending.startedAt,
    C3_END_REASON: ending.endReason,
    C3_FAILURE: failure.failed ? failure.reason : '',
  }
}

/**
 * A postcheck that cannot run (an expired az login, a Slack error, a crash) is
 * the one failure it cannot report itself, so C3 says so in the channel its own
 * usage alerts go to. A log line alone is how digby-review's broken gate went
 * unseen for six days in September.
 */
export function formatPostcheckFailure(
  label: string,
  exitCode: number,
  reason: string,
  sessionUrl: string,
  timedOut = false,
): string {
  // The reason is the command's last output line; keep the post under Discord's 2000 characters.
  const why = (reason || 'no output').slice(0, 500)
  const how = timedOut ? 'timed out' : `exit ${exitCode}`
  return (
    `**C3 postcheck failed** \`${label}\`: ${how}, ${why}. ` +
    `If the run itself died, nothing said so. Session: ${sessionUrl}`
  )
}

export async function runPostcheck(
  label: string,
  command: string,
  cwd: string,
  ending: CronRunEnding,
): Promise<void> {
  const result = await runPrecheck(command, cwd, postcheckEnv(ending))
  if (result.exitCode !== 0) {
    console.error(
      `[Postcheck] "${command}" exited ${result.exitCode} after session ${ending.sessionId}: ${result.reason}`,
    )
    const text = formatPostcheckFailure(label, result.exitCode, result.reason, ending.sessionUrl, result.timedOut)
    const token = process.env.DISCORD_BOT_TOKEN
    if (!token) {
      console.warn('[Postcheck] alert not posted, DISCORD_BOT_TOKEN is unset:', text)
      return
    }
    await postDiscordMessage(token, USAGE_CHANNEL_ID, text)
    return
  }
  console.log(`[Postcheck] session ${ending.sessionId}: ${result.reason || 'ok'}`)
}
