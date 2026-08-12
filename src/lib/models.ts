/**
 * Single source of truth for the default Claude model used by new sessions.
 *
 * Every entry point (UI new-session dialog, SDK session manager, and the
 * Discord/Slack/cron webhooks) falls back to this when no model is specified.
 * Override at runtime with the C3_DEFAULT_MODEL env var; change the baseline here.
 */
// Fable 5's context window is 1M tokens by default, so no [1m] suffix is
// needed (unlike Opus 4.8, where the suffix enabled the 1M context beta).
export const DEFAULT_MODEL = process.env.C3_DEFAULT_MODEL || 'claude-fable-5'
