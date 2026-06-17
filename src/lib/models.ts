/**
 * Single source of truth for the default Claude model used by new sessions.
 *
 * Every entry point (UI new-session dialog, SDK session manager, and the
 * Discord/Slack/cron webhooks) falls back to this when no model is specified.
 * Override at runtime with the C3_DEFAULT_MODEL env var; change the baseline here.
 */
export const DEFAULT_MODEL = process.env.C3_DEFAULT_MODEL || 'claude-opus-4-8'
