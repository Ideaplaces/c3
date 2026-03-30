'use client'

import { CodeBlock } from '@/components/ui/CodeBlock'
import { getLanguageFromPath } from '@/lib/messages/language'

interface ReadToolProps {
  input: Record<string, unknown>
  output?: string
}

export function ReadTool({ input, output }: ReadToolProps) {
  const filePath = String(input.file_path || '')
  const language = getLanguageFromPath(filePath)

  return (
    <div className="space-y-1">
      {output && (
        <CodeBlock
          code={output}
          language={language}
          fileName={filePath}
          maxHeight="400px"
        />
      )}
    </div>
  )
}
