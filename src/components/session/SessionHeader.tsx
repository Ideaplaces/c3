'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/Button'

const PERMISSION_MODES = [
  { value: 'bypassPermissions', label: 'bypass', color: 'text-info bg-info/10', enabled: true },
  { value: 'acceptEdits', label: 'auto-edit (coming soon)', color: 'text-warning bg-warning/10', enabled: false },
  { value: 'default', label: 'default (coming soon)', color: 'text-foreground-muted bg-surface', enabled: false },
] as const

interface SessionHeaderProps {
  projectName: string
  isRunning: boolean
  connected: boolean
  permissionMode: string
  onPermissionModeChange: (mode: string) => void
  onStop: () => void
  onReconnect: () => void
  canStop: boolean
}

export function SessionHeader({
  projectName,
  isRunning,
  connected,
  permissionMode,
  onPermissionModeChange,
  onStop,
  onReconnect,
  canStop,
}: SessionHeaderProps) {
  return (
    <header className="border-b border-border px-3 sm:px-4 py-2 sm:py-2.5 flex items-center justify-between shrink-0 relative bg-background z-10">
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
        {!connected && (
          <button
            onClick={onReconnect}
            className="inline-flex items-center gap-1.5 text-xs text-warning hover:text-foreground shrink-0 transition-colors"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-warning" />
            Disconnected
          </button>
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
  )
}
