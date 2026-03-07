'use client'

import { useState, useEffect } from 'react'

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
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4">
      <div className="card p-4 sm:p-6 w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold font-heading">New Session</h2>
          <button
            type="button"
            onClick={onClose}
            className="sm:hidden text-foreground-muted hover:text-foreground p-1"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground-muted mb-1">
              Project
            </label>
            <select
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              className="w-full bg-surface border border-border rounded-md px-3 py-2.5 text-foreground focus:border-primary focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.path} value={p.path}>{p.name}</option>
              ))}
            </select>
          </div>

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
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => setPermissionMode(mode.value)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    permissionMode === mode.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-surface border border-border text-foreground-muted hover:bg-muted'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-muted mb-1">
              Model (optional)
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full bg-surface border border-border rounded-md px-3 py-2.5 text-foreground focus:border-primary focus:outline-none"
            >
              <option value="">Default (Sonnet)</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
              <option value="claude-opus-4-6">Claude Opus 4.6</option>
              <option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground-muted mb-1">
              Prompt
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What do you want Claude to do?"
              rows={4}
              className="w-full bg-surface border border-border rounded-md px-3 py-2 text-foreground font-mono text-sm focus:border-primary focus:outline-none resize-none"
              autoFocus
            />
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-outline px-4 py-2 hidden sm:inline-flex"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedProject || !prompt.trim() || loading}
              className="btn btn-primary px-4 py-2.5 w-full sm:w-auto disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Starting...' : 'Start Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
