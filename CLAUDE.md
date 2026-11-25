# C3 (Cloud Claude Code)

## Branching

**Work directly on `main`. No dev branch.** This is a dev tool. Commits to main deploy immediately.

## CRITICAL: Push Every Change

C3 config lives in git (`Ideaplaces/c3` for the tool, `Ideaplaces/c3-chip` for Chip's private triggers and prompts). **Any edit to `ecosystem.config.cjs`, `cron-scheduler.ts`, `discord-bot.ts`, `slack-poller.ts`, or the triggers repo must be committed AND pushed before you consider the work done.** The scheduler PM2 process reads from the local working tree, but any machine that syncs the repo will overwrite your un-pushed changes. We have lost a morning to this — a trigger was set up, never pushed, and no one could find it. Always: edit → commit → push → `npx pm2 restart c3-cron-scheduler --update-env` if needed.

## Overview

Remote Claude Code sessions + autonomous agents triggered by Discord messages, Slack messages, or cron schedules.

## CRITICAL: Restarting the c3 process kills every live session

Every session (web, cron, Slack, Discord) runs as a claude child process of the single `c3` pm2 process, and the children die with it. Before `npx pm2 restart c3` (or delete/start), check nothing is mid-run: `tail ~/.c3/logs/c3-out.log` for recent session starts without a matching end, or the running entries with a fresh `updatedAt` in `~/.ccc/data/sessions.json` (stale `running` rows are orphans from earlier restarts; only a recent timestamp means live). The sessionManager is a globalThis singleton shared by the tsx graph and the .next bundle; a change to `server.ts` or `src/lib` needs `npm run build` plus a c3 restart to reach both sides.

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

### Slack triggers: one session per message, or one per burst

The poller starts at most one session per channel every 5 minutes; a second
message inside that window is skipped and never retried. That is right for an
alert channel, where a burst is one incident. A channel where every message is
its own case (an NPS score, a support ticket) sets `"cooldownMs": 0` on the
trigger so nothing is dropped.

### Cron reports with Slack follow-ups

A report destination is a named Slack trigger with `threadsOnly: true` and a
`reportAgents` list of cron trigger names. The Slack bot must be a member of the
private channel with `chat:write`, `groups:history`, and `reactions:write`.
`users:read` lets C3 display the reply author's name.
If the workspace requires a user credential for `conversations.replies`, set
`slackThreadReadToken` to a server-side environment reference for a channel
member's user token with `groups:history`. Posts and reactions use the bot.

The cron agent calls `POST /api/webhooks/slack-report` with `CCC_WEBHOOK_SECRET`
as bearer auth and `{trigger, sessionId, head, body?, idempotencyKey}`. Use the
live `C3_TRIGGER_SESSION_ID` and keep the same key for each retry of a report.
The endpoint returns the Slack `{ts, permalink}`. C3 links the thread to the
reporting session when Slack confirms the head and holds follow-ups while the
body chunks post. An identical retry returns the original result or resumes
from confirmed delivery progress. An uncertain Slack send returns
`slack_delivery_unknown`. Changing the payload under the same retained key
in the same channel returns `idempotency_key_conflict`. Report delivery records
expire after 30 days.

The poller watches bot-authored parents from the last 14 days. Human replies
resume the linked session, or start and link a session if the transcript is
gone. File replies include their names or permalinks. A busy reply is retried
on the next poll. The poller adds `eyes` after the webhook accepts the reply
and continues if Slack refuses the reaction. Only the bot's `eyes` counts.
The webhook requires the reply's `messageTs` and uses it to deduplicate
retries. C3 saves an answer record before each run and posts answers in the
same Slack thread. After a restart, C3 recovers pending answers from saved
text or the session transcript and posts a failure notice for interrupted
runs. For rate-limited answers, C3 waits for `Retry-After` or uses a default
delay if Slack omits the header. C3 holds and logs unconfirmed Slack writes
for reconciliation. Answer records expire after 30 days.

Slack reports and answers omit C3 URLs and stay in Slack. For Mentorly
destinations, C3 also removes IdeaPlaces names and links. Set
`"workspace": "mentorly"` on a trigger if its project path is outside
`mentorly-meta`.

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

### Replies to Discord reports in their home channels

The shared Discord poster registers surfaced reports with `POST /api/webhooks/inbox`.
C3 uses the report's Discord message ID as the thread ID and links it to the
original session only while it is running with a `cron:<name>` or `slack:<name>`
label. Other session claims get `200 not-a-trigger-run`. Repeating an eligible
registration for the same message and session is a no-op. An eligible registration
for a message linked to a different report session returns 409. The Slack webhook
links its own Discord reports directly when the Slack run finishes.

A parent channel with `thread: true` keeps its existing conversation routing
and session in the thread. In other channels, C3 uses the report link to resume
the original session with just the new reply. C3 deduplicates delivery by the
reply's Discord message ID. The default bot checks for report links on otherwise
unrouted replies. C3 ignores unlinked and textless replies on that path. A busy
session asks the person to try again. If the transcript is gone or the link is
older than 30 days, C3 posts the original session URL. C3 stops using report
links after 60 days and prunes them on write. Quiet webhook reports with no ask
for Chip are archived after delivery. Failed runs and reports that ask Chip stay open.
An unreadable or malformed thread-link file fails the operation and is kept for recovery.

### A second Discord bot identity for a server the default bot is not in

`discord-bot.ts` runs once per bot token. Two processes on one token would each
receive every event and start every session twice, so a bot that lives in
another server gets its own process and its own name. In `ecosystem.config.cjs`
the process sets `C3_DISCORD_BOT=<name>` and `C3_DISCORD_BOT_TOKEN_ENV=<env var
holding the token>` (the var lives in `.env.local`), and every trigger it should
serve carries `"bot": "<name>"`. Triggers without a `bot` field stay with the
default process. The reference is `c3-discord-bot-spotter`, the Gymswell
feedback bot.

Three more channel trigger fields came with it. `webhookId` pins the trigger
to one webhook, so people can talk in the channel next to an app's reports
without starting a session each time. `thread: true` opens a thread on the
message and every reply goes there; a person replying inside that thread (any
thread under the channel) starts a follow-up session that gets the thread so far
as context and answers in the same thread, one session per thread at a time.
`routeMessage` in `src/lib/discord-bot/logic.ts` decides, and leaves out bots,
system messages, mention triggers and webhook-pinned triggers. `discordBotToken` (usually `${VAR}`) is
what the webhook route posts the completion notice with, since the reply has
to come from the bot that is a member of that server. Embeds and attachments
are folded into the session text; a report posted as an embed used to reach
the agent as an empty message. `POST /replay {channelId, messageId}` on the
bot's port (with the webhook secret as bearer) runs an existing message through
the live path: that is the backfill.

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
