'use client'

interface ThinkingBlockProps {
  content: string
}

export function ThinkingBlock({ content }: ThinkingBlockProps) {
  return (
    <details className="text-foreground-muted text-sm border border-border rounded-md overflow-hidden">
      <summary className="cursor-pointer hover:bg-surface px-3 py-2 flex items-center gap-2">
        <svg className="w-4 h-4 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z" />
          <line x1="10" y1="22" x2="14" y2="22" />
        </svg>
        Thinking
      </summary>
      <div className="px-3 pb-3 pt-1 border-t border-border whitespace-pre-wrap text-xs font-mono bg-surface max-h-[300px] overflow-y-auto">
        {content}
      </div>
    </details>
  )
}
