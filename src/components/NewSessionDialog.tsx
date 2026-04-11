'use client'

import { useState, useEffect } from 'react'
import { Dialog } from './ui/Dialog'
import { Select } from './ui/Select'
import { Textarea } from './ui/Textarea'
import { Button } from './ui/Button'

interface Project {
  name: string
  path: string
}

interface NewSessionDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    projectPath: string
    prompt: string
    permissionMode: string
    model?: string
  }) => void
}

export function NewSessionDialog({ open, onClose, onSubmit }: NewSessionDialogProps) {
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState('')
  const [prompt, setPrompt] = useState('')
  const [permissionMode, setPermissionMode] = useState('bypassPermissions')
  const [model, setModel] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) {
      fetch('/api/projects')
        .then((r) => r.json())
        .then((data) => {
          setProjects(data.projects)
          if (data.projects.length > 0 && !selectedProject) {
            setSelectedProject(data.projects[0].path)
          }
        })
        .catch(console.error)
    }
  }, [open, selectedProject])

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedProject || !prompt.trim()) return
    setLoading(true)
    onSubmit({
      projectPath: selectedProject,
      prompt: prompt.trim(),
      permissionMode,
      model: model || undefined,
    })
  }

  return (
    <Dialog open={open} onClose={onClose} title="New Session">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Select
          label="Project"
          value={selectedProject}
          onChange={(e) => setSelectedProject(e.target.value)}
        >
          {projects.map((p) => (
            <option key={p.path} value={p.path}>{p.name}</option>
          ))}
        </Select>

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
          <option value="">Default (Opus)</option>
          <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
          <option value="claude-opus-4-6">Claude Opus 4.6</option>
          <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
        </Select>

        <Textarea
          label="Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="What do you want Claude to do?"
          rows={4}
          autoFocus
        />

        <div className="flex gap-3 justify-end pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            className="hidden sm:inline-flex"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!selectedProject || !prompt.trim()}
            loading={loading}
            className="w-full sm:w-auto"
          >
            {loading ? 'Starting...' : 'Start Session'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
