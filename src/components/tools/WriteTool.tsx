'use client'

import { CodeBlock } from '@/components/ui/CodeBlock'
import { getLanguageFromPath } from '@/lib/messages/language'

interface WriteToolProps {
  input: Record<string, unknown>
}

export function WriteTool({ input }: WriteToolProps) {
  const filePath = String(input.file_path || '')
  const content = String(input.content || '')
  const language = getLanguageFromPath(filePath)

  return (
    <div className="space-y-1">
      <CodeBlock
        code={content}
        language={language}
        fileName={filePath}
        maxHeight="400px"
      />
    </div>
  )
}
