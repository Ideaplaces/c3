import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { StatusBadge } from '@/components/StatusBadge'
import { Logo } from '@/components/ui/Logo'

function DemoLabel() {
  return (
    <div className="absolute top-3 right-3 bg-primary/10 border border-primary/20 text-primary text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider z-10">
      Demo
    </div>
  )
}

function MockSessionCard({ project, status, prompt, time, turns, cost }: {
  project: string
  status: 'running' | 'idle' | 'completed' | 'error'
  prompt: string
  time: string
  turns: number
  cost: string
}) {
  const borderColor = {
    running: 'border-l-primary',
    completed: 'border-l-success',
    error: 'border-l-error',
    idle: 'border-l-border-light',
  }[status]

  return (
    <div className={`border border-border rounded-lg border-l-4 ${borderColor} px-4 py-3 transition-all`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-medium font-mono text-sm">{project}</span>
            <StatusBadge status={status} />
            <span className="text-foreground-muted/60 text-xs">{time}</span>
          </div>
          <div className="text-sm text-foreground line-clamp-1">{prompt}</div>
        </div>
        <div className="hidden sm:flex items-center gap-4 shrink-0 text-xs text-foreground-muted pt-1">
          <span>{turns} turns</span>
          <span>{cost}</span>
          <span className="text-foreground-muted/40">&rarr;</span>
        </div>
      </div>
    </div>
  )
}

function MockToolCall({ icon, summary }: { icon: string; summary: string }) {
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2 text-left">
        <span className="text-xs select-none shrink-0">&#x25B6;</span>
        <span className="text-xs font-mono truncate">
          <span className="select-none">{icon} </span>
          {summary}
        </span>
      </div>
    </div>
  )
}

function MockActivityGroup() {
  return (
    <div className="border border-border/50 rounded-md overflow-hidden">
      <div className="px-3 py-2 flex items-center gap-2">
        <span className="text-xs text-foreground-muted select-none">&#x25BC;</span>
        <span className="text-xs text-foreground-muted">5 ops</span>
      </div>
      <div className="border-t border-border/50 px-2 py-1 space-y-1">
        <MockToolCall icon="&#x1F50D;" summary='Grep "handleWebhook" in src/api/' />
        <MockToolCall icon="&#x1F4C4;" summary="Read src/api/webhooks/handler.ts" />
        <MockToolCall icon="&#x1F4C4;" summary="Read src/lib/crypto/verify.ts" />
        <MockToolCall icon="&#x270F;&#xFE0F;" summary="Edit src/lib/crypto/verify.ts" />
        <MockToolCall icon="$" summary="npm run test -- --grep webhook" />
      </div>
    </div>
  )
}

function ArchitectureDiagram() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 sm:gap-4 items-center">
      {/* Your Device */}
      <div className="bg-card border border-border rounded-lg p-4 text-center">
        <div className="text-2xl mb-2">&#x1F4F1;</div>
        <div className="text-sm font-semibold">Your Device</div>
        <div className="text-xs text-foreground-muted">Any browser</div>
      </div>

      {/* Arrow */}
      <div className="hidden sm:flex flex-col items-center gap-1 -mx-2">
        <div className="text-xs text-foreground-muted text-center">WebSocket</div>
        <div className="w-full h-px bg-gradient-to-r from-primary to-secondary" />
        <div className="text-xs text-foreground-muted text-center">Stream</div>
      </div>
      <div className="sm:hidden flex justify-center">
        <div className="w-px h-6 bg-gradient-to-b from-primary to-secondary" />
      </div>

      {/* C3 Server */}
      <div className="bg-card border-2 border-primary/40 rounded-lg p-4 text-center shadow-glow-primary">
        <div className="mb-2"><Logo size={40} /></div>
        <div className="text-sm font-semibold">C3 Server</div>
        <div className="text-xs text-foreground-muted">Next.js + WebSocket</div>
      </div>

      {/* Arrow */}
      <div className="hidden sm:flex flex-col items-center gap-1 -mx-2">
        <div className="text-xs text-foreground-muted text-center">Agent SDK</div>
        <div className="w-full h-px bg-gradient-to-r from-secondary to-accent" />
        <div className="text-xs text-foreground-muted text-center">Events</div>
      </div>
      <div className="sm:hidden flex justify-center">
        <div className="w-px h-6 bg-gradient-to-b from-secondary to-accent" />
      </div>

      {/* Claude Code */}
      <div className="bg-card border border-secondary/40 rounded-lg p-4 text-center">
        <div className="text-2xl mb-2">&#x1F916;</div>
        <div className="text-sm font-semibold">Claude Code</div>
        <div className="text-xs text-foreground-muted">Agent SDK</div>
      </div>

      {/* Arrow */}
      <div className="hidden sm:flex flex-col items-center gap-1 -mx-2">
        <div className="text-xs text-foreground-muted text-center">Read / Edit</div>
        <div className="w-full h-px bg-gradient-to-r from-accent to-success" />
        <div className="text-xs text-foreground-muted text-center">Run tests</div>
      </div>
      <div className="sm:hidden flex justify-center">
        <div className="w-px h-6 bg-gradient-to-b from-accent to-success" />
      </div>

      {/* Your Codebase */}
      <div className="bg-card border border-border rounded-lg p-4 text-center">
        <div className="text-2xl mb-2">&#x1F4C1;</div>
        <div className="text-sm font-semibold">Your Codebase</div>
        <div className="text-xs text-foreground-muted">Local files</div>
      </div>

      {/* Trigger row */}
      <div className="sm:col-span-4 mt-4 flex items-center justify-center gap-3 bg-card border border-border/50 rounded-lg p-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">&#x1F4AC;</span>
          <span className="text-xs text-foreground-muted">Discord / Slack</span>
        </div>
        <div className="w-12 h-px bg-gradient-to-r from-warning to-primary" />
        <span className="text-xs text-foreground-muted">trigger message</span>
        <div className="w-12 h-px bg-gradient-to-r from-primary to-secondary" />
        <span className="text-xs font-semibold">C3 auto-starts a headless session</span>
      </div>
    </div>
  )
}

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="px-4 sm:px-8 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto text-center">
          <div className="flex justify-center mb-6">
            <Logo size={96} />
          </div>
          <p className="text-xl sm:text-2xl text-foreground-muted mb-4 font-heading">
            Cloud Claude Code
          </p>
          <p className="text-lg sm:text-xl text-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            Claude Code, from any browser. Autonomous agents, from any channel.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a href="/docs">
              <Button variant="primary" size="lg">Get Started</Button>
            </a>
            <a href="https://github.com/Ideaplaces/c3" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="lg">View on GitHub</Button>
            </a>
          </div>
        </div>
      </section>

      {/* Live Demo: Sessions List */}
      <section className="px-4 sm:px-8 py-16 bg-surface/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-center mb-4">Your Sessions, From Anywhere</h2>
          <p className="text-foreground-muted text-center mb-10 max-w-xl mx-auto">
            Every session is visible in one place. Agents that ran overnight, debugging sessions from your phone, all in one list.
          </p>

          <Card className="p-0 overflow-hidden relative">
            <DemoLabel />
            <div className="border-b border-border px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Logo size={28} />
                <span className="text-foreground-muted text-sm hidden sm:inline">Cloud Claude Code</span>
              </div>
              <Button variant="primary" size="sm">+ New Session</Button>
            </div>
            <div className="p-3 space-y-2">
              <MockSessionCard
                project="pulse-api"
                status="running"
                prompt="Investigate the spike in /api/metrics latency and optimize the aggregation query"
                time="2m ago"
                turns={12}
                cost="$0.43"
              />
              <MockSessionCard
                project="c3"
                status="completed"
                prompt="Add PostHog analytics to the marketing layout with environment detection"
                time="1h ago"
                turns={8}
                cost="$0.12"
              />
              <MockSessionCard
                project="nexus-app"
                status="completed"
                prompt="Fix the webhook signature validation failing on large payloads over 1MB"
                time="3h ago"
                turns={15}
                cost="$0.67"
              />
              <MockSessionCard
                project="orbit-docs"
                status="error"
                prompt="Migrate search from Algolia to local vector embeddings with pgvector"
                time="5h ago"
                turns={23}
                cost="$1.04"
              />
            </div>
          </Card>
        </div>
      </section>

      {/* Two Pillars */}
      <section className="px-4 sm:px-8 py-16">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-8 sm:gap-12">
          <Card className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
                </svg>
              </div>
              <h2 className="text-xl font-bold font-heading">Remote Sessions</h2>
            </div>
            <p className="text-foreground-muted leading-relaxed">
              Pilot Claude Code from your phone, tablet, or any browser. Your machine does the work. You just steer.
            </p>
          </Card>

          <Card className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold font-heading">Autonomous Triggers</h2>
            </div>
            <p className="text-foreground-muted leading-relaxed">
              A Slack message starts an investigation. A Discord alert triggers a fix. Agents run while you sleep, and report back.
            </p>
          </Card>
        </div>
      </section>

      {/* Live Demo: Chat Session */}
      <section className="px-4 sm:px-8 py-16 bg-surface/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-center mb-4">Real Conversation, Real Tools</h2>
          <p className="text-foreground-muted text-center mb-10 max-w-xl mx-auto">
            C3 streams Claude Code's full output: thinking, tool calls, file edits, test results. Everything you'd see in the terminal.
          </p>

          <Card className="p-0 overflow-hidden relative">
            <DemoLabel />
            {/* Mock session header */}
            <div className="border-b border-border px-4 py-2.5 flex items-center justify-between relative">
              <div className="flex items-center gap-3">
                <span className="text-foreground-muted text-sm">&larr; Sessions</span>
                <span className="font-medium font-mono text-sm">pulse-api</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono text-info bg-info/10">bypass</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-info">
                  <StatusDot status="running" />
                  Running
                </span>
              </div>
              <Button variant="destructive" size="sm">Stop</Button>
              <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-secondary to-primary opacity-30" />
            </div>

            {/* Mock chat */}
            <div className="px-4 py-4 space-y-3">
              <div className="flex gap-3 py-2">
                <Avatar name="User" color="primary" size="sm" />
                <div className="flex-1 text-sm min-w-0">
                  Investigate the spike in /api/metrics latency and optimize the aggregation query
                </div>
              </div>

              <MockActivityGroup />

              <div className="flex gap-3 py-2">
                <Avatar name="Claude" color="secondary" size="sm" />
                <div className="flex-1 text-sm min-w-0 space-y-3">
                  <p>Found the issue. The <code className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs font-mono">aggregateMetrics()</code> function runs a full table scan on every request because the <code className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs font-mono">created_at</code> index was dropped in the last migration.</p>
                  <p>Two changes made:</p>
                  <ol className="list-decimal list-inside space-y-1 text-foreground-muted">
                    <li>Restored the composite index on <code className="bg-surface border border-border rounded px-1.5 py-0.5 text-xs font-mono">(created_at, metric_type)</code></li>
                    <li>Added a 5 minute cache with stale-while-revalidate for the aggregation endpoint</li>
                  </ol>
                  <p>Query time dropped from ~1200ms to ~8ms. All tests pass.</p>
                </div>
              </div>

              <div className="text-xs py-1.5 px-3 rounded border inline-block bg-success/10 border-success/30 text-success">
                Done &middot; 12 turns &middot; $0.43
              </div>
            </div>

            {/* Mock input */}
            <div className="border-t border-border px-4 py-3">
              <div className="flex gap-2 max-w-4xl mx-auto">
                <div className="flex-1 bg-surface border border-border rounded-md px-3 py-2 text-foreground-muted/50 font-mono text-sm min-h-[44px] flex items-center">
                  Send a follow-up prompt...
                </div>
                <Button variant="primary" size="md">Send</Button>
              </div>
            </div>
          </Card>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-4 sm:px-8 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-center mb-12">How It Works</h2>
          <ArchitectureDiagram />
        </div>
      </section>

      {/* Component Showcase */}
      <section className="px-4 sm:px-8 py-16 bg-surface/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-center mb-4">Built with Real Components</h2>
          <p className="text-foreground-muted text-center mb-10">
            Everything on this page is rendered using actual C3 components. Fork it and make it yours.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Badge variant="info" className="animate-pulse-glow">
              <StatusDot status="running" className="mr-2" />
              Running
            </Badge>
            <Badge variant="idle">Idle</Badge>
            <Badge variant="success">Completed</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="default">12 turns</Badge>
            <Badge variant="secondary">$0.43</Badge>
            <Badge variant="warning">Bypass Mode</Badge>
          </div>
        </div>
      </section>

      {/* Setup */}
      <section className="px-4 sm:px-8 py-16">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-center mb-12">Up and Running in 4 Steps</h2>
          <div className="space-y-4">
            {[
              { step: '1', cmd: 'git clone https://github.com/Ideaplaces/c3 && cd c3 && npm install' },
              { step: '2', cmd: 'cp .env.example .env.local    # add your API keys' },
              { step: '3', cmd: 'npm run build && npx pm2 start ecosystem.config.cjs' },
              { step: '4', cmd: 'open http://localhost:8347    # done' },
            ].map(({ step, cmd }) => (
              <div key={step} className="flex gap-4 items-start">
                <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                  {step}
                </div>
                <pre className="flex-1 bg-surface border border-border rounded-md px-4 py-3 font-mono text-sm text-foreground-muted overflow-x-auto">
                  <code>{cmd}</code>
                </pre>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Open Source */}
      <section className="px-4 sm:px-8 py-16 bg-surface/50">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading mb-4">Open Source</h2>
          <p className="text-foreground-muted mb-8 text-lg">
            Fork it. Customize it. The landing page comes with it.
          </p>
          <a href="https://github.com/Ideaplaces/c3" target="_blank" rel="noopener noreferrer">
            <Button variant="outline" size="lg">View on GitHub</Button>
          </a>
        </div>
      </section>
    </div>
  )
}
