'use client'

import { useState, useEffect } from 'react'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'
import { Button } from './ui/Button'
import { cn } from './ui/cn'

interface Project {
  name: string
  path: string
}

export interface NewSessionData {
  projectPath: string
  prompt: string
  permissionMode: string
  model?: string
}

interface NewSessionFormProps {
  onSubmit: (data: NewSessionData) => void
}

// The folder picked last time is the default next time, on this device.
const LAST_PROJECT_KEY = 'c3.lastProjectPath'
const CHIP_COUNT = 4

export function NewSessionForm({ onSubmit }: NewSessionFormProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [workspaces, setWorkspaces] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [prompt, setPrompt] = useState('')
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/projects')
        const data: { projects: Project[]; workspaces: Project[] } = await res.json()
        setProjects(data.projects)
        setWorkspaces(data.workspaces)
        const last = localStorage.getItem(LAST_PROJECT_KEY)
        const known = data.projects.some((p) => p.path === last)
        setSelectedProject(last && known ? last : data.workspaces[0]?.path ?? data.projects[0]?.path ?? '')
      } catch (err) {
        console.error('[C3] could not load projects:', err)
      }
    }
    load()
  }, [])

  const chips = workspaces.slice(0, CHIP_COUNT)
  const chipSelected = chips.some((w) => w.path === selectedProject)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || !prompt.trim()) return
    setLoading(true)
    try {
      localStorage.setItem(LAST_PROJECT_KEY, selectedProject)
    } catch (err) {
      console.error('[C3] could not remember the folder:', err)
    }
    onSubmit({
      projectPath: selectedProject,
      prompt: prompt.trim(),
      permissionMode,
      model: model || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <span className="block text-sm font-medium text-foreground-muted mb-2">Folder</span>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Folder">
          {chips.map((w) => (
            <button
              key={w.path}
              type="button"
              role="radio"
              aria-checked={selectedProject === w.path}
              onClick={() => setSelectedProject(w.path)}
              className={cn(
                'min-h-[44px] rounded-md border px-3 py-2 text-sm font-mono truncate transition-colors',
                selectedProject === w.path
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-surface text-foreground-muted hover:border-primary/50',
              )}
            >
              {w.name}
            </button>
          ))}
        </div>
        <Select
          aria-label="Other folder"
          value={chipSelected ? '' : selectedProject}
          onChange={(e) => e.target.value && setSelectedProject(e.target.value)}
          className={cn('mt-2', !chipSelected && selectedProject && 'border-primary')}
        >
          <option value="">Other folder...</option>
          {projects.map((p) => (
            <option key={p.path} value={p.path}>{p.name}</option>
          ))}
        </Select>
      </div>

      <Textarea
        label="Prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="What do you want Claude to do?"
        rows={4}
      />

      <details className="text-sm">
        <summary className="cursor-pointer text-foreground-muted select-none min-h-[44px] flex items-center">
          Options
        </summary>
        <div className="space-y-4 pt-2">
          <div>
            <label className="block text-sm font-medium text-foreground-muted mb-1">
              Permission Mode
            </label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 'bypassPermissions', label: 'Bypass' },
                { value: 'acceptEdits', label: 'Accept Edits' },
                { value: 'default', label: 'Default' },
              ].map((mode) => (
                <Button
                  key={mode.value}
                  type="button"
                  variant={permissionMode === mode.value ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setPermissionMode(mode.value)}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </div>

          <Select
            label="Model (optional)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          >
            <option value="">Default (Opus 5.5, 1M context)</option>
            <option value="claude-opus-5-5[1m]">Claude Opus 5.5 (1M context)</option>
            <option value="claude-opus-5-5">Claude Opus 5.5</option>
            <option value="claude-opus-5[1m]">Claude Opus 5 (1M context)</option>
            <option value="claude-opus-5">Claude Opus 5</option>
            <option value="claude-fable-5">Claude Fable 5</option>
            <option value="claude-opus-4-8">Claude Opus 4.8</option>
            <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
            <option value="claude-opus-4-6">Claude Opus 4.6</option>
            <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
          </Select>
        </div>
      </details>

      <Button
        type="submit"
        variant="primary"
        disabled={!selectedProject || !prompt.trim()}
        loading={loading}
        className="w-full"
      >
        {loading ? 'Starting...' : 'Start Session'}
      </Button>
    </form>
  )
}
