# C3 - Cloud Claude Code

Access Claude Code from any browser. Start autonomous agents from Discord or Slack. Continue conversations from your phone.

## What It Does

1. **Remote sessions** - Run Claude Code on your machine, pilot from any device
2. **Autonomous triggers** - Messages in Discord/Slack channels start headless Claude Code sessions
3. **Conversation continuity** - Resume any session from any device, including agent-started ones

The agent investigates at 3am. You open C3 at 9am, read the findings, type "create a PR for this fix," and the agent continues with full context.

## Quick Start

```bash
git clone https://github.com/user/c3
cd c3
npm install
cp .env.example .env.local    # Edit with your values
npm run build
npm start                      # http://localhost:8347
```

## Requirements

- **Node.js 20+**
- **Claude Code CLI** installed and authenticated (`npm install -g @anthropic-ai/claude-code && claude`)
- **Claude Max subscription** (recommended) or Anthropic API key

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                    Your Machine                      │
│                                                      │
│  Discord Bot ─┐                                      │
│               ├─→ C3 Server ─→ SessionManager        │
│  Slack Poller ┘   (port 8347)   (Claude SDK)         │
│                       ↑                ↓             │
│                    Browser         Your Repos         │
│                  (any device)                         │
└─────────────────────────────────────────────────────┘
```

C3 runs on the machine where your code lives. It uses the Claude Code SDK to create sessions programmatically. The browser connects via WebSocket for real-time streaming.

## Authentication

Three options:

| Method | Setup | Use Case |
|--------|-------|----------|
| **Magic link** | Set `RESEND_API_KEY` + `C3_FROM_EMAIL` | Production (email sign-in link) |
| **Password** | Set `C3_LOGIN_PASSWORD` | Quick remote access |
| **None** | Dev mode (default on localhost) | Local development |

## Triggers

Triggers let Discord/Slack messages start Claude Code sessions automatically.

### Setup

1. Create `~/.c3/triggers.json` (see `triggers.example.json`)
2. Write prompt templates in `~/.c3/prompts/`
3. Start the listener:

```bash
npx pm2 start ecosystem.config.cjs   # Starts C3 + Discord bot + Slack poller
```

### How triggers work

1. A message appears in a configured channel
2. The poller/bot forwards it to C3's webhook endpoint
3. C3 loads the prompt template, injects the message content
4. `sessionManager.startSession()` spawns a headless Claude Code agent
5. The agent runs autonomously (reads files, runs commands, creates PRs)
6. On completion, C3 replies in the channel thread with findings
7. You can continue the conversation in the browser or CLI: `claude --resume SESSION_ID`

### Example: Production alert monitoring

```json
{
  "slack": {
    "alerts-backend-prod": {
      "name": "alerts-backend-prod",
      "channelId": "C0ABC123",
      "prompt": "investigate-error.md",
      "projectPath": "~/my-backend",
      "permissionMode": "bypassPermissions",
      "model": "claude-sonnet-4-6",
      "pollIntervalMs": 15000
    }
  }
}
```

When an alert fires in `#alerts-backend-prod`, C3 starts a session in `~/my-backend`, runs the investigation playbook, and replies in the Slack thread.

## Prompt Templates

Prompts are markdown files with `{{variable}}` placeholders:

```markdown
# Error Investigation

An error was reported in #{{channel}}.

## Alert
{{message}}

## Your Task
1. Find the error in the codebase
2. Identify the root cause
3. Create a fix if safe to do so
```

Available variables: `{{message}}`, `{{author}}`, `{{channel}}`, `{{timestamp}}`

## Remote Access

C3 runs on localhost by default. To access from other devices, you need a tunnel:

| Option | Setup |
|--------|-------|
| **Cloudflare Tunnel** | `cloudflared service install <token>` (free, production-grade) |
| **ngrok** | `ngrok http 8347` (quick testing) |
| **Tailscale** | Already on your tailnet (zero config) |

Set `C3_BASE_URL` and `NEXT_PUBLIC_BASE_URL` to your public URL after setting up the tunnel.

## Configuration

All configuration is in `.env.local`. See `.env.example` for all available options.

Trigger configs and prompts live in `~/.c3/`:

```
~/.c3/
  triggers.json       # Channel-to-agent mappings
  prompts/
    investigate-error.md
    review-pr.md
    your-custom-prompt.md
```

## Process Management

```bash
npx pm2 start ecosystem.config.cjs    # Start all services
npx pm2 list                           # Status
npx pm2 logs ccc                       # C3 server logs
npx pm2 logs ccc-slack-poller          # Slack poller logs
npx pm2 restart ccc                    # Restart after config change
npx pm2 save                           # Persist across reboots
```

## License

Apache 2.0
