'use client'

import { useState, useEffect } from 'react'

interface CodeBlockProps {
  code: string
  language?: string
  fileName?: string
  maxHeight?: string
}

export function CodeBlock({ code, language, fileName, maxHeight = '400px' }: CodeBlockProps) {
  const [html, setHtml] = useState<string>('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false

    // Lazy-load shiki
    import('shiki').then(async ({ createHighlighter }) => {
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
        // Fallback: render as plain text
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
    <div className="relative group">
      {fileName && (
        <div className="text-xs text-foreground-muted bg-background-alt px-3 py-1.5 rounded-t-md border border-b-0 border-border font-mono">
          {fileName}
        </div>
      )}
      <div className="relative">
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs bg-surface px-2 py-1 rounded border border-border text-foreground-muted hover:text-foreground"
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
        {html ? (
          <div
            className={`overflow-auto text-sm ${fileName ? 'rounded-b-md' : 'rounded-md'}`}
            style={{ maxHeight }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre
            className={`overflow-auto text-sm p-4 bg-surface border border-border ${
              fileName ? 'rounded-b-md border-t-0' : 'rounded-md'
            }`}
            style={{ maxHeight }}
          >
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
