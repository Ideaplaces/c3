# Internal Architecture Spec

This document describes the original design decisions. Fork and customize for your own setup.

---

# C3 Marketing Landing Page: Architecture Spec

## The Problem

C3 is a locally-hosted tool (runs on your machine, accesses your machine). But for open source launch, there needs to be a public marketing website that explains what C3 is. Currently, the only web presence would be the GitHub README.

## The Idea

Ship the marketing site inside the same Next.js codebase as the app. One repo, two deployment contexts:

| | Local (developer's machine) | Azure (public marketing) |
|---|---|---|
| **URL** | `c3-chip.ideaplaces.com` / `c3-luca.ideaplaces.com` | `c3.ideaplaces.com` |
| **Landing page** | `/` shows marketing page | `/` shows marketing page |
| **App** | `/sessions`, `/login`, `/api/*` all work | Blocked by middleware, shows "Run C3 locally" |
| **WebSocket** | Active (Claude Code SDK) | Not available |
| **Server** | `server.ts` (HTTP + WS + bots) | Standard Next.js (no custom server) |

## Why Same Codebase

1. **Shared components.** The marketing page uses the same Button, Card, Badge, CodeBlock components. Same Vibrant Fusion theme. Zero drift between what the site looks like and what the app looks like.

2. **Forks inherit it.** When someone forks C3 and customizes it, the marketing page updates too. The homepage IS part of the product.

3. **Simpler maintenance.** One repo, one CI pipeline, one set of dependencies. No cross-repo sync.

4. **Real components as demos.** The marketing page can embed actual C3 components (StatusBadge, CodeBlock with real syntax highlighting) as live examples, not screenshots.

## Decisions

### Domain Structure

| Subdomain | Purpose | Where it runs |
|---|---|---|
| `c3.ideaplaces.com` | Marketing website (public) | Azure App Service |
| `c3-chip.ideaplaces.com` | Chip's C3 instance (app) | Chip's dev machine |
| `c3-luca.ideaplaces.com` | Luca's C3 instance (app) | Luca's dev machine |

`c3.ideaplaces.com` moves from being Chip's personal instance to the public marketing site. Personal instances get name-suffixed subdomains.

DNS and Azure setup handled by Chip (standard App Service deployment, nothing special).

### Analytics

PostHog, same pattern as monday2github:
- `posthog-js` for client-side pageview tracking
- `PostHogProvider` wrapping the marketing layout (not the app layout)
- Environment detection (local/dev/production)
- App identifier: `app: "c3"`
- Same PostHog project as other IdeaPlaces apps (shared project, filtered by `app` property)
- Env vars: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`

### Blog

No per-product blog. Blog lives at the IdeaPlaces level (`ciprianrarau.com`). C3 marketing page links to relevant blog posts when they exist. Changelog links to GitHub releases.

## Route Architecture

Use Next.js route groups to separate marketing from app:

```
src/app/
├── (marketing)/              # Public marketing pages
│   ├── layout.tsx            # Marketing layout (nav, footer, PostHog)
│   ├── page.tsx              # Landing page (hero, features, demo)
│   ├── features/page.tsx     # Feature deep-dives
│   └── docs/                 # Quick-start guide
│       ├── page.tsx          # Overview
│       ├── setup/page.tsx    # Installation + configuration
│       └── triggers/page.tsx # Setting up Discord/Slack triggers
│
├── (app)/                    # Private app pages
│   ├── layout.tsx            # App layout (minimal, full-height)
│   ├── sessions/
│   │   ├── page.tsx          # Sessions list
│   │   ├── [id]/page.tsx     # Session detail
│   │   └── new/page.tsx      # New session
│   └── login/page.tsx        # Login
│
├── api/                      # API routes (only work locally)
│   ├── auth/
│   ├── sessions/
│   ├── projects/
│   └── webhooks/
│
├── globals.css               # Shared theme (Vibrant Fusion)
└── layout.tsx                # Root layout (fonts, meta)
```

## Middleware: Deployment Mode

The middleware gains a **deployment mode** concept via `C3_MODE` env var.

```
C3_MODE=full        # Local: everything works (default)
C3_MODE=marketing   # Azure: only marketing pages served
```

**When `C3_MODE=marketing`:**
- `/` and `/(marketing)/*` routes serve normally
- `/sessions/*`, `/login`, `/api/*` return a branded "C3 runs on your machine" page with install instructions
- No WebSocket server needed
- No Claude Code SDK, no triggers, no bots
- PostHog analytics active

**When `C3_MODE=full` (default, for local):**
- Everything works as today
- `/` shows the marketing landing page (replaces the current redirect to `/sessions`)
- Marketing nav includes a "Open App" link to `/sessions`
- PostHog analytics NOT loaded (no tracking on personal instances)

## Landing Page Sections

### Hero
- C3 gradient logo (large, coral-to-blue)
- Tagline: "Claude Code, from any browser. Autonomous agents, from any channel."
- Two CTA buttons: "Get Started" (links to docs/setup) and "View on GitHub"
- Animated terminal/browser mockup showing a C3 session

### What It Does (Two Pillars)
1. **Remote Sessions**: "Pilot Claude Code from your phone, tablet, or any browser. Your machine does the work. You just steer."
2. **Autonomous Triggers**: "A Slack message starts an investigation. A Discord alert triggers a fix. Agents run while you sleep."

### How It Works
Visual architecture diagram showing the data flow:
```
Your Device (browser) <---> C3 (Next.js + WS) <---> Claude Code SDK <---> Your Codebase
                                    ^
                         Discord / Slack triggers
```

### Live Component Showcase
Actual C3 components rendered on the page (not screenshots):
- StatusBadge in each state (running, idle, completed, error)
- CodeBlock with real Shiki syntax highlighting
- Mock ChatMessage showing a user/assistant exchange
- Mock ActivityGroup showing collapsed tool calls

### Setup in 4 Steps
```
1. git clone + npm install
2. cp .env.example .env.local
3. npm run build && npx pm2 start
4. Open localhost:8347
```

### Open Source
- MIT License badge
- "Fork it. Customize it. The landing page comes with it."
- GitHub stars counter
- Link to contributing guide

### Footer
- IdeaPlaces branding
- GitHub link
- "Built with Claude Code SDK + Next.js 15 + React 19"

## Branding Updates

### Name
- Product name: **C3** (not "Cloud Claude Code")
- "Cloud Claude Code" becomes the subtitle/expansion, used once in the hero
- All UI references change from "CCC" to "C3"

### Icon/Favicon
- C3 icon using the Vibrant Fusion palette
- Coral-to-blue gradient on "C3" text, or a stylized mark
- Sizes: favicon.ico (16x16, 32x32), apple-touch-icon (180x180), og-image (1200x630)

### Meta Tags
```html
<title>C3 — Claude Code, from any browser</title>
<meta name="description" content="Remote Claude Code sessions and autonomous agents triggered by Discord and Slack. Open source." />
<meta property="og:image" content="/og-image.png" />
```

## Build Scripts

```json
{
  "scripts": {
    "dev": "tsx server.ts",
    "build": "next build",
    "build:marketing": "C3_MODE=marketing next build",
    "start": "NODE_ENV=production tsx server.ts",
    "start:marketing": "C3_MODE=marketing next start"
  }
}
```

## Ownership

| Task | Owner |
|---|---|
| Domain setup (DNS, Azure App Service) | Chip |
| Marketing page implementation | To be built |
| PostHog integration | To be built (follow monday2github pattern) |
| Route group migration | To be built |
| Middleware C3_MODE logic | To be built |
| Branding (CCC to C3, favicon, og-image) | To be built |

## What This Does NOT Change

- No changes to server.ts, WebSocket, SessionManager, triggers, auth
- No changes to the app UI (sessions, chat, tools)
- No new npm dependencies beyond posthog-js (marketing pages reuse existing components)
- No separate repository
- No per-product blog
