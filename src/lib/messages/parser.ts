import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'

export type ParsedBlock =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'tool_use'; toolName: string; toolId: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export function parseAssistantMessage(message: SDKMessage): ParsedBlock[] {
  if (message.type !== 'assistant') return []

  const blocks: ParsedBlock[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = message.message.content || []

  for (const block of content) {
    switch (block.type) {
      case 'text':
        if (block.text) {
          blocks.push({ type: 'text', content: block.text })
        }
        break
      case 'thinking':
        if (block.thinking) {
          blocks.push({ type: 'thinking', content: block.thinking })
        }
        break
      case 'tool_use':
        blocks.push({
          type: 'tool_use',
          toolName: block.name,
          toolId: block.id,
          input: block.input as Record<string, unknown>,
        })
        break
      case 'tool_result':
        blocks.push({
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
          isError: block.is_error,
        })
        break
    }
  }

  return blocks
}

export function getToolSummary(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return `$ ${String(input.command || '').slice(0, 80)}`
    case 'Read':
      return `Read ${input.file_path}`
    case 'Edit':
      return `Edit ${input.file_path}`
    case 'Write':
      return `Write ${input.file_path}`
    case 'Grep':
      return `Search: "${input.pattern}"`
    case 'Glob':
      return `Glob: ${input.pattern}`
    case 'Task':
      return `Task: ${input.description || 'subagent'}`
    case 'WebFetch':
      return `Fetch: ${input.url}`
    case 'WebSearch':
      return `Search: "${input.query}"`
    default:
      return toolName
  }
}
