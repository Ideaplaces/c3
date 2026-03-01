/**
 * Extract displayable text from user message content.
 * Content can be a plain string or an array of content blocks.
 * Returns null if the content is tool_result blocks (handled elsewhere).
 */
export function extractUserMessageText(
  content: string | unknown[]
): string | null {
  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    const hasToolResult = content.some(
      (block: unknown) =>
        typeof block === 'object' &&
        block !== null &&
        'type' in block &&
        (block as { type: string }).type === 'tool_result'
    )
    if (hasToolResult) return null

    const texts = content
      .filter(
        (block: unknown): block is { type: 'text'; text: string } =>
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          (block as { type: string }).type === 'text' &&
          'text' in block
      )
      .map((block) => block.text)

    return texts.length > 0 ? texts.join('\n') : ''
  }

  return String(content)
}
