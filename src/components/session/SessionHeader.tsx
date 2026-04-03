'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { ResumeCommand } from './ResumeCommand'

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'bypass', color: 'text-info bg-info/10', enabled: true },
  { value: 'acceptEdits', label: 'auto-edit (coming soon)', color: 'text-warning bg-warning/10', enabled: false },
  { value: 'default', label: 'default (coming soon)', color: 'text-foreground-muted bg-surface', enabled: false },
] as const

interface SessionHeaderProps {
  projectName: string
  isRunning: boolean
  permissionMode: string
  onPermissionModeChange: (mode: string) => void
  onStop: () => void
  canStop: boolean
  sessionId?: string
  projectPath?: string
}

export function SessionHeader({
  projectName,
  isRunning,
  permissionMode,
  onPermissionModeChange,
  onStop,
  canStop,
  sessionId,
  projectPath,
}: SessionHeaderProps) {
  return (
    <div className="shrink-0 bg-background z-10">
    <header className="border-b border-border px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between relative">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <Link href="/sessions" className="text-foreground-muted hover:text-foreground transition-colors text-sm shrink-0">
          &larr;<span className="hidden sm:inline"> Sessions</span>
        </Link>
        {projectName && (
          <span className="font-medium font-mono text-sm truncate">{projectName}</span>
        )}
        <select
          value={permissionMode}
          onChange={(e) => onPermissionModeChange(e.target.value)}
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 cursor-pointer border-0 outline-none appearance-auto ${
            PERMISSION_MODES.find(m => m.value === permissionMode)?.color || 'bg-surface'
          }`}
        >
          {PERMISSION_MODES.map(mode => (
            <option key={mode.value} value={mode.value} disabled={!mode.enabled}>{mode.label}</option>
          ))}
        </select>
        {isRunning && (
          <span className="inline-flex items-center gap-1.5 text-xs text-info shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-info animate-pulse" />
            <span className="hidden sm:inline">Running</span>
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="destructive"
          size="sm"
          onClick={onStop}
          disabled={!canStop}
        >
          Stop
        </Button>
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-primary via-secondary to-primary opacity-30" />
    </header>
    {sessionId && (
      <div className="px-3 sm:px-4 py-1.5 border-b border-border/50">
        <ResumeCommand sessionId={sessionId} projectPath={projectPath} />
      </div>
    )}
    </div>
  )
}
