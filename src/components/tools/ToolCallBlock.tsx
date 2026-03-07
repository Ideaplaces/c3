'use client'

import { useState } from 'react'
import { getToolSummary } from '@/lib/messages/parser'
import { BashTool } from './BashTool'
import { ReadTool } from './ReadTool'
import { EditTool } from './EditTool'
import { WriteTool } from './WriteTool'
import { GrepTool } from './GrepTool'
import { GlobTool } from './GlobTool'

const toolIcons: Record<string, string> = {
  Bash: '$ ',
  Read: '\u{1F4C4} ',
  Edit: '\u{270F}\u{FE0F} ',
  Write: '\u{1F4DD} ',
  Grep: '\u{1F50D} ',
  Glob: '\u{1F4C1} ',
  Task: '\u{1F916} ',
  WebFetch: '\u{1F310} ',
  WebSearch: '\u{1F50E} ',
}

interface ToolCallBlockProps {
  toolName: string
  toolId: string
  input: Record<string, unknown>
  output?: string
  isError?: boolean
}

export function ToolCallBlock({ toolName, toolId, input, output, isError }: ToolCallBlockProps) {
  const [expanded, setExpanded] = useState(false)
  const summary = getToolSummary(toolName, input)
  const icon = toolIcons[toolName] || '\u{1F527} '

  const renderToolContent = () => {
    switch (toolName) {
      case 'Bash':
        return <BashTool input={input} output={output} />
      case 'Read':
        return <ReadTool input={input} output={output} />
      case 'Edit':
        return <EditTool input={input} />
      case 'Write':
        return <WriteTool input={input} />
      case 'Grep':
        return <GrepTool input={input} output={output} />
      case 'Glob':
        return <GlobTool input={input} output={output} />
      default:
        return (
          <div className="space-y-2">
            <pre className="text-xs font-mono text-foreground-muted overflow-x-auto bg-surface p-3 rounded-md border border-border">
              {JSON.stringify(input, null, 2)}
            </pre>
            {output && (
              <pre className="text-xs font-mono text-foreground-muted overflow-x-auto bg-surface p-3 rounded-md border border-border max-h-[300px] overflow-y-auto whitespace-pre-wrap">
                {output}
              </pre>
            )}
          </div>
        )
    }
  }

  return (
    <div className={`border rounded-md overflow-hidden ${isError ? 'border-error/30' : 'border-border'}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-2 sm:px-3 py-2 flex items-center gap-1.5 sm:gap-2 text-left hover:bg-surface/50 transition-colors"
        data-tool-id={toolId}
      >
        <span className="text-xs select-none shrink-0">{expanded ? '\u25BC' : '\u25B6'}</span>
        <span className="text-xs sm:text-sm font-mono truncate flex-1 min-w-0">
          <span className="select-none">{icon}</span>
          {summary}
        </span>
        {isError && (
          <span className="badge badge-error text-[10px] px-1.5 py-0.5 shrink-0">error</span>
        )}
      </button>
      {expanded && (
        <div className="px-2 sm:px-3 pb-3 border-t border-border pt-2 overflow-x-auto">
          {renderToolContent()}
        </div>
      )}
    </div>
  )
}
