'use client'

import { useState, useEffect } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Logo } from '@/components/ui/Logo'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/Skeleton'

interface Trigger {
  name: string
  type: 'cron' | 'slack' | 'discord'
  schedule?: string
  channelId?: string
  prompt: string
  projectPath: string
  permissionMode: string
  model: string
  enabled?: boolean
  pollIntervalMs?: number
}

function humanReadableCron(expression: string): string {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return expression
  const [min, hour, dom, month, dow] = parts

  const dowNames: Record<string, string> = {
    '0': 'Sundays', '1': 'Mondays', '2': 'Tuesdays', '3': 'Wednesdays',
    '4': 'Thursdays', '5': 'Fridays', '6': 'Saturdays',
    '1-5': 'Weekdays', '0,6': 'Weekends', '*': 'Every day',
  }

  const timePart = `${hour.padStart(2, '0')}:${min.padStart(2, '0')} UTC`

  if (dom === '*' && month === '*' && dow !== '*') {
    return `${dowNames[dow] || `Day ${dow}`} at ${timePart}`
  }
  if (dom === '*' && month === '*' && dow === '*') {
    if (hour === '*') return `Every hour at :${min.padStart(2, '0')}`
    return `Daily at ${timePart}`
  }
  return expression
}

function typeBadgeVariant(type: string) {
  switch (type) {
    case 'cron': return 'info' as const
    case 'slack': return 'warning' as const
    case 'discord': return 'secondary' as const
    default: return 'idle' as const
  }
}

function typeIcon(type: string) {
  switch (type) {
    case 'cron':
      return (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      )
    case 'slack':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
        </svg>
      )
    case 'discord':
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
        </svg>
      )
    default: return null
  }
}

function TriggerCard({
  trigger,
  promptContent,
  expanded,
  onToggle,
}: {
  trigger: Trigger
  promptContent?: string
  expanded: boolean
  onToggle: () => void
}) {
  const borderColor = trigger.type === 'cron'
    ? 'border-l-info'
    : trigger.type === 'slack'
      ? 'border-l-warning'
      : 'border-l-secondary'

  return (
    <Card
      variant="default"
      className={`border-l-4 ${borderColor} overflow-hidden`}
    >
      <button
        onClick={onToggle}
        className="w-full text-left px-3 sm:px-5 py-3 sm:py-4"
      >
        {/* Top row: name + badges */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="text-foreground-muted">{typeIcon(trigger.type)}</span>
              <span className="font-semibold text-foreground text-sm sm:text-base truncate">
                {trigger.name}
              </span>
              <Badge variant={typeBadgeVariant(trigger.type)}>
                {trigger.type}
              </Badge>
              {trigger.enabled === false && (
                <Badge variant="idle">disabled</Badge>
              )}
            </div>

            {/* Schedule or channel info */}
            <div className="text-sm text-foreground-muted mt-1">
              {trigger.type === 'cron' && trigger.schedule && (
                <span className="font-mono text-xs bg-surface px-2 py-0.5 rounded">
                  {humanReadableCron(trigger.schedule)}
                </span>
              )}
              {trigger.type === 'slack' && (
                <span className="text-xs">
                  Channel: <span className="font-mono">{trigger.channelId}</span>
                  {trigger.pollIntervalMs && ` (poll: ${trigger.pollIntervalMs / 1000}s)`}
                </span>
              )}
              {trigger.type === 'discord' && (
                <span className="text-xs">
                  Channel: <span className="font-mono">{trigger.channelId}</span>
                </span>
              )}
            </div>

            {/* Meta row */}
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="text-xs text-foreground-muted/60">
                {trigger.projectPath.replace(/^\/home\/\w+\//, '~/')}
              </span>
              <span className="text-xs text-foreground-muted/40">
                {trigger.model}
              </span>
              <span className="text-xs text-foreground-muted/40">
                {trigger.prompt}
              </span>
            </div>
          </div>

          {/* Expand indicator */}
          <svg
            className={`w-4 h-4 text-foreground-muted/40 transition-transform shrink-0 mt-1 ${expanded ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>

      {/* Expanded: show prompt content */}
      {expanded && promptContent && (
        <div className="border-t border-border px-3 sm:px-5 py-3 sm:py-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-foreground-muted uppercase tracking-wider">
              Prompt: {trigger.prompt}
            </span>
          </div>
          <pre className="text-xs sm:text-sm text-foreground-muted bg-surface rounded-lg p-3 sm:p-4 overflow-x-auto max-h-[60vh] overflow-y-auto font-mono leading-relaxed whitespace-pre-wrap break-words">
            {promptContent}
          </pre>
        </div>
      )}
    </Card>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <div key={i} className="border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-48" />
          <div className="flex gap-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function TriggersPage() {
  const [triggers, setTriggers] = useState<Trigger[]>([])
  const [prompts, setPrompts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [expandedTrigger, setExpandedTrigger] = useState<string | null>(null)
  const [user, setUser] = useState<{ email: string; name: string } | null>(null)

  useEffect(() => {
    fetch('/api/triggers')
      .then((r) => r.json())
      .then((data) => {
        setTriggers(data.triggers)
        setPrompts(data.prompts)
        setLoading(false)
      })
      .catch((err) => {
        console.error(err)
        setLoading(false)
      })

    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((data) => setUser(data.user))
      .catch(console.error)
  }, [])

  const cronTriggers = triggers.filter((t) => t.type === 'cron')
  const slackTriggers = triggers.filter((t) => t.type === 'slack')
  const discordTriggers = triggers.filter((t) => t.type === 'discord')

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border px-4 sm:px-6 py-3 sm:py-4 relative">
        <div className="flex items-center justify-between">
          <a href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Logo size={32} />
            <span className="text-foreground-muted text-sm hidden sm:inline">Cloud Claude Code</span>
          </a>
          <div className="flex items-center gap-2 sm:gap-4">
            {user && (
              <span className="text-sm text-foreground-muted hidden sm:inline">{user.name}</span>
            )}
            <a href="/sessions">
              <Button variant="outline" size="sm">Sessions</Button>
            </a>
            <a
              href="/api/auth/logout"
              className="inline-flex items-center justify-center font-semibold rounded-md transition-all duration-200 bg-transparent border border-border text-foreground hover:bg-muted px-2.5 py-1 text-xs min-h-[32px]"
            >
              Logout
            </a>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-secondary to-primary opacity-30" />
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <h1 className="text-lg sm:text-xl font-semibold text-foreground">
            Triggers & Prompts
          </h1>
          <span className="text-xs text-foreground-muted/50">
            {triggers.length} trigger{triggers.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <LoadingSkeleton />
        ) : triggers.length === 0 ? (
          <div className="text-center py-16">
            <svg className="w-12 h-12 mx-auto text-foreground-muted/30 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <p className="text-foreground-muted text-sm">No triggers configured</p>
            <p className="text-foreground-muted/50 text-xs mt-1">
              Edit ~/.c3/triggers.json to add triggers
            </p>
          </div>
        ) : (
          <div className="space-y-6 sm:space-y-8">
            {/* Cron triggers */}
            {cronTriggers.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">
                    Scheduled
                  </h2>
                  <Badge variant="info">{cronTriggers.length}</Badge>
                </div>
                <div className="space-y-2">
                  {cronTriggers.map((trigger) => (
                    <TriggerCard
                      key={trigger.name}
                      trigger={trigger}
                      promptContent={prompts[trigger.prompt]}
                      expanded={expandedTrigger === trigger.name}
                      onToggle={() =>
                        setExpandedTrigger(
                          expandedTrigger === trigger.name ? null : trigger.name
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Slack triggers */}
            {slackTriggers.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">
                    Slack
                  </h2>
                  <Badge variant="warning">{slackTriggers.length}</Badge>
                </div>
                <div className="space-y-2">
                  {slackTriggers.map((trigger) => (
                    <TriggerCard
                      key={trigger.name}
                      trigger={trigger}
                      promptContent={prompts[trigger.prompt]}
                      expanded={expandedTrigger === trigger.name}
                      onToggle={() =>
                        setExpandedTrigger(
                          expandedTrigger === trigger.name ? null : trigger.name
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Discord triggers */}
            {discordTriggers.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h2 className="text-sm font-semibold text-foreground-muted uppercase tracking-wider">
                    Discord
                  </h2>
                  <Badge variant="secondary">{discordTriggers.length}</Badge>
                </div>
                <div className="space-y-2">
                  {discordTriggers.map((trigger) => (
                    <TriggerCard
                      key={trigger.name}
                      trigger={trigger}
                      promptContent={prompts[trigger.prompt]}
                      expanded={expandedTrigger === trigger.name}
                      onToggle={() =>
                        setExpandedTrigger(
                          expandedTrigger === trigger.name ? null : trigger.name
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {/* Config location hint */}
        <div className="mt-8 sm:mt-12 text-center">
          <p className="text-xs text-foreground-muted/30">
            Config: ~/.c3/triggers.json &middot; Prompts: ~/.c3/prompts/
          </p>
        </div>
      </main>
    </div>
  )
}
