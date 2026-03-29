# C3 (Cloud Claude Code)

Remote Claude Code sessions + autonomous agents triggered by Discord/Slack messages.

**Live URL:** https://c3.ideaplaces.com
**Port:** 8347
**Repo:** Ideaplaces/c3

## Specialist Agents (Saved Conversations)

These are long-running Claude Code sessions with deep context about specific domains of C3. They accumulate knowledge across multiple interactions and become specialists.

**How to resume:** `claude --resume <session-name>`

| Session Name | Domain | What It Knows |
|---|---|---|
| `c3` | C3 architecture, triggers, Slack/Discord integration | The entire C3 system: SessionManager (Claude Agent SDK), WebSocket handler, Discord bot relay, Slack poller with loop prevention (eyes reaction + 5min cooldown + reply_broadcast:false), trigger config system (~/.c3/triggers.json + prompts/), magic link auth (Resend email), Cloudflare Tunnel setup (Terraform in ideaplaces-devops), pm2 ecosystem (ccc + ccc-discord-bot + ccc-slack-poller). Built the Mentorly production error investigation prompt. Knows every file, every bug fixed, every design decision. |

**When to recommend a specialist agent:**
- If the user asks to work on C3 features, triggers, authentication, the Slack poller, Discord bot, session management, or the web UI, suggest: "There's a specialist session `c3` with the entire build history. Want to resume it with `claude --resume c3`?"

## Architecture

```
c3/                         # Next.js app (the tool, open-sourceable)
  server.ts                 # HTTP + WebSocket server
  discord-bot.ts            # Discord channel listener
  slack-poller.ts           # Slack channel poller (15s interval)
  src/
    app/api/webhooks/       # Discord + Slack webhook endpoints
    lib/sdk/session-manager.ts  # Claude Agent SDK wrapper
    lib/triggers/config.ts  # Loads triggers from ~/.c3/
    lib/slack-poller/logic.ts   # Tested loop prevention logic
    lib/auth/               # JWT + magic link auth
    components/             # Session UI, chat, tools

~/.c3/                      # Private config (Ideaplaces/c3-chip repo)
  triggers.json             # Channel-to-agent mappings
  prompts/                  # Investigation playbooks
```

## How Triggers Work

1. Slack poller or Discord bot detects a message in a configured channel
2. Looks up channel in `~/.c3/triggers.json` (prompt file + project path)
3. Calls `sessionManager.startSession()` with the prompt + message context
4. Agent runs with `bypassPermissions` (headless, no human in the loop)
5. On completion, replies in the Slack thread or Discord with findings
6. Session visible in C3 web UI for continuation

## Key Design Decisions

- **Config lives at ~/.c3/, not in the repo.** C3 loads triggers and prompts from a sibling `c3-data/` directory or `~/.c3/`. This keeps the tool open-sourceable and config private.
- **Bypass permissions always.** Single user, trusted environment. No permission prompts.
- **SLACK_BOT_TOKEN stripped from agent env.** Prevents agents from posting to Slack directly. Only the completion callback posts.
- **Loop prevention:** Three layers: eyes emoji reaction before processing, 5-minute rate limit per channel, reply_broadcast:false for in-thread replies. Unit tested (24 tests).
- **Magic link auth.** No Google OAuth dependency. Resend sends email to chip@ideaplaces.com, click link, 30-day session.
- **Cloudflare Tunnel.** Managed in ideaplaces-devops Terraform. Outbound only, no open ports.
- **Host header for URLs.** All redirects use the Host header from Cloudflare, not request.url (which resolves to 0.0.0.0:8347 internally).

## Running

```bash
# All three processes via pm2
cd ~/ideaplaces-meta/c3
npx pm2 start ecosystem.config.cjs

# Or individually
npx tsx server.ts          # C3 web server
npx tsx discord-bot.ts     # Discord listener
npx tsx slack-poller.ts    # Slack poller
```

## Environment Variables (.env.local)

| Variable | Purpose |
|---|---|
| `JWT_SECRET` | Production JWT signing key (from Key Vault: jwt-secret-c3) |
| `NEXT_PUBLIC_BASE_URL` | `https://c3.ideaplaces.com` |
| `C3_BASE_URL` | Same, used by server-side API routes |
| `CCC_ALLOWED_EMAILS` | Email allowlist for magic link auth |
| `CCC_WEBHOOK_SECRET` | Shared secret for webhook authentication |
| `DISCORD_BOT_TOKEN` | Discord bot token (from Key Vault) |
| `SLACK_BOT_TOKEN` | Slack bot token (from Key Vault) |
| `RESEND_API_KEY` | Resend email API key (from Key Vault) |
| `CCC_PROJECT_DIRS` | Directories to scan for projects |

## Development

```bash
npm install
npm run build
npm start          # Production mode
npm run dev        # Dev mode (hot reload, localhost only)
```

## Tests

```bash
npx vitest run tests/unit/slack-poller/    # Slack poller loop prevention (24 tests)
```
