'use client'

interface DiffViewProps {
  oldText: string
  newText: string
}

export function DiffView({ oldText, newText }: DiffViewProps) {
  // Simple line-by-line diff display
  const oldLines = oldText.split('\n')
  const newLines = newText.split('\n')

  return (
    <div className="font-mono text-xs overflow-x-auto bg-surface rounded-md border border-border">
      {oldLines.length > 0 && oldText && (
        <div>
          {oldLines.map((line, i) => (
            <div key={`old-${i}`} className="diff-remove px-3 py-0.5">
              <span className="select-none text-foreground-muted mr-2">-</span>
              {line}
            </div>
          ))}
        </div>
      )}
      {newLines.length > 0 && newText && (
        <div>
          {newLines.map((line, i) => (
            <div key={`new-${i}`} className="diff-add px-3 py-0.5">
              <span className="select-none text-foreground-muted mr-2">+</span>
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
