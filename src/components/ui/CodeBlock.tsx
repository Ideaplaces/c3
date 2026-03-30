'use client'

import { useState, useEffect } from 'react'
import { cn } from './cn'

interface CodeBlockProps {
  code: string
  language?: string
  fileName?: string
  maxHeight?: string
  className?: string
}

export function CodeBlock({ code, language, fileName, maxHeight = '400px', className }: CodeBlockProps) {
  const [html, setHtml] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    import('shiki/bundle/web').then(async ({ createHighlighter }) => {
      if (cancelled) return
      try {
        const highlighter = await createHighlighter({
          themes: ['github-dark'],
          langs: [language || 'text'],
        })
        if (cancelled) return
        const result = highlighter.codeToHtml(code, {
          lang: language || 'text',
          theme: 'github-dark',
        })
        setHtml(result)
      } catch {
        setHtml('')
      }
    })

    return () => { cancelled = true }
  }, [code, language])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className={cn('relative group', className)}>
      {fileName && (
        <div className="text-xs text-foreground-muted bg-background-alt px-3 py-1.5 rounded-t-md border border-b-0 border-border font-mono">
          {fileName}
        </div>
      )}
      <div className="relative">
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs bg-surface px-2 py-1 rounded border border-border text-foreground-muted hover:text-foreground z-10"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        {html ? (
          <div
            className={cn(
              'overflow-auto text-sm',
              fileName ? 'rounded-b-md' : 'rounded-md'
            )}
            style={{ maxHeight }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre
            className={cn(
              'overflow-auto text-sm p-4 bg-surface border border-border',
              fileName ? 'rounded-b-md border-t-0' : 'rounded-md'
            )}
            style={{ maxHeight }}
          >
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
