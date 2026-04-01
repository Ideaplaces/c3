# C3 (Cloud Claude Code)

## Branching

**Work directly on `main`. No dev branch.** This is a dev tool. Commits to main deploy immediately.

## Overview

Remote Claude Code sessions + autonomous agents triggered by Discord/Slack messages.

## What This Is

C3 is a web layer on top of the Claude Code SDK. It does two things:

1. **Remote sessions.** Pilot Claude Code from any browser, any device.
2. **Autonomous triggers.** Discord/Slack messages start headless Claude Code sessions that investigate, act, and report back.

Both use the same SessionManager. Both visible in the same web UI. An agent starts a session at 3am; you open C3 the next morning and continue the conversation.

## Architecture

```
c3/                         # Next.js app
  server.ts                 # HTTP + WebSocket server
  discord-bot.ts            # Discord channel listener (optional)
  slack-poller.ts           # Slack channel poller (optional)
  src/
    app/api/webhooks/       # Discord + Slack webhook endpoints
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
