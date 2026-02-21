'use client'

interface BashToolProps {
  input: Record<string, unknown>
  output?: string
}

export function BashTool({ input, output }: BashToolProps) {
  const command = String(input.command || '')
  const description = input.description as string | undefined

  return (
    <div className="space-y-2">
      {description && (
        <div className="text-xs text-foreground-muted">{description}</div>
      )}
      <div className="bg-surface rounded-md border border-border overflow-hidden">
        <div className="px-3 py-2 font-mono text-sm text-accent">
          <span className="text-foreground-muted select-none">$ </span>
          {command}
        </div>
        {output && (
          <div className="border-t border-border px-3 py-2 font-mono text-xs text-foreground-muted max-h-[300px] overflow-y-auto whitespace-pre-wrap">
            {output}
          </div>
        )}
      </div>
    </div>
  )
}
