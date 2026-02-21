'use client'

import { DiffView } from './DiffView'

interface EditToolProps {
  input: Record<string, unknown>
}

export function EditTool({ input }: EditToolProps) {
  const filePath = String(input.file_path || '')
  const oldString = String(input.old_string || '')
  const newString = String(input.new_string || '')

  return (
    <div className="space-y-1">
      <div className="text-xs text-foreground-muted font-mono">{filePath}</div>
      <DiffView oldText={oldString} newText={newString} />
    </div>
  )
}
