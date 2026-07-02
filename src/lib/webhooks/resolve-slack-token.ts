/**
 * Resolve a Slack bot token from the trigger config, with a runtime
 * re-expansion safety net. The trigger config caches env-var-expanded
 * values, but if the cache was populated before the env var was set
 * (race at startup, PM2 env mismatch), the value can be the literal
 * string "${VAR_NAME}" instead of the real token. Slack returns
 * `invalid_auth` for that literal string, with no further detail.
 */
export function resolveSlackToken(
  triggerToken: string | undefined,
  fallbackEnvKey = 'SLACK_BOT_TOKEN',
): string | undefined {
  const raw = triggerToken || process.env[fallbackEnvKey]
  if (!raw) return undefined

  const m = raw.match(/\$\{([A-Z0-9_]+)\}/)
  if (m) {
    const envName = m[1]
    const resolved = process.env[envName]
    if (resolved) {
      console.warn(
        `[Slack Webhook] Re-expanded \${${envName}} at use time (config cache had stale value)`,
      )
      return raw.replace(`\${${envName}}`, resolved)
    }
    console.error(
      `[Slack Webhook] Token contains unexpanded env var \${${envName}} and process.env.${envName} is not set`,
    )
    return undefined
  }

  return raw
}
