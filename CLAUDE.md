# C3 (Cloud Claude Code)

## Branching

**Work directly on `main`. No dev branch.** This is a dev tool. Commits to main deploy immediately.

## CRITICAL: Push Every Change

C3 config lives in git (`Ideaplaces/c3` for the tool, `Ideaplaces/c3-chip` for Chip's private triggers and prompts). **Any edit to `ecosystem.config.cjs`, `cron-scheduler.ts`, `discord-bot.ts`, `slack-poller.ts`, or the triggers repo must be committed AND pushed before you consider the work done.** The scheduler PM2 process reads from the local working tree, but any machine that syncs the repo will overwrite your un-pushed changes. We have lost a morning to this — a trigger was set up, never pushed, and no one could find it. Always: edit → commit → push → `npx pm2 restart c3-cron-scheduler --update-env` if needed.

## Overview

Remote Claude Code sessions + autonomous agents triggered by Discord messages, Slack messages, or cron schedules.

## What This Is

C3 is a web layer on top of the Claude Code SDK. It does two things:

1. **Remote sessions.** Pilot Claude Code from any browser, any device.
2. **Autonomous triggers.** Discord messages, Slack messages, or cron schedules start headless Claude Code sessions that investigate, act, and report back.

Both use the same SessionManager. Both visible in the same web UI. An agent starts a session at 3am; you open C3 the next morning and continue the conversation.

## Architecture

```
c3/                         # Next.js app
  server.ts                 # HTTP + WebSocket server
  discord-bot.ts            # Discord channel listener (optional)
  slack-poller.ts           # Slack channel poller (optional)
  cron-scheduler.ts         # Cron-based trigger scheduler (optional)
  src/
    app/api/webhooks/       # Discord, Slack, and Cron webhook endpoints
    lib/sdk/session-manager.ts  # Claude Agent SDK wrapper
    lib/triggers/config.ts  # Loads triggers from ~/.c3/
    lib/slack-poller/logic.ts   # Tested loop prevention logic
    lib/auth/               # JWT + magic link auth
    components/             # Session UI, chat, tools

~/.c3/                      # Your private config
  triggers.json             # Channel-to-agent mappings
  prompts/                  # Investigation playbooks
```

## Running

```bash
npm install
cp .env.example .env.local  # Edit with your values
npm run build
npx pm2 start ecosystem.config.cjs
```

## Configuration

C3 loads triggers and prompts from `~/.c3/`. See `triggers.example.json` for the format.

```bash
mkdir -p ~/.c3/prompts
cp triggers.example.json ~/.c3/triggers.json
cp prompts/*.md ~/.c3/prompts/
# Edit ~/.c3/triggers.json with your channel IDs and project paths
```

### Answering a Slack alert in Discord instead of Slack

A Slack trigger can carry `discordChannelId`. When it does, C3 copies the alert
into that Discord channel before the session starts and posts the agent's report
as an inline reply to the copy. Nothing is written back to Slack: no thread
reply, no session-start notice, no reaction. A Slack DM to `notifyUserId` stays
as the degraded fallback for when Discord refuses the post, so a report is never
silently lost.

Use it for alert channels shared with a team, where a bot reply reads as
"someone is handling this" and a DM loses the per-channel grouping. Give each
watched Slack channel its own Discord twin so the alert and its answer stay
together. The agent's prompt must then treat its final message as the
deliverable and never post anywhere itself. See
`src/lib/webhooks/discord-mirror.ts`.

## Auth

Three options (configured via .env.local):

- **Magic link:** Set `RESEND_API_KEY` + `C3_FROM_EMAIL` + `CCC_ALLOWED_EMAILS`. Login page sends an email with a sign-in link.
- **Password:** Set `C3_LOGIN_PASSWORD`. Simple password field.
- **Dev mode:** In development, auto-login with no credentials.

## Tests

```bash
npx vitest run                              # All tests
npx vitest run tests/unit/slack-poller/     # Slack poller loop prevention (24 tests)
```
