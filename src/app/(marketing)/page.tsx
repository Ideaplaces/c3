import { Badge } from '@/components/ui/Badge'
import { StatusDot } from '@/components/ui/StatusDot'

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="px-4 sm:px-8 py-16 sm:py-24">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl sm:text-6xl font-bold font-heading mb-6">
            <span className="text-gradient">C3</span>
          </h1>
          <p className="text-xl sm:text-2xl text-foreground-muted mb-4 font-heading">
            Cloud Claude Code
          </p>
          <p className="text-lg sm:text-xl text-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
            Claude Code, from any browser. Autonomous agents, from any channel.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a
              href="/docs"
              className="inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary-dark hover:shadow-[0_0_30px_rgba(255,79,109,0.6)] px-6 py-3 text-base min-h-[44px] w-full sm:w-auto"
            >
              Get Started
            </a>
            <a
              href="https://github.com/Ideaplaces/c3"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 bg-transparent border border-border text-foreground hover:bg-muted px-6 py-3 text-base min-h-[44px] w-full sm:w-auto"
            >
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* Two Pillars */}
      <section className="px-4 sm:px-8 py-16 bg-surface/50">
        <div className="max-w-6xl mx-auto grid md:grid-cols-2 gap-8 sm:gap-12">
          <div className="bg-card border border-border rounded-lg p-6 sm:p-8">
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
          </div>

          <div className="bg-card border border-border rounded-lg p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-secondary/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-secondary" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </div>
              <h2 className="text-xl font-bold font-heading">Autonomous Triggers</h2>
            </div>
            <p className="text-foreground-muted leading-relaxed">
              A Slack message starts an investigation. A Discord alert triggers a fix. Agents run while you sleep.
            </p>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="px-4 sm:px-8 py-16">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-center mb-12">How It Works</h2>
          <div className="bg-card border border-border rounded-lg p-6 sm:p-8 font-mono text-sm overflow-x-auto">
            <pre className="text-foreground-muted leading-relaxed whitespace-pre">
{`Your Device         C3 Server           Claude Code SDK       Your Codebase
  (browser)       (Next.js + WS)       (Agent SDK)           (local files)
     |                 |                     |                     |
     |--- WebSocket -->|                     |                     |
     |    "fix bug"    |--- spawn session -->|                     |
     |                 |                     |--- read/edit ------>|
     |                 |                     |--- run tests ------>|
     |<-- stream ------|<-- SDK events ------|                     |
     |    results      |                     |                     |

  Discord/Slack ------>|
    trigger msg        |--- auto-start session (headless) ------->|`}
            </pre>
          </div>
        </div>
      </section>

      {/* Live Components */}
      <section className="px-4 sm:px-8 py-16 bg-surface/50">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-bold font-heading text-center mb-4">Built with Real Components</h2>
          <p className="text-foreground-muted text-center mb-12">
            These are the actual UI components from C3, rendered live on this page.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Badge variant="info" className="animate-pulse-glow">
              <StatusDot status="running" className="mr-2" />
              Running
            </Badge>
            <Badge variant="idle">Idle</Badge>
            <Badge variant="success">Completed</Badge>
            <Badge variant="error">Error</Badge>
            <Badge variant="default">3 turns</Badge>
            <Badge variant="secondary">$0.04</Badge>
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
          <a
            href="https://github.com/Ideaplaces/c3"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 bg-transparent border border-border text-foreground hover:bg-muted px-6 py-3 text-base min-h-[44px]"
          >
            View on GitHub
          </a>
        </div>
      </section>
    </div>
  )
}
