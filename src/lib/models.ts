/**
 * Single source of truth for the default Claude model used by new sessions.
 *
 * Every entry point (UI new-session dialog, SDK session manager, and the
 * Discord/Slack/cron webhooks) falls back to this when no model is specified.
 * Override at runtime with the C3_DEFAULT_MODEL env var; change the baseline here.
 */
// Opus 5 with the [1m] suffix, which enables the 1M context window.
// Fable 5 is deliberately NOT the default: Claude Code currently rate-limits it
// on its own separate, more expensive budget, so sessions get cut off. Opus has
// far better availability, which matters more than Fable's edge on any one task.
export const DEFAULT_MODEL = process.env.C3_DEFAULT_MODEL || 'claude-opus-5[1m]'
