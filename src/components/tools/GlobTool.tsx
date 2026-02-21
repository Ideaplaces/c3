'use client'

interface GlobToolProps {
  input: Record<string, unknown>
  output?: string
}

export function GlobTool({ input, output }: GlobToolProps) {
  const pattern = String(input.pattern || '')

  return (
    <div className="space-y-1">
      <div className="text-xs text-foreground-muted">
        Pattern: <span className="font-mono text-accent">{pattern}</span>
      </div>
      {output && (
        <pre className="bg-surface border border-border rounded-md px-3 py-2 font-mono text-xs text-foreground-muted max-h-[200px] overflow-y-auto whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  )
}
