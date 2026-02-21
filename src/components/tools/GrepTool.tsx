'use client'

interface GrepToolProps {
  input: Record<string, unknown>
  output?: string
}

export function GrepTool({ input, output }: GrepToolProps) {
  const pattern = String(input.pattern || '')
  const path = input.path as string | undefined

  return (
    <div className="space-y-1">
      <div className="text-xs text-foreground-muted">
        Pattern: <span className="font-mono text-accent">{pattern}</span>
        {path && <span> in <span className="font-mono">{path}</span></span>}
      </div>
      {output && (
        <pre className="bg-surface border border-border rounded-md px-3 py-2 font-mono text-xs text-foreground-muted max-h-[300px] overflow-y-auto whitespace-pre-wrap">
          {output}
        </pre>
      )}
    </div>
  )
}
