/**
 * The environment an agent session runs with.
 *
 * Stripped: CLAUDECODE (allows nested SDK sessions), ANTHROPIC_API_KEY (forces the Max
 * subscription, fixed cost), SLACK_BOT_TOKEN and DISCORD_BOT_TOKEN (agents never post with the
 * server's tokens directly).
 *
 * C3_TRIGGER_SESSION_ID marks a run a trigger started on its own (label `cron:` or `slack:`), so a
 * tool can tell an unattended agent from a person driving a session (the web UI, a Discord thread,
 * a resume). The inherited variables cannot: the server keeps a CLI session's environment when it
 * is restarted from one. The Discord poster gates only these runs, posting an ask or a failed run
 * and nothing else (2026-10-18); a person's message must never be dropped by it.
 */
export function agentEnv(base: Record<string, string | undefined>, sessionId: string, label?: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base }
  delete env.CLAUDECODE
  delete env.ANTHROPIC_API_KEY
  delete env.SLACK_BOT_TOKEN
  delete env.DISCORD_BOT_TOKEN
  delete env.C3_TRIGGER_SESSION_ID
  if (label && /^(cron|slack):/.test(label)) env.C3_TRIGGER_SESSION_ID = sessionId
  return env
}
